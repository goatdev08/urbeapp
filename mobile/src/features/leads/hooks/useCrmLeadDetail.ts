/**
 * useCrmLeadDetail — cabecera de la ficha expandida de un lead (subtarea
 * 266.7, GREEN). Contrato completo (SEAMS, params exactos, decisiones
 * D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmLeadDetail.test.ts — no se
 * repite aquí. RPC `crm_lead_detail` (migración 20260906100004).
 *
 * Molde useLeadStats.ts: una sola llamada supabase.rpc, error neutro en
 * español, deps por contenido. Sin refetch por foco (PLAN 266.7).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { CrmLeadDetail } from '../types';

export interface UseCrmLeadDetailState {
  data: CrmLeadDetail | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar la ficha del lead. Intenta de nuevo.';

export function useCrmLeadDetail(leadId: string | null | undefined): UseCrmLeadDetailState {
  const [data, set_data] = useState<CrmLeadDetail | null>(null);
  const [loading, set_loading] = useState(Boolean(leadId));
  const [error, set_error] = useState<string | null>(null);

  const mounted_ref = useRef(true);
  // D-SEQ (guardian 267.6/269.5, molde useLeadRawFields.ts): token de
  // petición — una respuesta tardía de un leadId ANTERIOR no pisa la ficha
  // del lead actual (dato cruzado en pantalla).
  const seq_ref = useRef(0);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  const fetch_detail = useCallback(async (): Promise<void> => {
    if (!leadId) {
      set_data(null);
      set_loading(false);
      set_error(null);
      return;
    }

    set_loading(true);
    const seq = ++seq_ref.current;

    let rpc_result: { data: CrmLeadDetail[] | null; error: { message: string } | null };
    try {
      rpc_result = (await supabase.rpc('crm_lead_detail', {
        p_lead_id: leadId,
      })) as typeof rpc_result;
    } catch {
      // Rechazo real de red (offline): sin esto la promesa queda sin manejar
      // y `loading` no vuelve a bajar (bug confirmado por el guardian en
      // 269.5).
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
    // D-SINFILA: 0 filas (fail-closed de la RPC: no autorizado o lead
    // borrado) → data null SIN error — anti-IDOR, nunca se distingue "no
    // existe" de "no es tuyo".
    set_data(
      row
        ? {
            origin_property: row.origin_property,
            other_properties: row.other_properties,
            suggested_next_status: row.suggested_next_status,
          }
        : null,
    );
    set_error(null);
    set_loading(false);
  }, [leadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch_detail hace setState tras el await de la RPC (o sincrónico solo en el guard sin leadId); molde useMyProperties.ts.
    void fetch_detail();
  }, [fetch_detail]);

  const refetch = useCallback(() => fetch_detail(), [fetch_detail]);

  return { data, loading, error, refetch };
}
