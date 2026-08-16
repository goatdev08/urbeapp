/**
 * useAgentStats — hook de counts para el header de perfil.
 *
 * Devuelve { loading, stats } con los counts del agente, en queries paralelas
 * (Promise.all).
 *
 * ⚠️ 179.1 — el header dejó de mostrar "Cerrados" y ahora muestra:
 *   - perfil propio: Publicaciones · Leads · Guardados
 *   - perfil ajeno:  Publicaciones · Guardados · Me gusta
 * `closed` salió del tipo (nadie más lo consumía; el CRM tiene su propio RPC
 * get_lead_stats, migración 20260808000002) y entraron `saves`/`likes`.
 *
 * Queries (orden real de supabase-js: .select() con opciones de count
 * PRIMERO, filtros después — ver usePropertiesGrid):
 *   1. publications = properties .select('id', { count:'exact', head:true })
 *        .eq('owner_user_id', agent_id).in('status', ['active','paused']).is('deleted_at', null)
 *   2. sums         = properties .select('save_count, like_count')
 *        (mismos filtros) — ÚNICA query que trae filas; se suman en cliente.
 *   3. leads        = leads .select('id', { count:'exact', head:true })
 *        .eq('agent_id', agent_id).is('deleted_at', null)
 *        SOLO si opts.include_leads !== false.
 *
 * ponytail: la suma se hace en cliente con un reduce sobre las MISMAS pocas
 *   filas que ya cuenta la query 1 (las publicaciones visibles de un agente),
 *   en vez de un RPC de agregación — cero backend nuevo y los contadores ya
 *   los mantiene el trigger de la migración 20260701000001. Techo conocido: si
 *   un agente llegara a cientos de publicaciones convendría un RPC.
 *
 * include_leads: `leads` es un dato PRIVADO — la RLS solo deja ver los propios,
 *   así que en un perfil ajeno la query devolvía 0 y el header pintaba
 *   "0 Leads" como si el agente no tuviera ninguno. En false ni se consulta.
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
  /** Privado: solo se consulta en el perfil propio (ver include_leads). */
  leads: number;
  /** Suma de properties.save_count de las publicaciones visibles del agente. */
  saves: number;
  /** Suma de properties.like_count de las publicaciones visibles del agente. */
  likes: number;
}

export interface UseAgentStatsOptions {
  /** false en perfiles ajenos: no se consulta la tabla leads. Default true. */
  include_leads?: boolean;
}

export interface UseAgentStatsState {
  loading: boolean;
  stats: AgentStats | null;
}

const ZERO_STATS: AgentStats = { publications: 0, leads: 0, saves: 0, likes: 0 };

/** Estados de publicación que cuentan como "visibles" en el perfil. */
const VISIBLE_STATUSES = ['active', 'paused'] as const;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga los counts del header de perfil de un agente.
 * Re-fetches automáticamente si `agent_id` o `include_leads` cambian.
 */
export function useAgentStats(
  agent_id: string,
  opts: UseAgentStatsOptions = {},
): UseAgentStatsState {
  const include_leads = opts.include_leads ?? true;

  const [state, set_state] = useState<UseAgentStatsState>({
    loading: true,
    stats: null,
  });

  useEffect(() => {
    // Flag de cancelación — evita setState en componente ya desmontado.
    let ignore = false;

    async function fetch_stats(): Promise<void> {
      try {
        const [publications_result, sums_result, leads_result] = await Promise.all([
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
          include_leads
            ? supabase
                .from('leads')
                .select('id', { count: 'exact', head: true })
                .eq('agent_id', agent_id)
                .is('deleted_at', null)
            : Promise.resolve({ count: 0, error: null }),
        ]);

        if (ignore) return;

        if (publications_result.error || sums_result.error || leads_result.error) {
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
            leads: leads_result.count ?? 0,
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
  }, [agent_id, include_leads]);

  return state;
}
