/**
 * useAdStats — datos por anuncio para el dashboard del anunciante (tarea
 * #212, subtarea 212.3). STUB de fase RED — sin lógica de negocio, cada
 * export lanza para que la suite falle por aserción/excepción, no por
 * import. El contrato completo (firma, 25 edge cases del hook + los 4 de
 * `period_to_range`) vive en
 * mobile/src/features/ads/__tests__/useAdStats.test.tsx — léelo antes de
 * implementar el GREEN.
 *
 * Llama EN PARALELO las 3 RPCs de supabase/migrations/20260824000001_ad_stats_per_ad.sql
 * (ad_stats_totals / ad_stats_daily / ad_stats_zones), las 3 con
 * { p_ad_id, p_from, p_to } — p_from/p_to los calcula `period_to_range`.
 */

export type AdStatsPeriod = 'today' | 'last30' | 'max';

export interface AdStatsTotals {
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface AdStatsDailyPoint {
  /** 'YYYY-MM-DD', tal cual lo devuelve la RPC (columna `day`). */
  day: string;
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface AdStatsZoneRow {
  /** El bucket "otras zonas" es la fila con AMBOS campos null. */
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
}

/** Forma mínima del cliente que el hook necesita — nunca se desprende (#205). */
export type AdStatsSupabaseClient = {
  rpc: (
    fn: 'ad_stats_totals' | 'ad_stats_daily' | 'ad_stats_zones',
    params: { p_ad_id: string; p_from: string | null; p_to: string | null },
  ) => Promise<{ data: unknown[] | null; error: { code?: string; message: string } | null }>;
};

export interface UseAdStatsDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  client?: AdStatsSupabaseClient;
}

export interface UseAdStatsState {
  /** null mientras carga y ante error — JAMÁS ceros fabricados. */
  totals: AdStatsTotals | null;
  /** [] en carga, error, o éxito sin desglose diario. Orden: el que entregó la RPC. */
  daily: AdStatsDailyPoint[];
  /** [] en carga, error, o éxito sin desglose de zona. Incluye el bucket (NULL,NULL) tal cual. */
  zones: AdStatsZoneRow[];
  is_loading: boolean;
  /** Mensaje neutro en español, nunca error.message crudo (#200). null si no hay error. */
  error_message: string | null;
  refetch: () => void;
}

/**
 * period → { p_from, p_to } para las 3 RPCs. Pura (recibe `now` explícito,
 * nunca lee Date.now() internamente) para que sea testable sin fake timers.
 *
 *   'today'  → p_from = medianoche local del día de `now`, p_to = null.
 *   'last30' → p_from = now - 30 días exactos,             p_to = null.
 *   'max'    → p_from = null, p_to = null (sin rango).
 */
export function period_to_range(
  _period: AdStatsPeriod,
  _now: Date,
): { p_from: string | null; p_to: string | null } {
  throw new Error('not_implemented');
}

export function useAdStats(
  _ad_id: string | null,
  _period: AdStatsPeriod,
  _deps?: UseAdStatsDeps,
): UseAdStatsState {
  throw new Error('not_implemented');
}
