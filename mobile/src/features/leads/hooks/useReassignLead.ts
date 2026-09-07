/**
 * useReassignLead — reasigna un lead a otro agente de la agencia (subtarea
 * 269.5). Contrato completo (SEAMS, decisiones D-XXX, edge cases) en
 * __tests__/useReassignLead.test.tsx — no se repite aquí. RPC
 * `reassign_lead_atomic` (migración 20260906400002).
 *
 * Molde EXACTO: useReassignMemberProperties.ts (mismo dominio "reasignar",
 * mismo criterio error.message.includes(code), mismo is_working_ref que
 * GATEA la llamada — no solo la refleja). D-SIGNATURE de esta subtarea: sin
 * DI de supabase (a diferencia del molde) — importa el singleton vía
 * '@/lib/supabase/client', mismo patrón que useCrmFunnel/useCrmAgencyOverview.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { supabase } from '@/lib/supabase/client';

import {
  LEAD_EF_ERROR_MESSAGES,
  LEAD_EF_GENERIC_FALLBACK,
  LEAD_EF_NETWORK_FALLBACK,
} from '../lead_error_messages';

export interface UseReassignLeadOptions {
  /** Callback invocado tras un reasignado exitoso (p.ej. refetch del overview). */
  on_changed?: () => void;
}

export type ReassignLeadResult = { ok: true } | { ok: false; message: string | null };

export interface UseReassignLeadReturn {
  reassign(lead_id: string, to_agent: string): Promise<ReassignLeadResult>;
  busy: boolean;
}

// D-MAP: los 3 códigos EXTENDIDOS de esta subtarea en LEAD_EF_ERROR_MESSAGES.
// NOT_AUTHENTICATED es un código real de la RPC pero no está en esta lista →
// cae al fallback genérico (mismo criterio que useReassignMemberProperties).
const REASSIGN_ERROR_CODES = ['SAME_USER', 'TARGET_NOT_ACTIVE_MEMBER', 'LEAD_NOT_FOUND'] as const;

function message_for_reassign_error(raw: string): string {
  for (const code of REASSIGN_ERROR_CODES) {
    if (raw.includes(code)) return LEAD_EF_ERROR_MESSAGES[code] as string;
  }
  return LEAD_EF_GENERIC_FALLBACK;
}

export function useReassignLead(options?: UseReassignLeadOptions): UseReassignLeadReturn {
  // Molde useReassignMemberProperties: is_working_ref GATEA (no solo
  // refleja) + force_update síncrono ANTES del primer await. El getter en el
  // objeto retornado lee el valor ACTUAL de la ref (no una copia de estado),
  // así EC-12 observa busy=true en el mismo tick síncrono en que arranca.
  const is_working_ref = useRef(false);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  const reassign = useCallback(
    (lead_id: string, to_agent: string): Promise<ReassignLeadResult> => {
      // D-BUSY: un segundo reassign() mientras el primero sigue en vuelo es
      // un no-op.
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, message: null });
      }
      is_working_ref.current = true;
      force_update();

      return Promise.resolve(
        supabase.rpc('reassign_lead_atomic', { p_lead_id: lead_id, p_to_agent: to_agent }),
      ).then(
          ({ error }) => {
            is_working_ref.current = false;
            force_update();
            if (error) {
              return { ok: false as const, message: message_for_reassign_error(error.message) };
            }
            options?.on_changed?.();
            return { ok: true as const };
          },
          () => {
            // D-NETWORK: rechazo de la promesa (network/timeout) — mensaje
            // distinto del fallback genérico de código desconocido.
            is_working_ref.current = false;
            force_update();
            return { ok: false as const, message: LEAD_EF_NETWORK_FALLBACK };
          },
        );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [options?.on_changed],
  );

  return useMemo(() => {
    const r: UseReassignLeadReturn = {
      reassign,
      get busy() {
        return is_working_ref.current;
      },
    };
    return r;
  }, [reassign]);
}
