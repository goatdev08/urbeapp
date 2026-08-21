/**
 * useAdMetrics — RED stub (subtarea 171.2). SIN lógica de negocio todavía:
 * la implementación real llega en la fase GREEN. Este archivo solo fija la
 * firma pública para que
 * mobile/src/features/ads/__tests__/useAdMetrics.test.tsx falle por
 * ASERCIÓN/EXCEPCIÓN, nunca por `module not found`.
 *
 * Contrato completo (zones vs other_zones vs totals, null-vs-ceros,
 * anti-IDOR, race, etc.) documentado en el docblock del archivo de test —
 * léelo ANTES de implementar el GREEN.
 */

export interface AdZoneMetrics {
  municipality_id: string | null;
  neighborhood_id: number | null;
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface AdZoneTotals {
  impressions: number;
  views: number;
  cta_taps: number;
}

export interface UseAdMetricsState {
  /** Zonas REALES desglosadas, tal cual las devolvió la RPC. NUNCA incluye el bucket (NULL,NULL). */
  zones: AdZoneMetrics[];
  /** El bucket "otras zonas" (NULL,NULL) tal cual, o null si la RPC no lo devolvió. */
  other_zones: AdZoneTotals | null;
  /** Suma de zones + other_zones. null = desconocido (cargando o error) — NUNCA ceros por defecto. */
  totals: AdZoneTotals | null;
  loading: boolean;
  error: string | null;
}

export function useAdMetrics(_agencyId: string | null): UseAdMetricsState {
  throw new Error('not_implemented');
}
