/**
 * useCrmLeadsPage — STUB mínimo, fase RED (subtarea 266.7).
 * Contrato completo (SEAMS, params exactos, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmLeadsPage.test.ts.
 * La implementación real llega en el GREEN de esta subtarea.
 */

import type { CrmBand, CrmLeadRow } from '../types';

export interface UseCrmLeadsPageState {
  data: CrmLeadRow[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  remaining: number | null;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useCrmLeadsPage(
  agentId: string | null | undefined,
  band: CrmBand | null,
  query: string | null,
): UseCrmLeadsPageState {
  void agentId;
  void band;
  void query;
  throw new Error('not_implemented');
}
