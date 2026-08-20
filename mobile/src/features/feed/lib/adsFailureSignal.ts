/** STUB (RED de #196) — sin implementación. El GREEN lo reemplaza. */

export const ADS_FETCH_FAILED_EVENT_TYPE = 'stub';

export type AdsFailureStage = 'config' | 'zone';

export interface AdsFailureStore {
  has_seen: (session_id: string, stage: AdsFailureStage) => boolean;
  mark_seen: (session_id: string, stage: AdsFailureStage) => void;
}

export function create_ads_failure_store(): AdsFailureStore {
  return { has_seen: () => false, mark_seen: () => undefined };
}

export interface AdsFailureClient {
  auth?: { getSession: () => Promise<unknown> };
  from: (table: string) => { insert: (row: unknown) => Promise<unknown> };
}

export async function report_ads_failure(_params: {
  client: AdsFailureClient;
  session_id: string;
  stage: AdsFailureStage;
  store: AdsFailureStore;
}): Promise<void> {
  return undefined;
}
