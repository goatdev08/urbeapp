/**
 * useLeadActivity — STUB mínimo, fase RED (subtarea 266.7).
 * Contrato completo (SEAMS, params exactos, edge cases) en
 * mobile/src/features/leads/__tests__/useLeadActivity.test.ts.
 * La implementación real llega en el GREEN de esta subtarea.
 */

import type { LeadActivityEntry } from '../types';

export interface UseLeadActivityState {
  data: LeadActivityEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

export function useLeadActivity(leadId: string | null | undefined): UseLeadActivityState {
  void leadId;
  throw new Error('not_implemented');
}
