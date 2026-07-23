/**
 * Tests fase RED — useThumbnail hook (hooks/useThumbnail.ts)
 * Subtarea Taskmaster: 68.7 — Épica B Stream, thumbnail picker (pieza hook)
 *
 * SUT: useThumbnail(deps?: { supabase? }): {
 *   fetch_source: (cloudflare_uid: string) => Promise<{ baseUrl; token; durationSeconds } | null>,
 *   save_pct: (cloudflare_uid: string, pct: number) => Promise<boolean>,
 *   error: string | null,
 * }
 *
 * Contrato (mint-thumbnail-url ya existe en GREEN — supabase/functions/mint-thumbnail-url;
 * ver handler.ts para los error_code exactos: UNAUTHENTICATED/BAD_REQUEST/VIDEO_NOT_FOUND/
 * FORBIDDEN_NOT_OWNER/INTERNAL_ERROR):
 *
 *   fetch_source(cloudflare_uid):
 *     1. Invoca supabase.functions.invoke('mint-thumbnail-url', { body: { cloudflare_uid } }).
 *     2. Éxito con data completa → { baseUrl, token, durationSeconds } (durationSeconds
 *        puede ser null si el video sigue en 'processing' — NO es un error).
 *     3. Error de la EF (FunctionsHttpError) → null + mensaje legible según el código
 *        (extract_error_code, mismo patrón que useVideoUpload/edge-errors):
 *          - FORBIDDEN_NOT_OWNER → mensaje de permiso.
 *          - VIDEO_NOT_FOUND     → mensaje "el video no está listo".
 *          - cualquier otro (INTERNAL_ERROR/UNAUTHENTICATED/etc.) → mensaje neutro.
 *     4. data incompleta sin error (falta baseUrl o token) → null + mensaje neutro.
 *     5. Excepción de red (invoke rechaza) → null + mensaje neutro, SIN lanzar.
 *
 *   save_pct(cloudflare_uid, pct):
 *     1. Clampea pct a [0,100] ANTES de escribir (150→100, -5→0).
 *     2. supabase.from('property_videos').update({ thumbnail_pct: <clamped> })
 *        .eq('cloudflare_uid', cloudflare_uid) — filtra por cloudflare_uid, NO por id
 *        (la RLS de owner es la barrera real; este test asegura el filtro correcto).
 *     3. Éxito (sin error) → true, error=null.
 *     4. Error de Postgrest → false + mensaje, fail-soft (NO lanza).
 *     5. Excepción inesperada (update/eq rechaza) → false + mensaje, fail-soft (NO lanza).
 *
 * NOTA API: @testing-library/react-native v14 — renderHook es ASYNC.
 *
 * EDGE CASES CUBIERTOS (RED):
 *
 * ### Sanidad de estado inicial
 * - (EC0) estado_inicial_error_es_null.
 *
 * ### Happy path — fetch_source
 * - (EC1) fetch_source_exito_devuelve_baseurl_token_duracion.
 * - (EC2) fetch_source_invoca_con_cloudflare_uid_en_el_body.
 * - (EC3) fetch_source_duration_null_no_es_error: video en 'processing', durationSeconds
 *   null en la respuesta 200 → SIGUE siendo éxito (no null, no error seteado).
 *
 * ### Ramas de mapeo de error — fetch_source (no obvias)
 * - (EC4) fetch_source_forbidden_not_owner_mensaje_de_permiso.
 * - (EC5) fetch_source_video_not_found_mensaje_no_listo.
 * - (EC6) fetch_source_error_generico_mensaje_neutro: rama "otros" (INTERNAL_ERROR).
 * - (EC7) fetch_source_data_incompleta_sin_error_mensaje_neutro: 200 pero falta
 *   baseUrl/token (defensivo, no debería pasar pero el hook no debe crashear).
 * - (EC8) fetch_source_excepcion_de_red_mensaje_neutro_sin_lanzar.
 *
 * ### Happy path — save_pct
 * - (EC9) save_pct_exito_devuelve_true_y_limpia_error.
 * - (EC10) save_pct_filtra_por_cloudflare_uid_no_por_id.
 *
 * ### Clamp de pct — save_pct
 * - (EC11) save_pct_clampea_150_a_100_antes_de_escribir.
 * - (EC12) save_pct_clampea_negativo_5_a_0_antes_de_escribir.
 *
 * ### Boundary / error — save_pct (fail-soft)
 * - (EC13) save_pct_error_de_postgrest_devuelve_false_sin_lanzar.
 * - (EC14) save_pct_excepcion_inesperada_devuelve_false_sin_lanzar.
 */

