/**
 * Tests fase RED — caché de módulo de resolve_r2_urls (r2Resolver.ts)
 * Tarea Taskmaster: 263 — polish(222): las fotos de perfil tardan en
 * aparecer en TODOS los perfiles (caché de URLs firmadas de R2).
 *
 * SEAM (interfaz bajo test):
 * - resolve_r2_urls(keys, deps?) conserva firma y contrato (batch, dedup por
 *   llamada, fail-soft, alineación 1:1, passthrough http(s)) — ver
 *   r2Resolver.test.ts para el contrato base, aquí solo la caché nueva.
 * - Nuevo: caché de módulo key → { url, expires_at_ms } poblada con
 *   `expires` (segundos) de la respuesta de la EF; una key se sirve de
 *   caché si expires_at_ms - Date.now() > R2_URL_SAFETY_MS (export,
 *   300_000). Solo keys sin caché válida van a la EF, en un único invoke.
 *   Dedupe de llamadas EN VUELO: si una key ya está siendo pedida, la
 *   segunda llamada espera esa misma promesa (un solo invoke). Fallo o
 *   rechazo de la EF → nada entra a la caché.
 * - Nuevo export peek_r2_urls(keys): (string|null)[] síncrono: URL cacheada
 *   válida o passthrough http(s) por posición, null en lo demás; nunca
 *   invoca.
 * - Nuevo export clear_r2_url_cache(): void.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - EC-R1 misma_key_en_dos_llamadas_seguidas: 1 invoke; la segunda llamada
 *   devuelve la misma URL desde caché.
 *
 * ### Edge cases del PRD / alcance de la tarea 263 (ver `details`)
 * - EC-R2a url_por_vencer_menos_de_5_min: quedan 200s de vida (< R2_URL_SAFETY_MS)
 *   → se vuelve a pedir a la EF.
 * - EC-R2b url_con_mas_de_5_min_de_vida: quedan 400s de vida (> R2_URL_SAFETY_MS)
 *   → NO se vuelve a pedir.
 * - EC-R2c la constante exportada R2_URL_SAFETY_MS es literalmente 300_000
 *   (5 minutos en ms, fuente: `details` de la tarea 263).
 *
 * ### Ramas no obvias
 * - EC-R3 dos llamadas CONCURRENTES de la misma key (la primera aún sin
 *   resolver) → 1 solo invoke, ambas llamadas resuelven la misma URL.
 * - EC-R4 lote mixto [cacheada, nueva, http legacy, null] → la EF recibe
 *   SOLO la key nueva; resultado alineado 1:1.
 * - EC-R6 peek_r2_urls: cacheada → url; desconocida → null; http legacy →
 *   passthrough; nunca invoca la EF.
 * - EC-R7 clear_r2_url_cache → la siguiente llamada a resolve_r2_urls
 *   invoca la EF otra vez (caché en frío).
 *
 * ### Boundary / error
 * - EC-R5a la EF responde error → nada entra a la caché, la siguiente
 *   llamada de la misma key vuelve a invocar.
 * - EC-R5b invoke RECHAZA (excepción) → nada entra a la caché, ídem.
 * - EC-R5c (guardian #263, violación 2 — post-GREEN) entrada YA cacheada
 *   que vence el margen de seguridad (reloj avanzado a < 5 min de vida) y
 *   cuyo refetch FALLA → el resultado es `null`, NUNCA la URL vieja (podía
 *   devolver 403 en R2); la entrada rancia queda purgada (peek_r2_urls
 *   tampoco la sirve).
 *
 * NOTA DE VERIFICACIÓN (RED): `peek_r2_urls`, `clear_r2_url_cache` y
 * `R2_URL_SAFETY_MS` NO EXISTEN todavía en r2Resolver.ts — este archivo
 * FALLA por TS (exports inexistentes) / Jest (module no exporta el símbolo)
 * en TODOS sus casos hasta la fase GREEN. Es el modo de fallo aceptado
 * explícitamente en el briefing de la subtarea; no se creó un stub en el
 * SUT (r2Resolver.ts no se toca en RED).
 */

import {
  resolve_r2_urls,
  peek_r2_urls,
  clear_r2_url_cache,
  R2_URL_SAFETY_MS,
} from '../r2Resolver';

const mock_invoke = jest.fn();

const mock_supabase = {
  functions: { invoke: mock_invoke },
};

const TEST_KEY_1 = 'avatars/user-1/uuid-1';
const TEST_KEY_2 = 'avatars/user-2/uuid-2';
const TEST_URL_1 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-1/uuid-1?sig=1';
const TEST_URL_2 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-2/uuid-2?sig=2';

