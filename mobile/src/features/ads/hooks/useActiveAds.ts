/**
 * useActiveAds — lista de anuncios ACTIVOS para el takedown de emergencia del
 * admin (tarea #210, subtarea 210.3). Contrato completo y los 18 edge cases
 * están en el docblock de
 * mobile/src/features/ads/__tests__/useActiveAds.test.tsx — léelo antes de
 * tocar este archivo.
 *
 * 🔴 STUB DE COMPILACIÓN (RED #210.3): la implementación real es GREEN.
 */

export interface ActiveAd {
  id: string;
  title: string;
  description: string | null;
  agency_id: string;
  starts_at: string;
  ends_at: string;
  /** Embed PostgREST muchos-a-uno: bajar un anuncio sin saber de quién es, no. */
  agencies: { name: string } | null;
}

export interface UseActiveAdsResult {
  ads: ActiveAd[];
  loading: boolean;
  error: string | null;
  /** La pantalla la llama tras pausar/bajar un anuncio para refrescar sin desmontar. */
  refetch: () => Promise<void>;
}

export function useActiveAds(): UseActiveAdsResult {
  throw new Error('not_implemented');
}
