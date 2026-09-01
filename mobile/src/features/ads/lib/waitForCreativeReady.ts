/**
 * waitForCreativeReady — espera acotada al estado real de un creativo (#230).
 *
 * STUB RED — la implementación llega en el GREEN. Contrato completo en el
 * header de __tests__/waitForCreativeReady.test.ts.
 */
import type { AdCreativeCheckStatus } from '../hooks/useAdUpload';

export type CreativeWaitOutcome =
  | 'ready'
  | 'failed'
  | 'failed_duration'
  | 'timeout'
  | 'cancelled';

export interface WaitForCreativeReadyParams {
  cloudflare_uid: string;
  checker: (cloudflare_uid: string) => Promise<AdCreativeCheckStatus>;
  attempts?: number;
  interval_ms?: number;
  /** Cancelación cooperativa — se consulta tras cada await. */
  is_cancelled?: () => boolean;
}

export async function wait_for_creative_ready(
  _params: WaitForCreativeReadyParams,
): Promise<CreativeWaitOutcome> {
  return 'timeout';
}
