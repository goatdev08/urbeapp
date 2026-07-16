/**
 * Tests fase RED — resolve_r2_urls (r2Resolver.ts)
 * Subtarea Taskmaster: 69.3 — Cliente: avatar de usuario vía R2 presigned
 *
 * SUT: resolve_r2_urls(keys, deps?): Promise<(string | null)[]>
 *
 * Primitiva de LECTURA reusable — resuelve un lote de R2 keys (avatares) a
 * URLs presigned de lectura vía la Edge Function `mint-r2-url` (69.2,
 * `{kind:'avatar', op:'get', keys:[...]}` → `{urls:[{key,url,expires}]}`).
 * Bucket PRIVADO: la lectura SIEMPRE pasa por aquí (no hay URL pública).
 *
 * CONTRATO:
 *   - El array de salida tiene EXACTAMENTE la misma longitud y orden que el
 *     array de entrada (alineado 1:1 — facilita el zip con la lista que
 *     renderiza la UI, p.ej. feed/CRM/perfil).
 *   - keys null/undefined/'' en la entrada → null en la posición
 *     correspondiente de la salida, SIN pedir esa key a la EF.
 *   - Las keys válidas se piden en UN SOLO invoke, deduplicadas (Set) — nunca
 *     una invocación por key.
 *   - Fail-soft: si la EF devuelve error, o si la invocación lanza (red
 *     caída), TODAS las posiciones válidas resuelven a null — resolve_r2_urls
 *     NUNCA lanza (mismo espíritu que el merge fail-closed de feedProperties,
 *     pero fail-SOFT: la UI simplemente no muestra avatar en vez de romper
 *     la pantalla completa).
 *   - Si el lote de entrada no tiene NINGUNA key válida, no se invoca la EF.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Happy path
 * - (a) un_key_devuelve_una_url: resolve_r2_urls(['k1']) → invoke UNA vez con
 *   keys:['k1'] → [url1].
 * - (b) varios_keys_batch_en_una_sola_llamada: resolve_r2_urls(['k1','k2','k3'])
 *   → UN SOLO invoke con las 3 keys → [url1,url2,url3] en el mismo orden.
 *
 * ### Ramas no obvias
 * - (c) invoke_exacto_kind_avatar_op_get: el body es exactamente
 *   {kind:'avatar', op:'get', keys:[...]}.
 * - (d) de_dup_keys_repetidos: keys=['k1','k1','k2'] → invoke con
 *   keys:['k1','k2'] (deduplicadas) → salida [url1,url1,url2] (ambas
 *   posiciones de 'k1' resuelven al MISMO valor).
 * - (e) respuesta_parcial_keys_faltantes_resuelven_null: la EF devuelve
 *   menos urls que keys solicitadas (p.ej. una key ya no existe en R2) →
 *   las keys ausentes de la respuesta resuelven null, fail-soft, SIN lanzar.
 *
 * ### Boundary / error
 * - (f) key_null_no_llama_ef: resolve_r2_urls([null]) → NO invoca la EF,
 *   retorna [null].
 * - (g) key_vacia_no_llama_ef: resolve_r2_urls(['']) → NO invoca la EF,
 *   retorna [null].
 * - (h) lote_vacio_no_llama_ef: resolve_r2_urls([]) → NO invoca la EF,
 *   retorna [].
 * - (i) mezcla_null_y_validos_solo_invoca_las_validas: resolve_r2_urls(['k1',
 *   null, 'k2']) → invoke con keys:['k1','k2'] (SIN null) → [url1,null,url2].
 * - (j) ef_devuelve_error_fail_soft_sin_throw: invoke resuelve {data:null,
 *   error:{...}} → TODAS las posiciones válidas → null, NO lanza.
 * - (k) invoke_lanza_excepcion_fail_soft_sin_throw: invoke RECHAZA (red
 *   caída) → TODAS las posiciones válidas → null, resolve_r2_urls NO
 *   propaga la excepción.
 *
 * ---------------------------------------------------------------------------
 * AÑADIDO — Subtarea 69.6: passthrough de URLs legacy (Supabase Storage)
 * ---------------------------------------------------------------------------
 * Bug motivador: avatares sembrados ANTES de la migración a R2 (69.4) siguen
 * en `user_preferences.profile_photo_url` como URL PÚBLICA completa
 * (`https://<proj>.supabase.co/storage/v1/object/public/...`), no como R2
 * key (`avatars/<uid>/<uuid>`). El resolver los trataba como key R2 → los
 * mandaba a mint-r2-url (que jamás los reconoce) → resolvían null → el
 * avatar legacy desaparecía de la UI.
 *
 * Contrato NUEVO: un elemento que EMPIEZA CON `http://` o `https://` ya es
 * una URL utilizable → se devuelve TAL CUAL, sin incluirse en la llamada a
 * la EF (no es un key R2). Las keys R2 reales (sin ese prefijo) siguen su
 * camino normal. Mezclas de key + url + null mantienen la alineación 1:1;
 * si NINGÚN elemento es un key R2 (todos son URLs o null), no se llama la EF.
 *
 * ### Ramas nuevas (passthrough legacy, 69.6)
 * - (l) passthrough_url_https_no_llama_ef: un único valor `https://...` se
 *   devuelve tal cual, SIN invocar la EF.
 * - (m) passthrough_url_http_no_llama_ef: idem con `http://...`.
 * - (n) mezcla_key_r2_y_url_legacy_alineada: keys=[key_r2, url_legacy, null]
 *   → invoke SOLO con el key R2 (la url legacy NO viaja en el body); salida
 *   alineada 1:1 con la url legacy intacta en su posición.
 * - (o) todos_urls_o_null_no_llama_ef: si NINGÚN elemento es un key R2
 *   (todos URLs legacy o null) → NO invoca la EF, cada posición se devuelve
 *   tal cual (urls) o null.
 */

