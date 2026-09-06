/**
 * useCrmSuggestedMessage — mensaje sugerido de WhatsApp para un lead del CRM
 * (subtarea 267.4, tarea #267 "CRM UI agente", RED 2026-09-06).
 *
 * STUB — la implementación real (GREEN) llama a la RPC escalar
 * `crm_suggested_message` (migración 20260906200001_crm_suggested_message.sql,
 * subtarea 267.4) con el molde EXACTO de useCrmLeadDetail.ts (useLeadStats:
 * una sola llamada supabase.rpc, error neutro en español, deps por
 * contenido). Contrato completo (SEAMS, params exactos, decisiones D-XXX,
 * edge cases) en
 * mobile/src/features/leads/__tests__/useCrmSuggestedMessage.test.ts — no se
 * repite aquí.
 */

export interface UseCrmSuggestedMessageState {
  message: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCrmSuggestedMessage(
  _leadId: string | null | undefined,
): UseCrmSuggestedMessageState {
  throw new Error('not_implemented');
}