import { renderHook, act } from '@testing-library/react-native';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { useThumbnail } from '../hooks/useThumbnail';

// ---------------------------------------------------------------------------
// Constantes de test — valores independientes del SUT
// ---------------------------------------------------------------------------

const CLOUDFLARE_UID = 'stream-uid-thumb-test-xyz789';
const BASE_URL = 'https://videodelivery.net/stream-uid-thumb-test-xyz789/thumbnails/thumbnail.jpg';
const TOKEN = 'eyJhbGciOiJSUzI1NiJ9.thumb-token.sig';

const PERMISSION_ERROR_MESSAGE = 'No tienes permiso para ver este video.';
const NOT_FOUND_ERROR_MESSAGE = 'El video no está listo. Intenta de nuevo en unos segundos.';
const NEUTRAL_ERROR_MESSAGE = 'No se pudo cargar la portada. Verifica tu conexión e intenta de nuevo.';

/** FunctionsHttpError con el body { error: { code, message } } que emiten las EFs de Urbea. */
function make_ef_error(payload: { code: string; message: string }, status: number): FunctionsHttpError {
  return new FunctionsHttpError(new Response(JSON.stringify({ error: payload }), { status }));
}

// ---------------------------------------------------------------------------
// Factory de mock del cliente Supabase inyectado
// ---------------------------------------------------------------------------

