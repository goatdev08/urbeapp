/** STUB (RED de 170.7) — sin implementación. El GREEN lo reemplaza. */

export const AD_IMPRESSION_BATCH_SIZE = 10;

export interface AdExposure {
  ad_id: string;
  session_id: string;
  shown_at: string;
  watched_ms: number;
  completed: boolean;
  lat: number;
  lng: number;
  device?: string | null;
}

export interface AdCtaTap {
  ad_id: string;
  session_id: string;
  cta_tapped_at: string;
}

export interface AdImpressionQueueDeps {
  supabase?: { functions: { invoke: (name: string, opts: unknown) => Promise<unknown> } };
}

export interface AdImpressionQueue {
  enqueue_impression: (exposure: AdExposure) => void;
  report_cta_tap: (tap: AdCtaTap) => void;
  flush: () => Promise<void>;
}

export function create_ad_impression_queue(_deps?: AdImpressionQueueDeps): AdImpressionQueue {
  return {
    enqueue_impression: () => undefined,
    report_cta_tap: () => undefined,
    flush: () => Promise.resolve(),
  };
}
