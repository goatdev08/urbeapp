/**
 * useAgentLeads — carga los leads del agente autenticado con datos del buscador,
 * propiedad de origen y scoring/actividad (score/level/is_follow_up).
 *
 * Query: from('leads').select(<embedded+score+level+is_follow_up>).eq('agent_id',agentId)?
 *   .is('deleted_at', null).order(<primario>, {...}).order('updated_at', {ascending:false})
 *   - #226: el alcance es SIEMPRE explícito (.eq por agent_id o agency_id); RLS queda como 2ª capa.
 *   - Embeds: users!leads_user_id_fkey(first_name, last_name, avatar_url, phone)
 *     (FK explícita: leads tiene DOS FKs a users — user_id/buscador y agent_id)
 *             lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))
 *
 * ⚠️ Identidad del buscador desde `users`, NO desde `user_preferences`
 * (subtarea 30.3, mismo motivo que useAgencyAgents): el agente NO puede leer
 * el user_preferences ajeno del buscador vía RLS (`user_prefs_select` = fila
 * propia), pero SÍ puede leer su fila `users` (RLS `users_select`).
 *
 * Orden (75.6, §19.9): DOS .order() encadenados, primario + desempate SIEMPRE
 * updated_at DESC.
 *   - sortBy='score' (default): .order('score',{ascending:false})
 *   - sortBy='last_contact': .order('last_contact_at',{ascending:false,nullsFirst:false})
 *     — nullsFirst:false para que un lead sin seguimiento posterior al primer
 *     contacto no aparezca arriba.
 *
 * Transformación raw → AgentLead:
 *   - phone: users.phone (null si null)
 *   - full_name: build_full_name(users.first_name, users.last_name) — util
 *     compartido con useAgencyAgents (utils/full_name.ts)
 *   - profile_photo_url: users.avatar_url (null si null)
 *   - origin_*: lead_origin_properties[0] (null si array vacío / LEFT JOIN vacío)
 *   - origin_property_thumbnail_url: video con menor position (null si sin videos)
 *   - score/level/is_follow_up: mapeo directo (75.6) — no-null en la fila real,
 *     los mantienen triggers (ver types.ts AgentLead).
 *
 * Errores (75.6, defecto #1/#3 del usuario): mensaje NEUTRO en español, nunca
 * el texto crudo de PostgREST/Postgres.
 *
 * Patrón: useState/useEffect/useCallback (sin useFocusEffect — hook general, no pantalla).
 * ponytail: flag `ignore` + tick counter para refetch — sin AbortController.
 */

import { useState, useEffect, useCallback } from 'react';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';
import type { AgentLead, LeadSortMode } from '../types';
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
  // Scoring/actividad (migración 20260807000004, subtarea 75.6) — not-null en
  // el schema real (triggers los mantienen siempre poblados).
  score: number;
  level: AgentLead['level'];
  is_follow_up: boolean;
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
    // Scoring/actividad (75.6) — mapeo directo, no-null en runtime.
    score: raw.score,
    level: raw.level,
    is_follow_up: raw.is_follow_up,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Scope del AGREGADO (#226) — lo resuelve el caller (CRMScreen vía
 * useAgencyRole) y se pasa explícito: el hook nunca vuelve a delegar el
 * alcance a RLS.
 */
export interface AgentLeadsScope {
  /** true mientras la membresía de agencia aún no resuelve — NO se dispara query. */
  loading: boolean;
  /** true si el caller es owner/admin ACTIVO de su agencia (useAgencyRole.canViewTeam). */
  canViewTeam: boolean;
  /** Agencia activa del caller (null si independiente / sin membresía). */
  agencyId: string | null;
}

/**
 * Carga los leads del agente autenticado, o de un agente específico si se
 * pasa `agentId` (caso owner: ver los leads de cualquier agente de su agencia).
 *
 * 🔴 Semántica del AGREGADO reescrita por #226 (antes 28.3 "RLS decide"):
 * en producción, para un usuario con users.role='admin', "RLS decide"
 * significó "todo" — la cuenta admin veía el pipeline completo de una
 * organización ajena, teléfono del buscador incluido. Regla de la casa:
 * "mis X" SIEMPRE filtra explícito aunque RLS "ya filtre" (RLS = 2ª capa,
 * no el alcance).
 *   - agentId es string → .eq('agent_id', agentId) — gana sobre el scope.
 *   - agentId null/undefined + scope.canViewTeam && scope.agencyId →
 *     .eq('agency_id', scope.agencyId) (el pipeline de SU organización).
 *   - agentId null/undefined en cualquier otro caso → .eq('agent_id', <uid
 *     de sesión>). Sin uid de sesión → no se consulta (fail-closed).
 *   - scope.loading=true → NO se dispara la query todavía (evita un primer
 *     fetch sin alcance mientras la membresía resuelve).
 *
 * Expone refetch() para re-disparar la query (p.ej. tras cambiar estado de un lead).
 *
 * sortBy (subtarea 75.6, §19.9): 'score' (default) ordena por leads.score DESC;
 * 'last_contact' ordena por leads.last_contact_at DESC (nulls al final). Ambos
 * modos desempatan por updated_at DESC — ver header del archivo.
 */
