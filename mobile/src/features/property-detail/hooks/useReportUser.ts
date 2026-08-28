/**
 * useReportUser — STUB fase RED (subtarea 220.6, tarea #220, módulo 041-M3).
 * Implementación real pendiente (GREEN). Contrato completo y los 18 edge
 * cases están en el docblock de
 * mobile/src/features/property-detail/__tests__/useReportUser.test.tsx.
 *
 * Sibling hook de useReportProperty (220.5) — decisión ponytail (subtarea
 * 220.6): NO se generalizó el hook existente a `target: property|user` porque
 * useReportProperty ya está GREEN y mergeado (ActionButtons lo consume en
 * producción); enhebrar una unión discriminada ahí habría tocado código ya
 * probado/desplegado y sus call sites, para ahorrar ~30 líneas de
 * ramificación — MÁS código movido y MÁS riesgo que este archivo sibling, que
 * es aditivo puro y no toca nada existente. El SHEET (ReportPropertySheet) SÍ
 * se reusa sin bifurcar — solo gana un prop `title` opcional.
 *
 * 🔴 STUB — sin lógica. Lanza para que cualquier test que SÍ invoque el hook
 * falle por excepción (assertion), no por import roto.
 */

export type UserReportReason =
  | 'not_exist_fraud'
  | 'misleading'
  | 'false_price'
  | 'wrong_address'
  | 'inappropriate'
  | 'duplicate'
  | 'other';

export interface UseReportUserParams {
  reported_user_id: string;
  supabase?: any;
}

export interface SubmitUserReportInput {
  reason: UserReportReason;
  reason_text?: string;
}

export type SubmitUserReportResult = { ok: true } | { ok: false };

export interface UseReportUserReturn {
  submit_report(input: SubmitUserReportInput): Promise<SubmitUserReportResult>;
  is_submitting: boolean;
  error_message: string | null;
}

export function useReportUser(_params: UseReportUserParams): UseReportUserReturn {
  throw new Error('not_implemented');
}
