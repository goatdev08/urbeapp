/**
 * useLeadRawFields — teléfono de contacto Y status crudo de un lead del CRM
 * (subtarea 275.1, tarea #275 "hardening(267.6)", renombrado de
 * useLeadPhone — el nombre viejo mentía en cuanto empezó a devolver status).
 *
 * Las RPC del CRM (crm_lead_detail, lead_activity, crm_suggested_message,
 * crm_leads_page) no exponen ni `phone` (dato sensible, solo para el botón de
 * WhatsApp) ni el `status` CRUDO del enum lead_status (solo exponen
 * `status_projected`, la proyección 8→4). Ambos se leen en el MISMO embed
 * puntual, ya probado bajo RLS en useAgentLeads.ts (el flujo viejo, se borró
 * en 267.7):
 *   supabase.from('leads')
 *     .select('status, users!leads_user_id_fkey(phone)')
 *     .eq('id', leadId)
 *     .is('deleted_at', null)
 *     .maybeSingle()
 * El hint `users!leads_user_id_fkey` es obligatorio: `leads` tiene dos FKs a
 * `users` (agent_id y user_id) y sin el hint PostgREST no sabe cuál usar.
 * Molde de estado/ciclo de vida: useCrmSuggestedMessage.ts. Contrato
 * completo (SEAMS, decisiones D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useLeadRawFields.test.ts — no se
 * repite aquí.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

import type { LeadStatus } from '../types';

export interface UseLeadRawFieldsState {
  phone: string | null;
  status: LeadStatus | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar el teléfono del lead.';

export function useLeadRawFields(leadId: string | null | undefined): UseLeadRawFieldsState {
  const [phone, set_phone] = useState<string | null>(null);
  // STUB RED (275.1): falta exponer el status real — se hardcodea a null
  // hasta el GREEN, que también añade 'status' al string de .select(...).
  const [status] = useState<LeadStatus | null>(null);
  const [loading, set_loading] = useState(Boolean(leadId));
  const [error, set_error] = useState<string | null>(null);

  const mounted_ref = useRef(true);
  // D-SEQ (guardian 267.6): token de petición — una respuesta tardía de un
  // leadId ANTERIOR nunca pisa el teléfono del lead actual (PII cruzada: el
  // botón de WhatsApp marcaría al contacto equivocado). Seguridad, fuera de
  // ponytail.
  const seq_ref = useRef(0);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  const fetch_phone = useCallback(async (): Promise<void> => {
    if (!leadId) {
      set_phone(null);
      set_loading(false);
      set_error(null);
      return;
    }

    set_loading(true);
    const seq = ++seq_ref.current;

    let query_result: {
      data: { users: { phone: string | null } | null } | null;
      error: { message: string } | null;
    };
    try {
      query_result = (await supabase
        .from('leads')
        // STUB RED (275.1): falta 'status, ' al frente del select.
        .select('users!leads_user_id_fkey(phone)')
        .eq('id', leadId)
        .is('deleted_at', null)
        .maybeSingle()) as typeof query_result;
    } catch {
      // Rechazo real de red (offline): misma salida neutra que un error de
      // PostgREST — sin esto `loading` quedaría en true para siempre.
      query_result = { data: null, error: { message: 'network' } };
    }

    if (!mounted_ref.current || seq !== seq_ref.current) return;

    if (query_result.error) {
      set_error(ERROR_MESSAGE);
      set_phone(null);
      set_loading(false);
      return;
    }

    // D-MAP: el embed many-to-one puede llegar sin fila (D-SINFILA, RLS o
    // deleted_at) o con `users` null (usuario borrado) — nunca se asume la
    // forma, siempre se resuelve a phone null sin error.
    set_phone(query_result.data?.users?.phone ?? null);
    set_error(null);
    set_loading(false);
  }, [leadId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch_phone hace setState tras el await de la query (o sincrónico solo en el guard sin leadId); molde useCrmSuggestedMessage.ts.
    void fetch_phone();
  }, [fetch_phone]);

  const refetch = useCallback(() => fetch_phone(), [fetch_phone]);

  return { phone, status, loading, error, refetch };
}
