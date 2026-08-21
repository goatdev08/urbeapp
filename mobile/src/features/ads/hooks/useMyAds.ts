/**
 * useMyAds — STUB fase RED, subtarea 171.3.
 *
 * Contrato completo y los edge cases están fijados en el docblock de
 * mobile/src/features/ads/__tests__/useMyAds.test.tsx — léelo antes de
 * implementar. Este archivo es SOLO el stub mínimo para que el test falle
 * por ASERCIÓN, no por import ausente. Prohibido escribir lógica de negocio
 * aquí en la fase RED.
 */

export interface MyAd {
  id: string;
  title: string;
  status: string;
  starts_at: string;
  ends_at: string;
  paused_at: string | null;
  paused_by_suspension: boolean;
  rejection_reason: string | null;
}

export interface UseMyAdsResult {
  ads: MyAd[];
  agency_id: string | null;
  loading: boolean;
  error: string | null;
}

export function useMyAds(): UseMyAdsResult {
  throw new Error('not_implemented');
}
