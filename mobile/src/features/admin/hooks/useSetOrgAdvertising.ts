// STUB fase RED (209.3) — sin implementación. El GREEN lo reemplaza.
import type { AdvertiserCategory } from '../components/advertiser-category-select';

export interface SetOrgAdvertisingParams {
  agency_id: string;
  enabled: boolean;
  category?: AdvertiserCategory;
}

export interface SetOrgAdvertisingResult {
  ok: boolean;
  error: string | null;
}

export interface UseSetOrgAdvertisingDeps {
  supabase?: unknown;
  onSuccess?: () => void;
}

export interface UseSetOrgAdvertisingReturn {
  setAdvertising(params: SetOrgAdvertisingParams): Promise<SetOrgAdvertisingResult>;
  is_saving: boolean;
  error: string | null;
}

export function useSetOrgAdvertising(_deps?: UseSetOrgAdvertisingDeps): UseSetOrgAdvertisingReturn {
  void _deps;
  return {
    setAdvertising: async () => ({ ok: false, error: null }),
    is_saving: false,
    error: null,
  };
}
