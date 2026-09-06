/**
 * useCrmRadarAnon — STUB mínimo, fase RED (subtarea 266.7).
 * Contrato completo (SEAMS, params exactos, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmRadarAnon.test.ts.
 * La implementación real llega en el GREEN de esta subtarea.
 */

import type { CrmRadarRow } from '../types';

export interface UseCrmRadarAnonState {
  data: CrmRadarRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCrmRadarAnon(
  agentId: string | null | undefined,
  limit?: number | null,
): UseCrmRadarAnonState {
  void agentId;
  void limit;
  throw new Error('not_implemented');
}
