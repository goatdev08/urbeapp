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
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  const fetch_message = useCallback(async (): Promise<void> => {
    if (!leadId) {
      set_message(null);
      set_loading(false);
      set_error(null);
      return;
    }

    set_loading(true);

    const rpc_result = (await supabase.rpc('crm_suggested_message', {
      p_lead_id: leadId,
    })) as { data: string | null; error: { message: string } | null };

    if (!mounted_ref.current) return;

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
