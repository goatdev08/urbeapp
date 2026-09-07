/**
 * useCrmFunnel — 5 KPIs agregados del embudo del CRM (subtarea 266.7, GREEN).
 * Contrato completo (SEAMS, params exactos, decisiones D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmFunnel.test.ts — no se repite
 * aquí. RPC `crm_funnel` (migración 20260906100003).
 *
 * Molde: refetch por foco de useAgentProfile.ts (useFocusEffect +
 * useCallback) + una sola llamada supabase.rpc de useLeadStats.ts.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import type { CrmFunnel } from '../types';

export interface UseCrmFunnelState {
  data: CrmFunnel | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar el embudo del CRM. Intenta de nuevo.';

export function useCrmFunnel(agentId: string | null | undefined, days: number): UseCrmFunnelState {
  const [data, set_data] = useState<CrmFunnel | null>(null);
  const [loading, set_loading] = useState(Boolean(agentId));
  const [error, set_error] = useState<string | null>(null);

  const mounted_ref = useRef(true);
  // D-SEQ (guardian 267.6/269.5, molde useCrmLeadDetail.ts): token de
  // petición — una respuesta tardía de un agentId/days ANTERIOR (o de un
  // refoco superado) no pisa el embudo vigente.
  const seq_ref = useRef(0);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  const fetch_funnel = useCallback(async (): Promise<void> => {
    if (!agentId) {
      // D-SEQ: bump ANTES de los resets — invalida cualquier petición en
      // vuelo del agentId anterior.
      ++seq_ref.current;
      set_data(null);
      set_loading(false);
      set_error(null);
      return;
    }

    set_loading(true);
    const seq = ++seq_ref.current;

    // D-DAYS-EXPLICIT: p_days siempre explícito (precedente 266.5).
    let rpc_result: { data: CrmFunnel[] | null; error: { message: string } | null };
    try {
      rpc_result = (await supabase.rpc('crm_funnel', {
        p_agent_id: agentId,
        p_days: days,
      })) as typeof rpc_result;
    } catch {
      // Rechazo real de red (offline): sin esto la promesa queda sin
      // manejar y `loading` no vuelve a bajar (bug confirmado por el
      // guardian en 269.5).
      rpc_result = { data: null, error: { message: 'network' } };
    }

    if (!mounted_ref.current || seq !== seq_ref.current) return;

    if (rpc_result.error) {
      set_error(ERROR_MESSAGE);
      set_data(null);
      set_loading(false);
      return;
    }

    const row = (rpc_result.data ?? [])[0] ?? null;
    set_data(
      row
        ? {
            vieron: row.vieron,
            volvieron: row.volvieron,
            guardaron: row.guardaron,
            contactaron: row.contactaron,
            agendaron: row.agendaron,
          }
        : null,
    );
    set_error(null);
    set_loading(false);
  }, [agentId, days]);

  // D-FOCUS: el primer foco coincide con el mount; un refoco real o un
  // cambio de agentId/days (recrea fetch_funnel) redispara la RPC.
  useFocusEffect(
    useCallback(() => {
      void fetch_funnel();
    }, [fetch_funnel]),
  );

  const refetch = useCallback(() => fetch_funnel(), [fetch_funnel]);

  return { data, loading, error, refetch };
}
