/**
 * useAgentLeads — carga los leads del agente autenticado con datos del buscador
 * y propiedad de origen.
 *
 * Query: from('leads').select(<embedded>).is('deleted_at', null).order('updated_at', {ascending:false})
 *   - RLS (migración 0008) filtra agent_id = auth.uid() — sin filtro explícito aquí.
 *   - Embeds: users!leads_user_id_fkey(first_name, last_name, avatar_url, phone)
 *     (FK explícita: leads tiene DOS FKs a users — user_id/buscador y agent_id)
 *             lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))
 *
 * ⚠️ Identidad del buscador desde `users`, NO desde `user_preferences`
 * (subtarea 30.3, mismo motivo que useAgencyAgents): el agente NO puede leer
 * el user_preferences ajeno del buscador vía RLS (`user_prefs_select` = fila
 * propia), pero SÍ puede leer su fila `users` (RLS `users_select`).
 *
 * Transformación raw → AgentLead:
 *   - phone: users.phone (null si null)
 *   - full_name: build_full_name(users.first_name, users.last_name) — util
 *     compartido con useAgencyAgents (utils/full_name.ts)
 *   - profile_photo_url: users.avatar_url (null si null)
 *   - origin_*: lead_origin_properties[0] (null si array vacío / LEFT JOIN vacío)
 *   - origin_property_thumbnail_url: video con menor position (null si sin videos)
 *
 * Patrón: useState/useEffect/useCallback (sin useFocusEffect — hook general, no pantalla).
 * ponytail: flag `ignore` + tick counter para refetch — sin AbortController.
 */

import { useState, useEffect, useCallback } from 'react';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';
import type { AgentLead } from '../types';
import { build_full_name } from '../utils/full_name';

// ---------------------------------------------------------------------------
// Tipo de retorno público
// ---------------------------------------------------------------------------

