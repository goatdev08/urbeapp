/**
 * useCrmSuggestedMessage — mensaje sugerido de WhatsApp para un lead del CRM
 * (subtarea 267.4, tarea #267 "CRM UI agente", GREEN).
 *
 * Llama a la RPC escalar `crm_suggested_message` (migración
 * 20260906200001_crm_suggested_message.sql, subtarea 267.4) con el molde
 * EXACTO de useCrmLeadDetail.ts (useLeadStats: una sola llamada
 * supabase.rpc, error neutro en español, deps por contenido). D-ESCALAR:
 * `rpc_result.data` es `string | null` DIRECTO — a diferencia de
 * crm_lead_detail (SETOF), sin indexar `[0]`. Contrato completo (SEAMS,
 * params exactos, decisiones D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmSuggestedMessage.test.ts — no se
 * repite aquí.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface UseCrmSuggestedMessageState {
  message: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar el mensaje sugerido.';

export function useCrmSuggestedMessage(
  leadId: string | null | undefined,
): UseCrmSuggestedMessageState {
  const [message, set_message] = useState<string | null>(null);
  const [loading, set_loading] = useState(Boolean(leadId));
  const [error, set_error] = useState<string | null>(null);

  const mounted_ref = useRef(true);
  // D-SEQ (guardian 267.6/269.5, molde useLeadRawFields.ts): token de
  // petición — una respuesta tardía de un leadId ANTERIOR no pisa el mensaje
  // sugerido del lead actual (dato cruzado en pantalla).
  const seq_ref = useRef(0);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  const fetch_message = useCallback(async (): Promise<void> => {
    if (!leadId) {
      // D-SEQ (275.4): bump ANTES de los resets — invalida cualquier
      // petición en vuelo del leadId anterior (si no, su respuesta tardía
      // pasa el guard del token y repuebla el estado que este guard acaba
      // de limpiar).
      ++seq_ref.current;
      set_message(null);
      set_loading(false);
      set_error(null);
      return;
    }

    set_loading(true);
    const seq = ++seq_ref.current;

    let rpc_result: { data: string | null; error: { message: string } | null };
    try {
      rpc_result = (await supabase.rpc('crm_suggested_message', {
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
      set_message(null);
      set_loading(false);
      return;
    }

    // D-SINMSG: data null (lead cerrado o no autorizado — D-AUTZ-SHARED
    // fail-closed de la RPC) → message null SIN error, anti-IDOR, mismo
    // criterio D-SINFILA de useCrmLeadDetail.
    set_message(rpc_result.data ?? null);
    set_error(null);
    set_loading(false);
  }, [leadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch_message hace setState tras el await de la RPC (o sincrónico solo en el guard sin leadId); molde useCrmLeadDetail.ts.
    void fetch_message();
  }, [fetch_message]);

  const refetch = useCallback(() => fetch_message(), [fetch_message]);

  return { message, loading, error, refetch };
}
