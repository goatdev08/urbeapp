/**
 * useAgencyRole — determina si el usuario autenticado es owner de su agencia.
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
 * Patrón: useState/useEffect con flag `ignore` (idéntico a useAgentLeads).
 * `agency_members` está en los tipos generados de Supabase — sin cast `as never`.
 */

import { useState, useEffect } from 'react';

import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/features/auth/context';

export interface UseAgencyRoleState {
  isOwner: boolean;
  agencyId: string | null;
  memberRole: 'owner' | 'agent' | null;
  loading: boolean;
}

export function useAgencyRole(): UseAgencyRoleState {
  const { user } = useAuth();

  const [isOwner, set_is_owner] = useState(false);
  const [agencyId, set_agency_id] = useState<string | null>(null);
  const [memberRole, set_member_role] = useState<'owner' | 'agent' | null>(null);
  const [loading, set_loading] = useState(true); // inicia en true — EC-5

  useEffect(() => {
    // Flag de cancelación — evita setState tras desmontaje
    let ignore = false;

    async function fetch_agency_role(): Promise<void> {
      // ponytail: sin user_id no hay nada que consultar — estado seguro.
      if (!user?.id) {
        if (!ignore) {
          set_is_owner(false);
          set_agency_id(null);
          set_member_role(null);
          set_loading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from('agency_members')
        .select('member_role, agency_id')
        .eq('user_id', user.id)
        .eq('status', 'active');

      if (ignore) return;

      // Error o sin fila activa → estado seguro (EC-3, EC-4)
      const row = !error ? (data?.[0] ?? null) : null;

      set_is_owner(row?.member_role === 'owner');
      set_agency_id(row?.agency_id ?? null);
      set_member_role(row?.member_role ?? null);
      set_loading(false);
    }

    void fetch_agency_role();

    return () => {
      ignore = true;
    };
  }, [user?.id]);

  return { isOwner, agencyId, memberRole, loading };
}
