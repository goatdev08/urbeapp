/**
 * useResolveReport — resolver una propiedad reportada (restore|
 * request_changes|keep_suspended|delete, las 4 acciones NUEVAS de 220.3)
 * desde la cola de reportes del panel admin (módulo 041-M2, tarea #220,
 * subtarea 220.4). Fase RED. Contrato completo y los 22 edge cases están en
 * el docblock de
 * mobile/src/features/admin/__tests__/useResolveReport.test.tsx.
 *
 * STUB — sin lógica. `resolve` lanza `not_implemented`; el GREEN de 220.4 lo
 * reemplaza calcando useModerateProperty.ts (218.1: is_working_ref +
 * force_update síncrono, DI del cliente, run_action, client.functions.invoke
 * SIN desprender, extract_error_code + map_revision_error reusado de
 * revision_error_messages.ts — mismos 6 códigos relevantes salvo
 * NOTHING_TO_MODERATE, que esta rama no emite).
 */

export type ResolveReportAction =
  | 'restore'
  | 'request_changes'
  | 'keep_suspended'
  | 'delete';

export interface ResolveReportParams {
  property_id: string;
  action: ResolveReportAction;
  reason?: string;
}

export type ResolveReportResult =
  | { ok: true; status: string }
  | { ok: false; status: null };

export interface UseResolveReportDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — refresca la cola de reportes. */
  onSuccess?: () => void;
}

export interface UseResolveReportReturn {
  resolve(params: ResolveReportParams): Promise<ResolveReportResult>;
  is_submitting: boolean;
  error_message: string | null;
}

export function useResolveReport(
  deps?: UseResolveReportDeps,
): UseResolveReportReturn {
  throw new Error('not_implemented');
}