export interface UseAgentLeadsState {
  /** Lista de leads del agente. Vacía mientras carga o si hay error. */
  leads: AgentLead[];
  /** true mientras el fetch inicial (o re-fetch) está en curso. */
  loading: boolean;
  /** Mensaje de error si la query falló, null en caso de éxito. */
  error: string | null;
  /** Re-dispara el fetch (p.ej. tras un cambio de estado del lead). */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Tipos locales — shape raw del embedded select de PostgREST
// ---------------------------------------------------------------------------

type RawPropertyVideo = {
  thumbnail_url: string | null;
  position: number;
};

type RawLeadOriginProperty = {
  property_id: string;
  properties: {
    address: string | null;
    property_videos: RawPropertyVideo[];
  } | null;
};

type RawLead = {
  id: string;
  user_id: string;
  agent_id: string;
  status: string;
  internal_notes: string | null;
  first_contact_at: string;
  last_contact_at: string | null;
  updated_at: string;
  created_at: string;
  deleted_at: string | null;
  users: {
    phone: string | null;
    first_name: string | null;
    last_name: string | null;
    avatar_url: string | null;
  } | null;
  lead_origin_properties: RawLeadOriginProperty[];
};

// ---------------------------------------------------------------------------
// Helpers de transformación
// ---------------------------------------------------------------------------

/**
 * Elige el thumbnail del video con menor `position`.
 * Null si el array está vacío o el video ganador no tiene thumbnail.
 */
function pick_thumbnail(videos: RawPropertyVideo[]): string | null {
  if (videos.length === 0) return null;
  const sorted = [...videos].sort((a, b) => a.position - b.position);
  // noUncheckedIndexedAccess: sorted[0] es RawPropertyVideo | undefined
  return sorted[0]?.thumbnail_url ?? null;
}

/** Mapea una fila raw (con embedded selects) al tipo AgentLead aplanado. */
function transform_raw_to_agent_lead(raw: RawLead): AgentLead {
  const origin = raw.lead_origin_properties[0] ?? null;
  const videos = origin?.properties?.property_videos ?? [];

  return {
    // Campos directos del lead
    id: raw.id,
    user_id: raw.user_id,
    agent_id: raw.agent_id,
    status: raw.status as AgentLead['status'],
    internal_notes: raw.internal_notes,
    first_contact_at: raw.first_contact_at,
    last_contact_at: raw.last_contact_at,
    updated_at: raw.updated_at,
    created_at: raw.created_at,
    // Usuario interesado (buscador)
    phone: raw.users?.phone ?? null,
    full_name: build_full_name(raw.users?.first_name ?? null, raw.users?.last_name ?? null),
    profile_photo_url: raw.users?.avatar_url ?? null,
    // Propiedad de origen (LEFT JOIN — nullable)
    origin_property_id: origin?.property_id ?? null,
    origin_property_address: origin?.properties?.address ?? null,
    origin_property_thumbnail_url: pick_thumbnail(videos),
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga los leads del agente autenticado, o de un agente específico si se
 * pasa `agentId` (caso owner: ver los leads de cualquier agente de su agencia).
 *
 * Semántica AGREGADO / RLS-driven (subtarea 28.3):
 *   - agentId es string → añade .eq('agent_id', agentId) a la query.
 *   - agentId es null/undefined (default) → sin filtro explícito; RLS decide
 *     (agente normal ve solo los suyos, owner ve todos los de su agencia).
 *
 * Expone refetch() para re-disparar la query (p.ej. tras cambiar estado de un lead).
 */
export function useAgentLeads(agentId?: string | null): UseAgentLeadsState {
  // Consumimos useAuth para alinear el patrón del repo (contexto de sesión activa).
  // El filtro real de agent_id lo hace RLS (o el .eq condicional de abajo) —
  // no necesitamos el id de sesión aquí.
  useAuth();

  const [leads, set_leads] = useState<AgentLead[]>([]);
  const [loading, set_loading] = useState(true); // EC-8: inicia en true
  const [error, set_error] = useState<string | null>(null);
  // ponytail: tick counter como señal de refetch — más simple que useReducer
  const [tick, set_tick] = useState(0);

  useEffect(() => {
    // Flag de cancelación — evita setState tras desmontaje o refetch solapado
    let ignore = false;

    async function fetch_leads(): Promise<void> {
      // Resetea loading en cada fetch (incluyendo refetches)
      set_loading(true);

      const base_query = supabase
        .from('leads')
        // ponytail: cast `as never` para el embedded select completo — el tipo
        // generado de `leads` no modela los joins anidados (users, lead_origin_properties,
        // properties, property_videos). Mismo patrón que useAgentProfile y profileService.
        .select(
          // ⚠️ `users!leads_user_id_fkey` — `leads` tiene DOS FKs a `users`
          // (agent_id y user_id); sin desambiguar, PostgREST devuelve
          // "Could not embed because more than one relationship was found".
          // Queremos el BUSCADOR (leads.user_id), no el agente.
          // Identidad del buscador desde `users` (subtarea 30.3): first_name/
          // last_name/avatar_url, NO user_preferences (RLS no lo permite).
          'id, user_id, agent_id, status, internal_notes, first_contact_at, last_contact_at, updated_at, created_at, deleted_at, users!leads_user_id_fkey(first_name, last_name, avatar_url, phone), lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))' as never
        );

      // agentId string → filtra por ese agente (caso owner viendo a un agente
      // específico). null/undefined → sin filtro explícito, RLS decide.
      const filtered_query =
        typeof agentId === 'string' ? base_query.eq('agent_id', agentId) : base_query;

      const { data, error: query_error } = await filtered_query
        .is('deleted_at', null)
        .order('updated_at', { ascending: false });

      if (ignore) return;

      if (query_error) {
        set_error(query_error.message);
        set_leads([]);
        set_loading(false);
        return;
      }

      const raw_data = (data as unknown as RawLead[] | null) ?? [];
      set_leads(raw_data.map(transform_raw_to_agent_lead));
      set_error(null);
      set_loading(false);
    }

    void fetch_leads();

    return () => {
      ignore = true;
    };
  }, [tick, agentId]);

  // ponytail: useCallback sin deps — set_tick es estable (React garantía)
  const refetch = useCallback(() => set_tick((t) => t + 1), []);

  return { leads, loading, error, refetch };
}