function make_mock_supabase(opts: {
  invoke_result?: { data: unknown; error: unknown };
  invoke_impl?: jest.Mock;
  update_result?: { data: unknown; error: unknown };
  eq_impl?: jest.Mock;
}) {
  const {
    invoke_result = {
      data: { baseUrl: BASE_URL, token: TOKEN, durationSeconds: 92, expiresIn: 14400 },
      error: null,
    },
    update_result = { data: null, error: null },
  } = opts;

  const mock_invoke = opts.invoke_impl ?? jest.fn().mockResolvedValue(invoke_result);
  const mock_eq = opts.eq_impl ?? jest.fn().mockResolvedValue(update_result);
  const mock_update = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ update: mock_update });

  return {
    functions: { invoke: mock_invoke },
    from: mock_from,
    // Expuestos para aserciones
    _mock_invoke: mock_invoke,
    _mock_from: mock_from,
    _mock_update: mock_update,
    _mock_eq: mock_eq,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useThumbnail', () => {
  // ── (EC0) Estado inicial ─────────────────────────────────────────────

  it('(EC0) estado_inicial_error_es_null: al montar, error=null', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    expect(result.current.error).toBeNull();
  });

  // ── fetch_source — happy path ───────────────────────────────────────────

  it('(EC1) fetch_source_exito_devuelve_baseurl_token_duracion: data completa → objeto con los 3 campos', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let source: { baseUrl: string; token: string; durationSeconds: number | null } | null = null;
    await act(async () => {
      source = await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(source).toEqual({ baseUrl: BASE_URL, token: TOKEN, durationSeconds: 92 });
    expect(result.current.error).toBeNull();
  });

  it('(EC2) fetch_source_invoca_con_cloudflare_uid_en_el_body: invoke recibe el cloudflare_uid exacto', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('mint-thumbnail-url', {
      body: { cloudflare_uid: CLOUDFLARE_UID },
    });
  });

  it('(EC3) fetch_source_duration_null_no_es_error: video en processing, durationSeconds null sigue siendo éxito', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: {
        data: { baseUrl: BASE_URL, token: TOKEN, durationSeconds: null, expiresIn: 14400 },
        error: null,
      },
    });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let source: { baseUrl: string; token: string; durationSeconds: number | null } | null = null;
    await act(async () => {
      source = await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(source).toEqual({ baseUrl: BASE_URL, token: TOKEN, durationSeconds: null });
    expect(result.current.error).toBeNull();
  });

  // ── fetch_source — mapeo de error ───────────────────────────────────────

  it('(EC4) fetch_source_forbidden_not_owner_mensaje_de_permiso: 403 FORBIDDEN_NOT_OWNER → null + mensaje de permiso', async () => {
    const ef_error = make_ef_error({ code: 'FORBIDDEN_NOT_OWNER', message: 'No eres dueño de este video' }, 403);
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let source: unknown = 'not-set';
    await act(async () => {
      source = await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(source).toBeNull();
    expect(result.current.error).toBe(PERMISSION_ERROR_MESSAGE);
  });

  it('(EC5) fetch_source_video_not_found_mensaje_no_listo: 404 VIDEO_NOT_FOUND → null + mensaje "no está listo"', async () => {
    const ef_error = make_ef_error({ code: 'VIDEO_NOT_FOUND', message: 'Video no encontrado' }, 404);
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let source: unknown = 'not-set';
    await act(async () => {
      source = await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(source).toBeNull();
    expect(result.current.error).toBe(NOT_FOUND_ERROR_MESSAGE);
  });

  it('(EC6) fetch_source_error_generico_mensaje_neutro: 500 INTERNAL_ERROR (rama "otros") → null + mensaje neutro', async () => {
    const ef_error = make_ef_error({ code: 'INTERNAL_ERROR', message: 'No se pudo firmar el thumbnail' }, 500);
    const mock_supabase = make_mock_supabase({ invoke_result: { data: null, error: ef_error } });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let source: unknown = 'not-set';
    await act(async () => {
      source = await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(source).toBeNull();
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
  });

  it('(EC7) fetch_source_data_incompleta_sin_error_mensaje_neutro: 200 pero sin baseUrl/token → null + mensaje neutro', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_result: { data: { baseUrl: null, token: null, durationSeconds: null }, error: null },
    });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let source: unknown = 'not-set';
    await act(async () => {
      source = await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(source).toBeNull();
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
  });

  it('(EC8) fetch_source_excepcion_de_red_mensaje_neutro_sin_lanzar: invoke rechaza → null + mensaje neutro, sin lanzar', async () => {
    const mock_supabase = make_mock_supabase({
      invoke_impl: jest.fn().mockRejectedValue(new Error('network fail')),
    });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let source: unknown = 'not-set';
    await act(async () => {
      source = await result.current.fetch_source(CLOUDFLARE_UID);
    });

    expect(source).toBeNull();
    expect(result.current.error).toBe(NEUTRAL_ERROR_MESSAGE);
  });

  // ── save_pct — happy path ────────────────────────────────────────────────

  it('(EC9) save_pct_exito_devuelve_true_y_limpia_error: éxito → true, error=null', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let ok: boolean | null = null;
    await act(async () => {
      ok = await result.current.save_pct(CLOUDFLARE_UID, 50);
    });

    expect(ok).toBe(true);
    expect(result.current.error).toBeNull();
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('property_videos');
    expect(mock_supabase._mock_update).toHaveBeenCalledWith({ thumbnail_pct: 50 });
  });

  it('(EC10) save_pct_filtra_por_cloudflare_uid_no_por_id: .eq recibe cloudflare_uid, no id', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.save_pct(CLOUDFLARE_UID, 50);
    });

    expect(mock_supabase._mock_eq).toHaveBeenCalledWith('cloudflare_uid', CLOUDFLARE_UID);
  });

  // ── save_pct — clamp ─────────────────────────────────────────────────────

  it('(EC11) save_pct_clampea_150_a_100_antes_de_escribir: pct=150 persiste thumbnail_pct=100', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.save_pct(CLOUDFLARE_UID, 150);
    });

    expect(mock_supabase._mock_update).toHaveBeenCalledWith({ thumbnail_pct: 100 });
  });

  it('(EC12) save_pct_clampea_negativo_5_a_0_antes_de_escribir: pct=-5 persiste thumbnail_pct=0', async () => {
    const mock_supabase = make_mock_supabase({});
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    await act(async () => {
      await result.current.save_pct(CLOUDFLARE_UID, -5);
    });

    expect(mock_supabase._mock_update).toHaveBeenCalledWith({ thumbnail_pct: 0 });
  });

  // ── save_pct — fail-soft ─────────────────────────────────────────────────

  it('(EC13) save_pct_error_de_postgrest_devuelve_false_sin_lanzar: error de Postgrest → false + mensaje, sin lanzar', async () => {
    const mock_supabase = make_mock_supabase({
      update_result: { data: null, error: { message: 'permission denied' } },
    });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let ok: boolean | null = null;
    await act(async () => {
      ok = await result.current.save_pct(CLOUDFLARE_UID, 50);
    });

    expect(ok).toBe(false);
    expect(result.current.error).not.toBeNull();
  });

  it('(EC14) save_pct_excepcion_inesperada_devuelve_false_sin_lanzar: .eq rechaza → false + mensaje, sin lanzar (no crashea)', async () => {
    const mock_supabase = make_mock_supabase({
      eq_impl: jest.fn().mockRejectedValue(new Error('network fail')),
    });
    const { result } = await renderHook(() => useThumbnail({ supabase: mock_supabase as never }));

    let ok: boolean | null = null;
    await act(async () => {
      ok = await result.current.save_pct(CLOUDFLARE_UID, 50);
    });

    expect(ok).toBe(false);
    expect(result.current.error).not.toBeNull();
  });
});
