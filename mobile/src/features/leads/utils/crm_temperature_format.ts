/**
 * crm_temperature_format.ts — formateo puro de temperatura/delta del CRM.
 *
 * STUB mínimo — subtarea 267.3 (RED). La fase GREEN implementa el formateo
 * real (exploración 045 §7.3/§7.4, decisiones de Abraham 2026-09-06).
 */

import { colors } from '@/theme/theme';

/**
 * Ventana de tendencia por defecto en días — espeja coalesce(...,3) sobre
 * app_config.crm_trend_window_days
 * (supabase/migrations/20260906100003_crm_leads_page_funnel.sql:155-158).
 *
 * ponytail: espeja el default de app_config crm_trend_window_days
 * (coalesce(...,3) en supabase/migrations/20260906100003_crm_leads_page_funnel.sql:155-158);
 * techo: si el owner cambia la clave, la UI sigue diciendo "en 3 d" hasta exponerla por RPC.
 */
export const CRM_TREND_WINDOW_DAYS = 3;

/** Signo menos TIPOGRÁFICO (U+2212) — nunca el guion ASCII '-'. */
const MINUS_SIGN = '−';

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** "94°" — entero redondeado, clampado a [0, 100]. */
export function format_degrees(t: number): string {
  return `${clamp(Math.round(t), 0, 100)}°`;
}

/**
 * "+22 en 3 d" / "−5 en 3 d" / "sin cambio" — UNA plantilla por signo
 * (decisión de Abraham 2026-09-06); un delta que redondea a 0 no lleva signo.
 */
export function format_delta(delta: number, days: number = CRM_TREND_WINDOW_DAYS): string {
  const rounded = Math.round(delta);
  if (rounded === 0) return 'sin cambio';
  const sign = rounded > 0 ? '+' : MINUS_SIGN;
  return `${sign}${Math.abs(rounded)} en ${days} d`;
}

/** Color por escala continua del NÚMERO (no de la banda — ver crm_band_meta.band_color). */
export function temperature_color(t: number): string {
  const clamped = clamp(t, 0, 100);
  if (clamped <= 29) return colors.temp_silent;
  if (clamped <= 59) return colors.temp_warming;
  if (clamped <= 79) return colors.temp_cooling;
  return colors.temp_hot;
}
