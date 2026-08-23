// STUB fase RED (208.2) — sin implementación. El GREEN lo reemplaza.
export interface PendingAd {
  id: string;
  title: string;
  description: string | null;
  agency_id: string;
  creative_id: string;
  cta_type: string;
  cta_value: string;
  starts_at: string;
  ends_at: string;
  created_at: string;
  agencies: { name: string } | null;
}

export interface UsePendingAdsResult {
  ads: PendingAd[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function usePendingAds(): UsePendingAdsResult {
  return { ads: [], loading: false, error: null, refetch: async () => {} };
}