// URL legacy (Supabase Storage, pre-migración R2) — ya utilizable, no es key R2.
const TEST_LEGACY_URL =
  'https://xyzproj.supabase.co/storage/v1/object/public/profile-photos/user-9/avatar.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  clear_r2_url_cache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('resolve_r2_urls — caché de módulo (263)', () => {
  it('EC_R1_misma_key_en_dos_llamadas_seguidas_un_solo_invoke_misma_url', async () => {
    mock_invoke.mockResolvedValue({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    const first = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    const second = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(first).toEqual([TEST_URL_1]);
    expect(second).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
  });

  it('EC_R2a_url_por_vencer_en_menos_de_5_min_se_vuelve_a_pedir', async () => {
    const base_time = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(base_time);

    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    // Avanza el reloj: quedan 3600 - 3400 = 200s de vida (< 300_000ms).
    jest.spyOn(Date, 'now').mockReturnValue(base_time + 3400 * 1000);
    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    const result = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(result).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(2);
  });

  it('EC_R2b_url_con_mas_de_5_min_de_vida_no_se_vuelve_a_pedir', async () => {
    const base_time = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(base_time);

    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    // Avanza el reloj: quedan 3600 - 3200 = 400s de vida (> 300_000ms).
    jest.spyOn(Date, 'now').mockReturnValue(base_time + 3200 * 1000);

    const result = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(result).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
  });

  it('EC_R2c_R2_URL_SAFETY_MS_es_300000', () => {
    expect(R2_URL_SAFETY_MS).toBe(300_000);
  });

  it('EC_R3_dos_llamadas_concurrentes_de_la_misma_key_comparten_un_solo_invoke', async () => {
    let resolve_invoke!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      resolve_invoke = resolve;
    });
    mock_invoke.mockReturnValueOnce(pending);

    const call_1 = resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    const call_2 = resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(mock_invoke).toHaveBeenCalledTimes(1);

    resolve_invoke({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    const [result_1, result_2] = await Promise.all([call_1, call_2]);

    expect(result_1).toEqual([TEST_URL_1]);
    expect(result_2).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
  });

  it('EC_R4_lote_mixto_cacheada_nueva_http_legacy_null_ef_recibe_solo_la_nueva', async () => {
    // Precarga TEST_KEY_1 en caché.
    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    mock_invoke.mockClear();

    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 }] },
      error: null,
    });

    const result = await resolve_r2_urls(
      [TEST_KEY_1, TEST_KEY_2, TEST_LEGACY_URL, null],
      { supabase: mock_supabase },
    );

    expect(result).toEqual([TEST_URL_1, TEST_URL_2, TEST_LEGACY_URL, null]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
    const [, options] = mock_invoke.mock.calls[0] as [string, { body: { keys: string[] } }];
    expect(options.body.keys).toEqual([TEST_KEY_2]);
  });

  it('EC_R5a_ef_responde_error_nada_se_cachea_la_siguiente_llamada_vuelve_a_invocar', async () => {
    mock_invoke.mockResolvedValueOnce({ data: null, error: { message: 'internal error' } });
    const first = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    expect(first).toEqual([null]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    const second = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(second).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(2);
  });

  it('EC_R5b_invoke_rechaza_nada_se_cachea_la_siguiente_llamada_vuelve_a_invocar', async () => {
    mock_invoke.mockRejectedValueOnce(new Error('network down'));
    const first = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    expect(first).toEqual([null]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    const second = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(second).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(2);
  });

  it('EC_R5c_entrada_rancia_y_refetch_falla_no_sirve_la_url_vieja_guardian_263', async () => {
    const base_time = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(base_time);

    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    // Avanza el reloj: quedan 3600 - 3400 = 200s de vida (< R2_URL_SAFETY_MS)
    // → se intenta refetch, y esta vez la EF falla.
    jest.spyOn(Date, 'now').mockReturnValue(base_time + 3400 * 1000);
    mock_invoke.mockResolvedValueOnce({ data: null, error: { message: 'internal error' } });

    const result = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    // Guardian #263 violación 2: NUNCA la URL vieja (podría dar 403 en R2)
    // — fail-soft real es `null`, no la firma rancia.
    expect(result).toEqual([null]);
    expect(mock_invoke).toHaveBeenCalledTimes(2);

    // La entrada rancia quedó purgada — peek_r2_urls tampoco la sirve.
    expect(peek_r2_urls([TEST_KEY_1])).toEqual([null]);
  });

  it('EC_R6_peek_r2_urls_devuelve_cacheada_null_o_passthrough_sin_invocar', async () => {
    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    mock_invoke.mockClear();

    const peeked = peek_r2_urls([TEST_KEY_1, TEST_KEY_2, TEST_LEGACY_URL]);

    expect(peeked).toEqual([TEST_URL_1, null, TEST_LEGACY_URL]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  it('EC_R7_clear_r2_url_cache_fuerza_un_nuevo_invoke', async () => {
    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    expect(mock_invoke).toHaveBeenCalledTimes(1);

    clear_r2_url_cache();

    mock_invoke.mockResolvedValueOnce({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });
    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(mock_invoke).toHaveBeenCalledTimes(2);
  });
});
