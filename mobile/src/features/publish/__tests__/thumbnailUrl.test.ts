/**
 * Tests fase RED — build_thumbnail_frame_url (lib/thumbnailUrl.ts)
 * Subtarea Taskmaster: 68.7 — Épica B Stream, thumbnail picker (pieza pura)
 *
 * SUT: build_thumbnail_frame_url({ baseUrl, token, pct, durationSeconds }): string
 *
 * Contrato (mint-thumbnail-url devuelve baseUrl + token + durationSeconds;
 * el cliente arma la URL del frame concreto según el pct elegido por el
 * usuario, spec 68.7):
 *   - time = (pct/100) * durationSeconds, en SEGUNDOS con 1 decimal fijo
 *     (`time.toFixed(1)`) → `${baseUrl}?time=${time}s&token=${token}`.
 *   - pct se clampea a [0,100] ANTES de calcular time (pct<0 → 0, pct>100 → 100).
 *   - durationSeconds === null (video aún en 'processing', sin duración
 *     conocida) → NO se agrega `time=`; solo `${baseUrl}?token=${token}`
 *     (deja que Stream sirva su frame default).
 *
 * Valores esperados: computados a mano (fuente independiente del SUT), NO
 * recomputados con la misma fórmula que usará el código.
 *
 * EDGE CASES CUBIERTOS (RED):
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
 * - (h) duration_null_omite_parametro_time.
 * - (i) duration_null_con_pct_no_cero_sigue_omitiendo_time: el pct elegido
 *   por el usuario es irrelevante sin duración — nunca se puede calcular time.
 *
 * ### Boundary de duration
 * - (j) duration_cero_con_pct_cualquiera_arma_time_0_0s: 0 * cualquier pct = 0,
 *   pero SIGUE incluyendo el parámetro (duration=0 no es null).
 *
 * ### Formato / independencia de baseUrl y token
 * - (k) preserva_baseurl_y_token_literal_en_la_url.
 */

import { build_thumbnail_frame_url } from '../lib/thumbnailUrl';

const BASE_URL = 'https://videodelivery.net/UID/thumbnails/thumbnail.jpg';
const TOKEN = 'TK';

describe('build_thumbnail_frame_url', () => {
  // ── Happy path — valores del brief 68.7, computados a mano ────────────

  it('(a) pct_50_duracion_92s_arma_time_46_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 50,
      durationSeconds: 92,
    });

    expect(url).toBe(`${BASE_URL}?time=46.0s&token=${TOKEN}`);
  });

  it('(b) pct_25_duracion_8s_arma_time_2_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 25,
      durationSeconds: 8,
    });

    expect(url).toBe(`${BASE_URL}?time=2.0s&token=${TOKEN}`);
  });

  it('(c) pct_75_duracion_100s_arma_time_75_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 75,
      durationSeconds: 100,
    });

    expect(url).toBe(`${BASE_URL}?time=75.0s&token=${TOKEN}`);
  });

  // ── Boundaries exactos de pct ──────────────────────────────────────────

  it('(d) pct_0_arma_time_0_0s', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 0,
      durationSeconds: 92,
    });

    expect(url).toBe(`${BASE_URL}?time=0.0s&token=${TOKEN}`);
  });

  it('(e) pct_100_arma_time_igual_a_duracion', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 100,
      durationSeconds: 40,
    });

    expect(url).toBe(`${BASE_URL}?time=40.0s&token=${TOKEN}`);
  });

  // ── Clamp de pct fuera de [0,100] ───────────────────────────────────────

  it('(f) pct_negativo_se_clampea_a_0: pct=-10 se comporta como pct=0', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: -10,
      durationSeconds: 92,
    });

    expect(url).toBe(`${BASE_URL}?time=0.0s&token=${TOKEN}`);
  });

  it('(g) pct_mayor_a_100_se_clampea_a_100: pct=150 se comporta como pct=100', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 150,
      durationSeconds: 100,
    });

    expect(url).toBe(`${BASE_URL}?time=100.0s&token=${TOKEN}`);
  });

  // ── duration null — video sin duración conocida (aún processing) ────────

  it('(h) duration_null_omite_parametro_time: sin duración, la URL no incluye time=', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 50,
      durationSeconds: null,
    });

    expect(url).toBe(`${BASE_URL}?token=${TOKEN}`);
    expect(url).not.toContain('time=');
  });

  it('(i) duration_null_con_pct_no_cero_sigue_omitiendo_time: el pct es irrelevante sin duración', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 99,
      durationSeconds: null,
    });

    expect(url).toBe(`${BASE_URL}?token=${TOKEN}`);
  });

  // ── duration = 0 (boundary: no es null, pero el cálculo da 0) ───────────

  it('(j) duration_cero_con_pct_cualquiera_arma_time_0_0s: duration=0 SIGUE incluyendo time= (no es null)', () => {
    const url = build_thumbnail_frame_url({
      baseUrl: BASE_URL,
      token: TOKEN,
      pct: 75,
      durationSeconds: 0,
    });

    expect(url).toBe(`${BASE_URL}?time=0.0s&token=${TOKEN}`);
  });

  // ── Preserva baseUrl/token literal (no reescribe el host ni el path) ────

  it('(k) preserva_baseurl_y_token_literal_en_la_url: baseUrl y token viajan sin modificar', () => {
    const custom_base = 'https://customer-abc123.cloudflarestream.com/xyz789/thumbnails/thumbnail.jpg';
    const custom_token = 'eyJhbGciOiJSUzI1NiJ9.payload.signature';

    const url = build_thumbnail_frame_url({
      baseUrl: custom_base,
      token: custom_token,
      pct: 10,
      durationSeconds: 20,
    });

    expect(url).toBe(`${custom_base}?time=2.0s&token=${custom_token}`);
  });
});
