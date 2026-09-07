/**
 * format_response_time — GREEN (subtarea 269.5). Formatea `response_hours`
 * de public.crm_agency_overview (migración 20260906400001) para la columna
 * "responde en" de la fila de agente. Contrato completo (fórmula D-FMT,
 * bordes exactos) en __tests__/format_response_time.test.ts.
 */
export function format_response_time(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours)} h`;
  return `${Math.round(hours / 24)} d`;
}
