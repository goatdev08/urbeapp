/**
 * useAgentLeads — carga los leads del agente autenticado con datos del buscador
 * y propiedad de origen.
 *
 * Query: from('leads').select(<embedded>).is('deleted_at', null).order('updated_at', {ascending:false})
 *   - RLS (migración 0008) filtra agent_id = auth.uid() — sin filtro explícito aquí.
 *   - Embeds: users(phone, user_preferences(full_name, profile_photo_url))
 *             lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))
 *
 * Transformación raw → AgentLead:
 *   - phone: users.phone (null si null)
 *   - full_name / profile_photo_url: user_preferences[0] (null si array vacío)
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

type RawUserPreference = {
  full_name: string | null;
  profile_photo_url: string | null;
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
    user_preferences: RawUserPreference[];
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
  const prefs = raw.users?.user_preferences ?? [];
  // noUncheckedIndexedAccess: [0] devuelve T | undefined
  const first_pref = prefs[0] ?? null;

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
    full_name: first_pref?.full_name ?? null,
    profile_photo_url: first_pref?.profile_photo_url ?? null,
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
 * Carga los leads del agente autenticado. RLS filtra por agent_id = auth.uid().
 * Expone refetch() para re-disparar la query (p.ej. tras cambiar estado de un lead).
 */
export function useAgentLeads(): UseAgentLeadsState {
  // Consumimos useAuth para alinear el patrón del repo (contexto de sesión activa).
  // El filtro real de agent_id lo hace RLS — no necesitamos el id aquí.
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

      const { data, error: query_error } = await supabase
        .from('leads')
        // ponytail: cast `as never` para embedded selects con columnas de migración 0015
        // (user_preferences.full_name / profile_photo_url) que no están en los tipos
        // generados. Mismo patrón que useAgentProfile y profileService.
        .select(
          'id, user_id, agent_id, status, internal_notes, first_contact_at, last_contact_at, updated_at, created_at, deleted_at, users(phone, user_preferences(full_name, profile_photo_url)), lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))' as never
        )
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
  }, [tick]);

  // ponytail: useCallback sin deps — set_tick es estable (React garantía)
  const refetch = useCallback(() => set_tick((t) => t + 1), []);

  return { leads, loading, error, refetch };
}
