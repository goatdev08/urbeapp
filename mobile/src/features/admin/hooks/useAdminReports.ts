/**
 * useAdminReports — cola de reportes de propiedad (property_reports con
 * status='new'), AGRUPADA POR PROPIEDAD, para el panel admin (módulo 041-M2,
 * tarea #220, subtarea 220.4). Fase RED. El contrato completo (firma, 14 edge
 * cases) vive en
 * mobile/src/features/admin/__tests__/useAdminReports.test.tsx — es el
 * archivo que fija el comportamiento; este archivo lo implementa sin
 * renegociarlo.
 *
 * STUB — sin lógica. `useAdminReports` lanza `not_implemented`; el GREEN de
 * 220.4 lo reemplaza calcando useAdminRevisions.ts (218.1: query única
 * .from('property_reports').select(...).eq('status','new').order('created_at',
 * {ascending:false}) + agrupación por property_id).
 */

export interface AdminReportPropertySnapshot {
  id: string;
  address: string;
  operation_type: string;
  property_type: string;
  price: number;
  status: string;
}

export interface AdminReportEntry {
  report_id: string;
  reason: string;
  reason_text: string | null;
  reported_by_user_id: string;
  created_at: string;
}

export interface AdminReportQueueItem {
  property_id: string;
  property: AdminReportPropertySnapshot;
  reports: AdminReportEntry[];
  report_count: number;
}

export interface UseAdminReportsResult {
  reports: AdminReportQueueItem[] | null;
  is_loading: boolean;
  error_message: string | null;
  refetch: () => void;
}

export function useAdminReports(): UseAdminReportsResult {
  throw new Error('not_implemented');
}
