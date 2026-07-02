/**
 * useAgencyAgents — lista de agentes de la agencia del owner (para el selector
 * del CRM, subtarea #28.2).
 *
 * Query: from('agency_members')
 *   .select('user_id, users(id, user_preferences(full_name, profile_photo_url))' as never)
 *   .eq('agency_id', agencyId).eq('member_role', 'agent').eq('status', 'active')
 *   - Solo se ejecuta si enabled===true && agencyId!=null (enabled = isOwner,
 *     ver useAgencyRole de la subtarea 28.1). Si no, agents=[] sin llamar supabase.
 *   - El owner NO se incluye (filtro member_role='agent' lo excluye).
 *
 * Transformación raw → Agent:
 *   - id: users?.id ?? user_id (fallback si el embed de users viniera null)
 *   - full_name / profile_photo_url: user_preferences[0] (null si array vacío)
 *
 * Orden: client-side por full_name (localeCompare), nulls al final — la query
 * no puede ordenar por full_name (vive en user_preferences, no en agency_members).
 *
 * Patrón: useState/useEffect + flag `ignore`, idéntico a useAgentLeads.
 */

import { useState, useEffect } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { Agent } from '../types';

// ---------------------------------------------------------------------------
// Tipo de retorno público
// ---------------------------------------------------------------------------

export interface UseAgencyAgentsState {
  agents: Agent[];
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Tipos locales — shape raw del embedded select de PostgREST
// ---------------------------------------------------------------------------

type RawUserPreference = {
  full_name: string | null;
  profile_photo_url: string | null;
};

type RawUser = {
  id: string;
  user_preferences: RawUserPreference[];
};

type RawAgencyMemberRow = {
  user_id: string;
  users: RawUser | null;
};

// ---------------------------------------------------------------------------
// Helpers de transformación
// ---------------------------------------------------------------------------

function transform_raw_to_agent(raw: RawAgencyMemberRow): Agent {
  const prefs = raw.users?.user_preferences ?? [];
  const first_pref = prefs[0] ?? null;

  return {
    id: raw.users?.id ?? raw.user_id,
    full_name: first_pref?.full_name ?? null,
    profile_photo_url: first_pref?.profile_photo_url ?? null,
  };
}

/** Orden alfabético por full_name (locale), nulls al final. */
function sort_by_full_name(agents: Agent[]): Agent[] {
  return [...agents].sort((a, b) => {
    if (a.full_name === null && b.full_name === null) return 0;
    if (a.full_name === null) return 1;
    if (b.full_name === null) return -1;
    return a.full_name.localeCompare(b.full_name);
  });
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga la lista de agentes activos de una agencia. Solo ejecuta la query si
 * enabled===true y agencyId!=null (owner con agencia resuelta).
 */
export function useAgencyAgents(
  agencyId: string | null,
  enabled: boolean
): UseAgencyAgentsState {
  const [agents, set_agents] = useState<Agent[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    // Flag de cancelación — evita setState tras desmontaje
    let ignore = false;

    if (!enabled || agencyId == null) {
      set_agents([]);
      set_error(null);
      set_loading(false);
      return;
    }

    // Narrowing explícito: TS no propaga el `agencyId == null` de arriba a la
    // clausura async de abajo.
    const resolved_agency_id: string = agencyId;

    async function fetch_agents(): Promise<void> {
      set_loading(true);

      const { data, error: query_error } = await supabase
        .from('agency_members')
        // ponytail: cast `as never` para embedded select con columnas de migración
        // 0015 (user_preferences.full_name/profile_photo_url) fuera de los tipos
        // generados. Mismo patrón que useAgentLeads/useAgentProfile.
        .select('user_id, users(id, user_preferences(full_name, profile_photo_url))' as never)
        .eq('agency_id', resolved_agency_id)
        .eq('member_role', 'agent')
        .eq('status', 'active');

      if (ignore) return;

      if (query_error) {
        set_error(query_error.message);
        set_agents([]);
        set_loading(false);
        return;
      }

      const raw_data = (data as unknown as RawAgencyMemberRow[] | null) ?? [];
      set_agents(sort_by_full_name(raw_data.map(transform_raw_to_agent)));
      set_error(null);
      set_loading(false);
    }

    void fetch_agents();

    return () => {
      ignore = true;
    };
  }, [agencyId, enabled]);

  return { agents, loading, error };
}
