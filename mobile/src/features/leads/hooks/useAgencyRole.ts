/**
 * useAgencyRole — determina si el usuario autenticado es owner de su agencia.
 * Subtarea 28.1 — fase RED (STUB).
 *
 * Contrato (schema migración 0003 + 0008 helpers RLS):
 *   - Query: from('agency_members').select('member_role, agency_id')
 *       .eq('user_id', <auth uid>).eq('status', 'active')
 *   - El rol de agencia vive SOLO en agency_members.member_role
 *     (NO en users.role, que es 'agent' incluso para owners — ver seed).
 *   - isOwner = memberRole === 'owner'.
 *   - Sin fila activa → { isOwner: false, agencyId: null, memberRole: null }.
 *   - Error de query → estado seguro, sin crash.
 *
 * STUB mínimo — la fase GREEN implementará la query real con
 * useState/useEffect (patrón useAgentLeads, flag `ignore`).
 * Valores fijos deliberados para que el RED falle por ASERCIÓN, no por import.
 */

// ponytail: stub RED — no importa supabase/useAuth aún; la fase GREEN los añade.

export interface UseAgencyRoleState {
  isOwner: boolean;
  agencyId: string | null;
  memberRole: 'owner' | 'agent' | null;
  loading: boolean;
}

export function useAgencyRole(): UseAgencyRoleState {
  // ponytail: valores estáticos incorrectos a propósito — no consultan agency_members.
  // Fuerzan fallo por aserción en todos los casos (owner/agent/vacío/error/loading/status).
  return {
    isOwner: true,
    memberRole: 'owner',
    agencyId: 'stub-not-implemented',
    loading: false,
  };
}
