/**
 * Tests fase RED — wait_for_creative_ready (#230, pre-aprobación del wizard).
 * SUT: mobile/src/features/ads/lib/waitForCreativeReady.ts
 *
 * POR QUÉ EXISTE: con la pre-aprobación (#230) el wizard avanza al paso 2 en
 * cuanto el binario llega al 100% — la transcodificación sigue en segundo
 * plano y la VERDAD del creativo se resuelve en el paso 5, antes de invocar
 * create_ad_campaign_atomic. Esta función es esa espera: acotada, cancelable
 * y tolerante a blips de red (#229 — una excepción del checker NUNCA es
 * terminal por sí sola).
 *
 * CONTRATO:
 *   wait_for_creative_ready({ cloudflare_uid, checker, attempts=40,
 *     interval_ms=3000, is_cancelled }) → Promise<CreativeWaitOutcome>
 *   - 'ready' | 'failed' | 'failed_duration' → terminal, tal cual el checker.
 *   - 'uploading' | 'processing' | 'missing' → sigue en curso, reintenta.
 *   - checker LANZA → intento fallido reintentable (#229).
 *   - intentos agotados sin desenlace → 'timeout'.
 *   - is_cancelled() true tras cualquier await → 'cancelled' (sin más llamadas).
 *   - Duerme ENTRE intentos, nunca antes del primero (mismo criterio que
 *     poll_until_resolved / verify_before_failing).
 */

import {
  wait_for_creative_ready,
  type CreativeWaitOutcome,
} from '../lib/waitForCreativeReady';

const UID = 'stream-uid-wait-230';

function run(
  checker: jest.Mock,
  overrides: { attempts?: number; is_cancelled?: () => boolean } = {},
): Promise<CreativeWaitOutcome> {
  return wait_for_creative_ready({
    cloudflare_uid: UID,
    checker,
    attempts: overrides.attempts ?? 4,
    interval_ms: 0,
    ...(overrides.is_cancelled ? { is_cancelled: overrides.is_cancelled } : {}),
  });
}

describe('wait_for_creative_ready', () => {
  it('(W1) ready_al_primer_intento_devuelve_ready_con_una_sola_llamada', async () => {
    const checker = jest.fn().mockResolvedValue('ready');
    await expect(run(checker)).resolves.toBe('ready');
    expect(checker).toHaveBeenCalledTimes(1);
    expect(checker).toHaveBeenCalledWith(UID);
  });

  it('(W2) processing_luego_ready_reintenta_hasta_el_desenlace', async () => {
    const checker = jest
      .fn()
      .mockResolvedValueOnce('processing')
      .mockResolvedValueOnce('uploading')
      .mockResolvedValueOnce('ready');
    await expect(run(checker)).resolves.toBe('ready');
    expect(checker).toHaveBeenCalledTimes(3);
  });

  it('(W3) failed_duration_es_terminal_inmediato', async () => {
    const checker = jest.fn().mockResolvedValue('failed_duration');
    await expect(run(checker)).resolves.toBe('failed_duration');
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('(W4) failed_es_terminal_inmediato', async () => {
    const checker = jest.fn().mockResolvedValue('failed');
    await expect(run(checker)).resolves.toBe('failed');
    expect(checker).toHaveBeenCalledTimes(1);
  });

  it('(W5) #229 una_excepcion_del_checker_se_reintenta_no_es_terminal', async () => {
    const checker = jest
      .fn()
      .mockRejectedValueOnce(new Error('network changed'))
      .mockResolvedValueOnce('ready');
    await expect(run(checker)).resolves.toBe('ready');
    expect(checker).toHaveBeenCalledTimes(2);
  });

  it('(W6) excepciones_en_todos_los_intentos_devuelve_timeout_al_agotar', async () => {
    const checker = jest.fn().mockRejectedValue(new Error('db unreachable'));
    await expect(run(checker, { attempts: 3 })).resolves.toBe('timeout');
    expect(checker).toHaveBeenCalledTimes(3);
  });

  it('(W7) missing_persistente_devuelve_timeout_al_agotar (nunca un falso failed)', async () => {
    const checker = jest.fn().mockResolvedValue('missing');
    await expect(run(checker, { attempts: 2 })).resolves.toBe('timeout');
    expect(checker).toHaveBeenCalledTimes(2);
  });

  it('(W8) cancelacion_cooperativa_corta_sin_mas_llamadas', async () => {
    let cancelled = false;
    const checker = jest.fn().mockImplementation(() => {
      cancelled = true; // se cancela mientras el primer check resolvía
      return Promise.resolve('processing');
    });
    await expect(run(checker, { is_cancelled: () => cancelled })).resolves.toBe('cancelled');
    expect(checker).toHaveBeenCalledTimes(1);
  });
});
