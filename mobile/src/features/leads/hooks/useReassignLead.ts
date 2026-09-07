/**
 * useReassignLead — STUB mínimo (fase RED, subtarea 269.5). Lanza a
 * propósito; la implementación real es el GREEN. Contrato completo (SEAMS,
 * decisiones D-XXX, edge cases) en __tests__/useReassignLead.test.tsx — no
 * se repite aquí. RPC `reassign_lead_atomic` (migración 20260906400002).
 */

export interface UseReassignLeadOptions {
  /** Callback invocado tras un reasignado exitoso (p.ej. refetch del overview). */
  on_changed?: () => void;
}

export type ReassignLeadResult = { ok: true } | { ok: false; message: string | null };

export interface UseReassignLeadReturn {
  reassign(lead_id: string, to_agent: string): Promise<ReassignLeadResult>;
  busy: boolean;
}

export function useReassignLead(_options?: UseReassignLeadOptions): UseReassignLeadReturn {
  throw new Error('not_implemented');
}
