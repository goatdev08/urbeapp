/**
 * useLeadPhone — STUB fase RED (subtarea 267.6, tarea #267 "CRM UI agente").
 *
 * Contrato completo (SEAMS, query exacta, decisiones D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useLeadPhone.test.ts — no se repite
 * aquí. La fase GREEN implementa la lógica real.
 */

export interface UseLeadPhoneState {
  phone: string | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useLeadPhone(_leadId: string | null | undefined): UseLeadPhoneState {
  throw new Error('not_implemented');
}
