/**
 * useAgentStats — hook de counts para el header de perfil (publicaciones/leads/cerrados).
 *
 * Devuelve { loading, stats } con los 3 counts del agente, vía 3 queries en
 * paralelo (Promise.all) usando count exact + head:true (no trae filas).
 *
 * Queries (orden real de supabase-js: .select() con opciones de count
 * PRIMERO, filtros después — ver usePropertiesGrid):
 *   1. publications = properties .select('id', { count:'exact', head:true })
 *        .eq('owner_user_id', agent_id).in('status', ['active','paused']).is('deleted_at', null)
 *   2. leads        = leads .select('id', { count:'exact', head:true })
 *        .eq('agent_id', agent_id).is('deleted_at', null)
 *   3. closed       = leads .select('id', { count:'exact', head:true })
 *        .eq('agent_id', agent_id).in('status', ['closed_won','closed_lost']).is('deleted_at', null)
 *
 * Error handling: degradación graceful — si cualquier query falla (error !=
 * null o el try/catch atrapa una excepción), expone
 * { publications: 0, leads: 0, closed: 0 } sin throw.
 *
 * Patrón: useState + useEffect con flag `ignore` (igual que usePropertiesGrid).
 */

import { useState, useEffect } from 'react';

import { supabase } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface AgentStats {
  publications: number;
  leads: number;
  closed: number;
}

export interface UseAgentStatsState {
  loading: boolean;
  stats: AgentStats | null;
}

const ZERO_STATS: AgentStats = { publications: 0, leads: 0, closed: 0 };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga los counts de publicaciones/leads/cerrados de un agente.
 * Re-fetches automáticamente si `agent_id` cambia.
 */
export function useAgentStats(agent_id: string): UseAgentStatsState {
  const [state, set_state] = useState<UseAgentStatsState>({
    loading: true,
    stats: null,
  });

  useEffect(() => {
    // Flag de cancelación — evita setState en componente ya desmontado.
    let ignore = false;

    async function fetch_stats(): Promise<void> {
      try {
        const [publications_result, leads_result, closed_result] = await Promise.all([
          supabase
            .from('properties')
            .select('id', { count: 'exact', head: true })
            .eq('owner_user_id', agent_id)
            .in('status', ['active', 'paused'])
            .is('deleted_at', null),
          supabase.from('leads').select('id', { count: 'exact', head: true }).eq('agent_id', agent_id).is('deleted_at', null),
          supabase
            .from('leads')
            .select('id', { count: 'exact', head: true })
            .eq('agent_id', agent_id)
            .in('status', ['closed_won', 'closed_lost'])
            .is('deleted_at', null),
        ]);

        if (ignore) return;

        if (publications_result.error || leads_result.error || closed_result.error) {
          set_state({ loading: false, stats: ZERO_STATS });
          return;
        }

        set_state({
          loading: false,
          stats: {
            publications: publications_result.count ?? 0,
            leads: leads_result.count ?? 0,
            closed: closed_result.count ?? 0,
          },
        });
      } catch {
        if (ignore) return;
        set_state({ loading: false, stats: ZERO_STATS });
      }
    }

    void fetch_stats();

    return () => {
      ignore = true;
    };
  }, [agent_id]);

  return state;
}
