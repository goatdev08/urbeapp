/**
 * useCrmLeadDetail — STUB mínimo, fase RED (subtarea 266.7).
 * Contrato completo (SEAMS, params exactos, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmLeadDetail.test.ts.
 * La implementación real llega en el GREEN de esta subtarea.
 */

import type { CrmLeadDetail } from '../types';

export interface UseCrmLeadDetailState {
  data: CrmLeadDetail | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCrmLeadDetail(leadId: string | null | undefined): UseCrmLeadDetailState {
  void leadId;
  throw new Error('not_implemented');
}
