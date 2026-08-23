// STUB fase RED (208.2) — sin implementación. El GREEN lo reemplaza.
export interface ModerateResult {
  ok: boolean;
  error: string | null;
}

export interface UseModerateAdDeps {
  supabase?: unknown;
  onSuccess?: () => void;
}

export interface UseModerateAdReturn {
  approve(ad_id: string): Promise<ModerateResult>;
  reject(ad_id: string, rejection_reason: string): Promise<ModerateResult>;
  is_moderating: boolean;
  error: string | null;
}

export function useModerateAd(_deps?: UseModerateAdDeps): UseModerateAdReturn {
  void _deps;
  return {
    approve: async () => ({ ok: false, error: null }),
    reject: async () => ({ ok: false, error: null }),
    is_moderating: false,
    error: null,
  };
}
