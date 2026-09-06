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
 */
export const CRM_TREND_WINDOW_DAYS = 3;

export function format_degrees(_t: number): string {
  throw new Error('not implemented');
}

export function format_delta(_delta: number, _days: number = CRM_TREND_WINDOW_DAYS): string {
  throw new Error('not implemented');
}

export function temperature_color(_t: number): string {
  // ponytail: referencia a colors para que el import no quede "sin uso" en el stub.
  void colors;
  throw new Error('not implemented');
}