import { resolve_r2_urls } from '../r2Resolver';

const mock_invoke = jest.fn();

const mock_supabase = {
  functions: { invoke: mock_invoke },
};

const TEST_KEY_1 = 'avatars/user-1/uuid-1';
const TEST_KEY_2 = 'avatars/user-2/uuid-2';
const TEST_KEY_3 = 'avatars/user-3/uuid-3';
const TEST_URL_1 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-1/uuid-1?sig=1';
const TEST_URL_2 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-2/uuid-2?sig=2';
const TEST_URL_3 = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-3/uuid-3?sig=3';

// URLs legacy (Supabase Storage, pre-migración R2 / 69.4) — ya son URLs
// utilizables, NO keys R2 (no empiezan con "avatars/").
const TEST_LEGACY_URL_HTTPS =
  'https://xyzproj.supabase.co/storage/v1/object/public/profile-photos/user-9/avatar.jpg';
const TEST_LEGACY_URL_HTTP = 'http://legacy.internal.example/avatar.jpg';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolve_r2_urls — resolver de lectura en lote (mint-r2-url op:get)', () => {
  // ── (a) un solo key ───────────────────────────────────────────────────────

  it('(a) un_key_devuelve_una_url: un solo key resuelve a un array de una url', async () => {
    mock_invoke.mockResolvedValue({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    const result = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(result).toEqual([TEST_URL_1]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
  });

  // ── (b) varios keys en una sola llamada ──────────────────────────────────

  it('(b) varios_keys_batch_en_una_sola_llamada: varios keys se resuelven en UN solo invoke, mismo orden', async () => {
    mock_invoke.mockResolvedValue({
      data: {
        urls: [
          { key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 },
          { key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 },
          { key: TEST_KEY_3, url: TEST_URL_3, expires: 3600 },
        ],
      },
      error: null,
    });

    const result = await resolve_r2_urls([TEST_KEY_1, TEST_KEY_2, TEST_KEY_3], {
      supabase: mock_supabase,
    });

    expect(result).toEqual([TEST_URL_1, TEST_URL_2, TEST_URL_3]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
  });

  // ── (c) body exacto ───────────────────────────────────────────────────────

  it('(c) invoke_exacto_kind_avatar_op_get: invoca mint-r2-url con {kind:"avatar", op:"get", keys:[...]}', async () => {
    mock_invoke.mockResolvedValue({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });

    expect(mock_invoke).toHaveBeenCalledWith('mint-r2-url', {
      body: { kind: 'avatar', op: 'get', keys: [TEST_KEY_1] },
    });
  });

  // ── (d) de-dup de keys repetidos ──────────────────────────────────────────

  it('(d) de_dup_keys_repetidos: keys repetidos se piden UNA sola vez a la EF, ambas posiciones resuelven igual', async () => {
    mock_invoke.mockResolvedValue({
      data: {
        urls: [
          { key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 },
          { key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 },
        ],
      },
      error: null,
    });

    const result = await resolve_r2_urls([TEST_KEY_1, TEST_KEY_1, TEST_KEY_2], {
      supabase: mock_supabase,
    });

    expect(result).toEqual([TEST_URL_1, TEST_URL_1, TEST_URL_2]);
    const [, options] = mock_invoke.mock.calls[0] as [string, { body: { keys: string[] } }];
    expect(options.body.keys).toEqual([TEST_KEY_1, TEST_KEY_2]);
  });

  // ── (e) respuesta parcial: keys faltantes resuelven null ─────────────────

  it('(e) respuesta_parcial_keys_faltantes_resuelven_null: si la EF devuelve menos urls que keys pedidas, las faltantes son null (fail-soft)', async () => {
    mock_invoke.mockResolvedValue({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    const result = await resolve_r2_urls([TEST_KEY_1, TEST_KEY_2], { supabase: mock_supabase });

    expect(result).toEqual([TEST_URL_1, null]);
  });

  // ── (f) key null no llama a la EF ─────────────────────────────────────────

  it('(f) key_null_no_llama_ef: un solo key null → NO invoca la EF, retorna [null]', async () => {
    const result = await resolve_r2_urls([null], { supabase: mock_supabase });

    expect(result).toEqual([null]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  // ── (g) key vacía no llama a la EF ────────────────────────────────────────

  it('(g) key_vacia_no_llama_ef: un solo key "" → NO invoca la EF, retorna [null]', async () => {
    const result = await resolve_r2_urls([''], { supabase: mock_supabase });

    expect(result).toEqual([null]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  // ── (h) lote vacío no llama a la EF ───────────────────────────────────────

  it('(h) lote_vacio_no_llama_ef: array de entrada vacío → NO invoca la EF, retorna []', async () => {
    const result = await resolve_r2_urls([], { supabase: mock_supabase });

    expect(result).toEqual([]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  // ── (i) mezcla de null y válidos: solo se piden los válidos ──────────────

  it('(i) mezcla_null_y_validos_solo_invoca_las_validas: keys=[k1,null,k2] → invoke solo con [k1,k2], salida alineada con null en su posición', async () => {
    mock_invoke.mockResolvedValue({
      data: {
        urls: [
          { key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 },
          { key: TEST_KEY_2, url: TEST_URL_2, expires: 3600 },
        ],
      },
      error: null,
    });

    const result = await resolve_r2_urls([TEST_KEY_1, null, TEST_KEY_2], {
      supabase: mock_supabase,
    });

    expect(result).toEqual([TEST_URL_1, null, TEST_URL_2]);
    const [, options] = mock_invoke.mock.calls[0] as [string, { body: { keys: string[] } }];
    expect(options.body.keys).toEqual([TEST_KEY_1, TEST_KEY_2]);
  });

  // ── (j) la EF devuelve error → fail-soft, sin throw ───────────────────────

  it('(j) ef_devuelve_error_fail_soft_sin_throw: mint-r2-url responde con error → todas las posiciones válidas resuelven null, NO lanza', async () => {
    mock_invoke.mockResolvedValue({
      data: null,
      error: { message: 'internal error' },
    });

    let thrown: unknown = null;
    let result: (string | null)[] = [];
    try {
      result = await resolve_r2_urls([TEST_KEY_1, TEST_KEY_2], { supabase: mock_supabase });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(result).toEqual([null, null]);
  });

  // ── (k) invoke lanza excepción → fail-soft, sin throw ─────────────────────

  it('(k) invoke_lanza_excepcion_fail_soft_sin_throw: invoke rechaza (red caída) → todas las posiciones válidas resuelven null, NO propaga la excepción', async () => {
    mock_invoke.mockRejectedValue(new Error('network down'));

    let thrown: unknown = null;
    let result: (string | null)[] = [];
    try {
      result = await resolve_r2_urls([TEST_KEY_1], { supabase: mock_supabase });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(result).toEqual([null]);
  });

  // ── (l)-(o) passthrough de URLs legacy (69.6) ─────────────────────────────

  it('(l) passthrough_url_https_no_llama_ef: un valor https:// se devuelve tal cual, SIN invocar la EF', async () => {
    const result = await resolve_r2_urls([TEST_LEGACY_URL_HTTPS], { supabase: mock_supabase });

    expect(result).toEqual([TEST_LEGACY_URL_HTTPS]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  it('(m) passthrough_url_http_no_llama_ef: un valor http:// se devuelve tal cual, SIN invocar la EF', async () => {
    const result = await resolve_r2_urls([TEST_LEGACY_URL_HTTP], { supabase: mock_supabase });

    expect(result).toEqual([TEST_LEGACY_URL_HTTP]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });

  it('(n) mezcla_key_r2_y_url_legacy_alineada: keys=[key_r2, url_legacy, null] → invoke SOLO con el key R2, alineación 1:1 preservada', async () => {
    mock_invoke.mockResolvedValue({
      data: { urls: [{ key: TEST_KEY_1, url: TEST_URL_1, expires: 3600 }] },
      error: null,
    });

    const result = await resolve_r2_urls([TEST_KEY_1, TEST_LEGACY_URL_HTTPS, null], {
      supabase: mock_supabase,
    });

    expect(result).toEqual([TEST_URL_1, TEST_LEGACY_URL_HTTPS, null]);
    expect(mock_invoke).toHaveBeenCalledTimes(1);
    const [, options] = mock_invoke.mock.calls[0] as [string, { body: { keys: string[] } }];
    expect(options.body.keys).toEqual([TEST_KEY_1]);
  });

  it('(o) todos_urls_o_null_no_llama_ef: si ningún elemento es key R2 (todos URLs legacy o null) → NO invoca la EF', async () => {
    const result = await resolve_r2_urls([TEST_LEGACY_URL_HTTPS, null, TEST_LEGACY_URL_HTTP], {
      supabase: mock_supabase,
    });

    expect(result).toEqual([TEST_LEGACY_URL_HTTPS, null, TEST_LEGACY_URL_HTTP]);
    expect(mock_invoke).not.toHaveBeenCalled();
  });
});
