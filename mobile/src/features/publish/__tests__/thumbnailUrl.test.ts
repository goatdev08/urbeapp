/**
 * Tests — build_thumbnail_frame_url (lib/thumbnailUrl.ts)
 * Subtarea Taskmaster: 68.7 — Épica B Stream, thumbnail picker (pieza pura)
 *
 * SUT: build_thumbnail_frame_url({ baseUrl, pct, durationSeconds }): string
 *
 * ⚠️ CONTRATO CORREGIDO (verificado en vivo contra Cloudflare Stream real,
 * 2026-07-22): en un video con `requireSignedURLs=true` el token JWT va
 * **EN EL PATH**, sustituyendo al uid — NO como query param.
 *   - `.../<uid>/thumbnails/thumbnail.jpg?time=26.1s&token=<JWT>` → 401.
 *   - `.../<TOKEN>/thumbnails/thumbnail.jpg?time=26.1s` → 200, JPEG real.
 * Por eso la Edge Function `mint-thumbnail-url` devuelve `baseUrl` YA CON el
 * token incrustado en el path (el uid viaja dentro del JWT, claim `sub`), y
 * el SUT ya no recibe ni agrega `token` — solo añade `?time=<N>s`.
 *
 * Contrato:
 *   - time = (pct/100) * durationSeconds, en SEGUNDOS con 1 decimal fijo
 *     (`time.toFixed(1)`) → `${baseUrl}?time=${time}s`.
 *   - pct se clampea a [0,100] ANTES de calcular time (pct<0 → 0, pct>100 → 100).
 *   - durationSeconds === null (video aún en 'processing', sin duración
 *     conocida) → NO se agrega query alguno; se devuelve `baseUrl` tal cual
 *     (deja que Stream sirva su frame default).
 *
 * Valores esperados: computados a mano (fuente independiente del SUT), NO
 * recomputados con la misma fórmula que usará el código.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (a) pct_50_duracion_92s_arma_time_46_0s.
 * - (b) pct_25_duracion_8s_arma_time_2_0s.
 * - (c) pct_75_duracion_100s_arma_time_75_0s.
 *
 * ### Boundaries de pct (0/100 exactos)
 * - (d) pct_0_arma_time_0_0s.
 * - (e) pct_100_arma_time_igual_a_duracion.
 *
 * ### Clamp de pct fuera de rango
 * - (f) pct_negativo_se_clampea_a_0.
 * - (g) pct_mayor_a_100_se_clampea_a_100.
 *
 * ### duration null (video en processing, sin duración conocida)
 * - (h) duration_null_omite_query_y_devuelve_baseurl_tal_cual.
 * - (i) duration_null_con_pct_no_cero_sigue_omitiendo_query: el pct elegido
 *   por el usuario es irrelevante sin duración — nunca se puede calcular time.
 *
 * ### Boundary de duration
 * - (j) duration_cero_con_pct_cualquiera_arma_time_0_0s: 0 * cualquier pct = 0,
 *   pero SIGUE incluyendo el parámetro (duration=0 no es null).
 *
 * ### Formato / independencia de baseUrl + anti-regresión del bug de token
 * - (k) preserva_baseurl_literal_y_nunca_agrega_token_en_query: baseUrl viaja
 *   sin modificar (el token ya viene incrustado en su path) y la URL
 *   resultante jamás contiene `token=` como query param — ese era exactamente
 *   el bug verificado (401 con token en query, 200 con token en el path).
 */

import { build_thumbnail_frame_url } from '../lib/thumbnailUrl';

const BASE_URL = 'https://videodelivery.net/SIGNED_TOKEN_IN_PATH/thumbnails/thumbnail.jpg';

describe('build_thumbnail_frame_url', () => {
  // ── Happy path — valores del brief 68.7, computados a mano ────────────

  it('(a) pct_50_duracion_92s_arma_time_46_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 50,
      durationSeconds: 92,
    });

    expect(url).toBe(`${BASE_URL}?time=46.0s`);
  });

  it('(b) pct_25_duracion_8s_arma_time_2_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 25,
      durationSeconds: 8,
    });

    expect(url).toBe(`${BASE_URL}?time=2.0s`);
  });

  it('(c) pct_75_duracion_100s_arma_time_75_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 75,
      durationSeconds: 100,
    });

    expect(url).toBe(`${BASE_URL}?time=75.0s`);
  });

  // ── Boundaries exactos de pct ──────────────────────────────────────────

  it('(d) pct_0_arma_time_0_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 0,
      durationSeconds: 92,
    });

    expect(url).toBe(`${BASE_URL}?time=0.0s`);
  });

  it('(e) pct_100_arma_time_igual_a_duracion', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 100,
      durationSeconds: 40,
    });

    expect(url).toBe(`${BASE_URL}?time=40.0s`);
  });

  // ── Clamp de pct fuera de [0,100] ───────────────────────────────────────

  it('(f) pct_negativo_se_clampea_a_0: pct=-10 se comporta como pct=0', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: -10,
      durationSeconds: 92,
    });

    expect(url).toBe(`${BASE_URL}?time=0.0s`);
  });

  it('(g) pct_mayor_a_100_se_clampea_a_100: pct=150 se comporta como pct=100', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 150,
      durationSeconds: 100,
    });

    expect(url).toBe(`${BASE_URL}?time=100.0s`);
  });

  // ── duration null — video sin duración conocida (aún processing) ────────

  it('(h) duration_null_omite_query_y_devuelve_baseurl_tal_cual: sin duración, la URL es baseUrl sin agregar nada', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 50,
      durationSeconds: null,
    });

    expect(url).toBe(BASE_URL);
    expect(url).not.toContain('time=');
  });

  it('(i) duration_null_con_pct_no_cero_sigue_omitiendo_query: el pct es irrelevante sin duración', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 99,
      durationSeconds: null,
    });

    expect(url).toBe(BASE_URL);
  });

  // ── duration = 0 (boundary: no es null, pero el cálculo da 0) ───────────

  it('(j) duration_cero_con_pct_cualquiera_arma_time_0_0s: duration=0 SIGUE incluyendo time= (no es null)', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      pct: 75,
      durationSeconds: 0,
    });

    expect(url).toBe(`${BASE_URL}?time=0.0s`);
  });

  // ── Preserva baseUrl literal + anti-regresión del bug (token en query) ──

  it('(k) preserva_baseurl_literal_y_nunca_agrega_token_en_query: baseUrl no se reescribe y jamás aparece token= en la query', () => {
    const custom_base =
      'https://customer-abc123.cloudflarestream.com/eyJhbGciOiJSUzI1NiJ9.payload.signature/thumbnails/thumbnail.jpg';

    const url = build_thumbnail_frame_url({
      baseUrl: custom_base,
      pct: 10,
      durationSeconds: 20,
    });

    expect(url).toBe(`${custom_base}?time=2.0s`);
    // Anti-regresión: el bug real era mandar el token como query param
    // (`?token=`), lo que Cloudflare Stream rechaza con 401. El token debe
    // viajar únicamente incrustado en el path de baseUrl.
    expect(url).not.toContain('token=');
  });
});
