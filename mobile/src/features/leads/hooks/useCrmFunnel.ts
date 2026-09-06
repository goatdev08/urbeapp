/**
 * useCrmFunnel — STUB mínimo, fase RED (subtarea 266.7).
 * Contrato completo (SEAMS, params exactos, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmFunnel.test.ts.
 * La implementación real llega en el GREEN de esta subtarea.
 */

import type { CrmFunnel } from '../types';

export interface UseCrmFunnelState {
  data: CrmFunnel | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCrmFunnel(
  agentId: string | null | undefined,
  days: number,
): UseCrmFunnelState {
  void agentId;
  void days;
  throw new Error('not_implemented');
}
