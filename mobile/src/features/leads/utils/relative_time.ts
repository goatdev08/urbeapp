/**
 * format_relative_time — tiempo relativo desde una fecha ISO hasta ahora
 * ("hace 2 h", "hace 3 d", etc.).
 *
 * Extraído de LeadCard.tsx (75.6) para reusarlo también en el timeline de
 * LeadExpandedView (useLeadStatusHistory) — misma regla de presentación,
 * un solo lugar.
 *
 * ponytail: función inline — sin dependencia nueva (no hay lib de fechas en
 * el repo). Techo conocido: granularidad en minutos/horas/días/meses (demo
 * suficiente).
 */
export function format_relative_time(iso_string: string): string {
  const diff_ms = Date.now() - new Date(iso_string).getTime();
  // Protección ante relojes desincronizados (diff negativo)
  if (diff_ms < 0) return 'ahora';
  const minutes = Math.floor(diff_ms / 60_000);
  if (minutes < 1)  return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30)    return `hace ${days} d`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}
