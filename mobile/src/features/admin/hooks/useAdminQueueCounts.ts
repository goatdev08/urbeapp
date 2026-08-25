/**
 * useAdminQueueCounts — counts vivos por cola para el home del panel admin
 * (tarea #217, subtarea 217.2).
 *
 * STUB fase RED — sin lógica de negocio. Lanza `not_implemented` para que los
 * tests fallen por aserción/excepción, no por import. Contrato completo (a
 * implementar en GREEN) fijado por el docblock de
 * mobile/src/features/admin/__tests__/useAdminQueueCounts.test.tsx — es el
 * archivo que fija el comportamiento; este archivo lo implementa sin
 * renegociarlo.
 *
 * Firma pública (NO renegociable sin dejar rastro en la bitácora):
 *   useAdminQueueCounts(): {
 *     counts: AdminQueueCounts | null;
 *     is_loading: boolean;
 *     error_message: string | null;
 *     refetch: () => void;
 *   }
 */

export interface AdminQueueCounts {
  ads_pending: number;
  revisions_pending: number;
  reports_new: number;
  agent_applications_pending: number;
  agencies_pending: number;
}

export interface UseAdminQueueCountsResult {
  counts: AdminQueueCounts | null;
  is_loading: boolean;
  error_message: string | null;
  refetch: () => void;
}

export function useAdminQueueCounts(): UseAdminQueueCountsResult {
  throw new Error('not_implemented');
}
