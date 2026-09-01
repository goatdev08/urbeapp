/**
 * waitForCreativeReady — espera acotada al estado real de un creativo (#230).
 *
 * Pieza central de la PRE-APROBACIÓN del wizard de anuncios: step1 deja
 * continuar en cuanto el binario llega al 100% (duración y peso ya pasaron el
 * pre-flight del cliente) y la transcodificación sigue en segundo plano; la
 * VERDAD del creativo se resuelve aquí, en el paso 5, antes de invocar
 * create_ad_campaign_atomic.
 *
 * Contrato (fijado por __tests__/waitForCreativeReady.test.ts, W1–W8):
 *   - 'ready' | 'failed' | 'failed_duration' → terminal, tal cual el checker.
 *   - 'uploading' | 'processing' | 'missing' → sigue en curso, reintenta.
 *   - checker LANZA → intento fallido REINTENTABLE (#229: cambiar de wifi
 *     durante la espera produce exactamente ese blip; nunca es terminal solo).
 *   - intentos agotados sin desenlace → 'timeout'.
 *   - is_cancelled() true tras cualquier await → 'cancelled', sin más llamadas.
 *   - Duerme ENTRE intentos, nunca antes del primero (mismo criterio que
 *     poll_until_resolved / verify_before_failing).
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

// Mismos defaults que el poll de useAdUpload (#229): ~2 min para los videos
// de hasta 2 min / 500 MB de #228.
const DEFAULT_ATTEMPTS = 40;
const DEFAULT_INTERVAL_MS = 3000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function wait_for_creative_ready(
  params: WaitForCreativeReadyParams,
): Promise<CreativeWaitOutcome> {
  const {
    cloudflare_uid,
    checker,
    attempts = DEFAULT_ATTEMPTS,
    interval_ms = DEFAULT_INTERVAL_MS,
    is_cancelled = () => false,
  } = params;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) {
      await sleep(interval_ms);
      if (is_cancelled()) return 'cancelled';
    }

    let status: AdCreativeCheckStatus;
    try {
      status = await checker(cloudflare_uid);
    } catch (err) {
      if (is_cancelled()) return 'cancelled';
      console.warn('[waitForCreativeReady] checker falló (reintentable):', err);
      continue;
    }
    if (is_cancelled()) return 'cancelled';

    if (status === 'ready') return 'ready';
    if (status === 'failed_duration') return 'failed_duration';
    if (status === 'failed') return 'failed';
    // 'uploading' | 'processing' | 'missing' → sigue en curso.
  }

  return 'timeout';
}
