/**
 * useAgentStats — hook de counts para el header de perfil.
 *
 * Devuelve { loading, stats } con los counts del agente, en queries paralelas
 * (Promise.all).
 *
 * ⚠️ 180.1 — `leads` SALIÓ del header por completo (y con él la opción
 * `include_leads` de 179.1): es un dato de gestión que solo se consulta en el
 * CRM y solo el dueño de la cuenta. El header quedó:
 *   - perfil propio: Publicaciones · Guardados · Me gusta
 *   - perfil ajeno:  Publicaciones · Me gusta
 *
 * ⚠️ 179.1 — antes ya había salido `closed`. Ni `closed` ni `leads` se
 * pierden: el CRM tiene su propio RPC get_lead_stats (migración
 * 20260808000002). Lo que entró en su lugar fue `saves`/`likes`.
 *
 * Queries (orden real de supabase-js: .select() con opciones de count
 * PRIMERO, filtros después — ver usePropertiesGrid):
 *   1. publications = properties .select('id', { count:'exact', head:true })
 *        .eq('owner_user_id', agent_id).in('status', ['active','paused']).is('deleted_at', null)
 *   2. sums         = properties .select('save_count, like_count')
 *        (mismos filtros) — ÚNICA query que trae filas; se suman en cliente.
 *

 * ponytail: la suma se hace en cliente con un reduce sobre las MISMAS pocas
 *   filas que ya cuenta la query 1 (las publicaciones visibles de un agente),
 *   en vez de un RPC de agregación — cero backend nuevo y los contadores ya
 *   los mantiene el trigger de la migración 20260701000001. Techo conocido: si
 *   un agente llegara a cientos de publicaciones convendría un RPC.
 *
 * Error handling: degradación graceful — si cualquier query falla (error !=
 * null o el try/catch atrapa una excepción), expone ZERO_STATS sin throw.
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
  /** Suma de properties.save_count de las publicaciones visibles del agente. */
  saves: number;
  /** Suma de properties.like_count de las publicaciones visibles del agente. */
  likes: number;
}

export interface UseAgentStatsState {
  loading: boolean;
  stats: AgentStats | null;
}

const ZERO_STATS: AgentStats = { publications: 0, saves: 0, likes: 0 };

/** Estados de publicación que cuentan como "visibles" en el perfil. */
const VISIBLE_STATUSES = ['active', 'paused'] as const;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga los counts del header de perfil de un agente.
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
        const [publications_result, sums_result] = await Promise.all([
          supabase
            .from('properties')
            .select('id', { count: 'exact', head: true })
            .eq('owner_user_id', agent_id)
            .in('status', VISIBLE_STATUSES)
            .is('deleted_at', null),
          supabase
            .from('properties')
            .select('save_count, like_count')
            .eq('owner_user_id', agent_id)
            .in('status', VISIBLE_STATUSES)
            .is('deleted_at', null),
        ]);

        if (ignore) return;

        if (publications_result.error || sums_result.error) {
          set_state({ loading: false, stats: ZERO_STATS });
          return;
        }

        const totals = (sums_result.data ?? []).reduce(
          (acc, row) => ({
            saves: acc.saves + (row.save_count ?? 0),
            likes: acc.likes + (row.like_count ?? 0),
          }),
          { saves: 0, likes: 0 },
        );

        set_state({
          loading: false,
          stats: {
            publications: publications_result.count ?? 0,
            saves: totals.saves,
            likes: totals.likes,
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
