/**
 * useAgentStats — hook de counts para el header de perfil (publicaciones/leads/cerrados).
 *
 * STUB fase RED (subtarea 23.1) — NO implementado todavía.
 * Firma pública definitiva; el cuerpo retorna un valor fijo para forzar RED
 * por aserción en los tests que ejercitan el comportamiento real.
 *
 * Firma esperada (ver plan de la subtarea):
 *   useAgentStats(agent_id: string): { loading: boolean; stats: AgentStats | null }
 *
 * Queries que implementará GREEN (Promise.all, count exact + head:true):
 *   1. publications = properties .eq('owner_user_id', agent_id)
 *        .in('status', ['active','paused']).is('deleted_at', null)
 *   2. leads        = leads .eq('agent_id', agent_id).is('deleted_at', null)
 *   3. closed       = leads .eq('agent_id', agent_id)
 *        .in('status', ['closed_won','closed_lost']).is('deleted_at', null)
 *
 * Error handling: degradación graceful — si cualquier query falla, expone
 * { publications: 0, leads: 0, closed: 0 } sin throw.
 */

export interface AgentStats {
  publications: number;
  leads: number;
  closed: number;
}

export interface UseAgentStatsState {
  loading: boolean;
  stats: AgentStats | null;
}

/**
 * STUB — no implementado. Retorna un valor fijo para que el módulo importe
 * (permite que los tests fallen por ASERCIÓN, no por import roto).
 */
export function useAgentStats(_agent_id: string): UseAgentStatsState {
  return { loading: false, stats: null };
}