export function useAgentLeads(
  agentId?: string | null,
  sortBy: LeadSortMode = 'score',
  scope?: AgentLeadsScope,
): UseAgentLeadsState {
  // #226: el uid de sesión ES parte del contrato — ancla el filtro explícito
  // del caso "mis leads".
  const { user } = useAuth();
  const session_uid = user?.id ?? null;

  const [leads, set_leads] = useState<AgentLead[]>([]);
  const [loading, set_loading] = useState(true); // EC-8: inicia en true
  const [error, set_error] = useState<string | null>(null);
  // ponytail: tick counter como señal de refetch — más simple que useReducer
  const [tick, set_tick] = useState(0);

  // #226: piezas primitivas del scope como deps del efecto (un objeto literal
  // inline recrearía el efecto en cada render del caller).
  const scope_loading = scope?.loading ?? false;
  const scope_can_view_team = scope?.canViewTeam ?? false;
  const scope_agency_id = scope?.agencyId ?? null;

  useEffect(() => {
    // Flag de cancelación — evita setState tras desmontaje o refetch solapado
    let ignore = false;

    // #226: sin alcance resuelto no hay query — evita el fetch sin filtro que
    // era la mitad cliente de la fuga. Sin setState síncrono (regla del lint):
    // `loading` ya inicia en true y el efecto se re-dispara cuando el scope
    // resuelve (scope_loading está en las deps).
    if (typeof agentId !== 'string' && scope_loading) {
      return;
    }

    async function fetch_leads(): Promise<void> {
      // Resetea loading en cada fetch (incluyendo refetches)
      set_loading(true);

      // #226 fail-closed: sin equipo y sin uid de sesión no hay "mis leads"
      // que consultar — jamás una query sin alcance.
      if (
        typeof agentId !== 'string' &&
        !(scope_can_view_team && scope_agency_id !== null) &&
        session_uid === null
      ) {
        set_leads([]);
        set_error(null);
        set_loading(false);
        return;
      }

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
          // score/level/is_follow_up (75.6): clasificación por actividad visible en el CRM.
          'id, user_id, agent_id, status, internal_notes, first_contact_at, last_contact_at, updated_at, created_at, deleted_at, score, level, is_follow_up, users!leads_user_id_fkey(first_name, last_name, avatar_url, phone), lead_origin_properties(property_id, properties(address, property_videos(thumbnail_url, position)))' as never
        );

      // #226: el alcance SIEMPRE es explícito — nunca una query sin filtro.
      //   agentId string → ese agente (owner filtrando a uno de su equipo).
      //   scope de equipo → la organización del caller (agency_id).
      //   si no → los leads propios (agent_id = uid de sesión).
      const filtered_query =
        typeof agentId === 'string'
          ? base_query.eq('agent_id', agentId)
          : scope_can_view_team && scope_agency_id !== null
            ? base_query.eq('agency_id', scope_agency_id)
            : base_query.eq('agent_id', session_uid as string);

      const filtered_and_deleted_query = filtered_query.is('deleted_at', null);

      // 75.6: primario según sortBy + desempate SIEMPRE por updated_at DESC.
      // Dos .order() sobre la MISMA referencia del builder (no encadenados
      // desde el valor de retorno): en supabase-js real, PostgrestFilterBuilder
      // .order() muta y retorna `this`, así que ambas formas son equivalentes
      // — esta evita asumir que el retorno del primer .order() siga siendo
      // "chainable" (el segundo .order() y el await final van sobre
      // filtered_and_deleted_query en ambos casos).
      if (sortBy === 'last_contact') {
        filtered_and_deleted_query.order('last_contact_at', { ascending: false, nullsFirst: false });
      } else {
        filtered_and_deleted_query.order('score', { ascending: false });
      }

      const { data, error: query_error } = await filtered_and_deleted_query.order('updated_at', {
        ascending: false,
      });

      if (ignore) return;

      if (query_error) {
        // 75.6: mensaje NEUTRO en español — nunca el texto crudo de PostgREST.
        set_error('No se pudieron cargar los leads. Intenta de nuevo.');
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
  }, [tick, agentId, sortBy, scope_loading, scope_can_view_team, scope_agency_id, session_uid]);

  // ponytail: useCallback sin deps — set_tick es estable (React garantía)
  const refetch = useCallback(() => set_tick((t) => t + 1), []);

  return { leads, loading, error, refetch };
}
