/**
 * useAgencyRole — determina el rol del usuario autenticado en su agencia
 * (owner/admin/agent/viewer) y si puede ver el pipeline del equipo.
 *
 * Contrato (schema migración 0003 + 0008 helpers RLS + 20260805000002 Ola 1 #71):
 *   - Query: from('agency_members').select('member_role, agency_id')
 *       .eq('user_id', <auth uid>).eq('status', 'active')
 *   - El rol de agencia vive SOLO en agency_members.member_role
 *     (NO en users.role, que es 'agent' incluso para owners — ver seed).
 *   - isOwner = memberRole === 'owner'; isAdmin = memberRole === 'admin' (75.5).
 *   - canViewTeam = isOwner || isAdmin (75.5 — el admin de inmobiliaria también
 *     ve el pipeline del equipo, migración 20260807000005).
 *   - Sin fila activa → { isOwner: false, isAdmin: false, canViewTeam: false,
 *     agencyId: null, memberRole: null }.
 *   - Error de query → mismo estado seguro, PERO `error=true` lo distingue de
 *     "no hay membresía" (error=false) — ver ProfileScreen.tsx:83-87 para el
 *     defecto que esto corrige aquí (ese archivo sigue con el defecto viejo,
 *     fuera del alcance de 75.5).
 *   - `refetch()` (corrección code review, rama tarea/75): re-dispara la
 *     consulta — CRMScreen lo usa para ofrecer "Reintentar" cuando error=true
 *     en vez de dejar al usuario con la degradación silenciosa a agente.
 *
 * Patrón: useState/useEffect con flag `ignore` + tick counter para refetch
 * (idéntico a useAgentLeads/useLeadStatusHistory).
 * `agency_members` está en los tipos generados de Supabase — sin cast `as never`.
 */

import { useState, useEffect, useCallback } from 'react';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';

/**
 * Roles reales de agency_members (migración 20260805000002, Ola 1 #71): el
 * enum pasó de {owner,agent} a {owner,admin,agent,viewer}.
 */
export type AgencyMemberRole = 'owner' | 'admin' | 'agent' | 'viewer';

export interface UseAgencyRoleState {
  isOwner: boolean;
  /** true si el usuario es admin ACTIVO de su agencia (subtarea 75.5). */
  isAdmin: boolean;
  /**
   * true si el usuario puede ver el pipeline de TODO el equipo (owner o
   * admin) — conveniencia para no repetir `isOwner || isAdmin` en cada
   * consumidor (CRMScreen).
   */
  canViewTeam: boolean;
  agencyId: string | null;
  memberRole: AgencyMemberRole | null;
  loading: boolean;
  /**
   * true si la ÚLTIMA consulta de membresía falló (red/RLS) — distingue
   * "no pude saberlo" de "no hay membresía" (memberRole=null en AMBOS
   * casos, pero solo el error real debe marcar esta bandera).
   */
  error: boolean;
  /** Re-dispara la consulta de membresía (p.ej. botón "Reintentar" tras error). */
  refetch: () => void;
}

export function useAgencyRole(): UseAgencyRoleState {
  const { user } = useAuth();

  const [isOwner, set_is_owner] = useState(false);
  const [isAdmin, set_is_admin] = useState(false);
  const [agencyId, set_agency_id] = useState<string | null>(null);
  const [memberRole, set_member_role] = useState<AgencyMemberRole | null>(null);
  const [loading, set_loading] = useState(true); // inicia en true — EC-5
  const [error, set_error] = useState(false);
  // ponytail: tick counter como señal de refetch — mismo patrón que useAgentLeads.
  const [tick, set_tick] = useState(0);

  useEffect(() => {
    // Flag de cancelación — evita setState tras desmontaje
    let ignore = false;

    async function fetch_agency_role(): Promise<void> {
      if (!ignore) set_loading(true); // refetch (tick>0) también debe re-entrar en loading

      // ponytail: sin user_id no hay nada que consultar — estado seguro.
      if (!user?.id) {
        if (!ignore) {
          set_is_owner(false);
          set_is_admin(false);
          set_agency_id(null);
          set_member_role(null);
          set_error(false);
          set_loading(false);
        }
        return;
      }

      const { data, error: query_error } = await supabase
        .from('agency_members')
        .select('member_role, agency_id')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (ignore) return;

      // Error o sin fila activa → estado seguro (EC-3, EC-4) — pero el error
      // real SÍ se marca en `error` (EC-11), distinto de "sin membresía" (EC-12).
      const row = !query_error ? (data?.[0] ?? null) : null;

      set_is_owner(row?.member_role === 'owner');
      set_is_admin(row?.member_role === 'admin');
      set_agency_id(row?.agency_id ?? null);
      set_member_role(row?.member_role ?? null);
      set_error(query_error !== null && query_error !== undefined);
      set_loading(false);
    }

    void fetch_agency_role();

    return () => {
      ignore = true;
    };
  }, [user?.id, tick]);

  const refetch = useCallback(() => set_tick((t) => t + 1), []);

  return { isOwner, isAdmin, canViewTeam: isOwner || isAdmin, agencyId, memberRole, loading, error, refetch };
}
