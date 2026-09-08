/**
 * Tests fase RED — viewport_to_area (contrato NUEVO: círculo INSCRITO)
 * Archivo SUT: mobile/src/features/map/lib/viewportToArea.ts
 * Subtarea Taskmaster: 281.1 — viewport_to_area inscrito + format_radius_m.
 * Doc de exploración: .taskmaster/docs/exploraciones/046-zona-visible-y-buscador-claro.md
 * (decisión de Abraham 2026-09-08: opción B, círculo inscrito — revierte el
 * trade-off "circunscrito" de la decisión 1 de la exploración 030/#56.1).
 *
 * SUT: viewport_to_area(region: Region): { center: {lat, lng}, radius_m: number }
 *
 * Contrato NUEVO:
 *   - `center = { lat: region.latitude, lng: region.longitude }` — passthrough exacto (sin cambio).
 *   - `radius_m` = mínimo entre:
 *       (a) Haversine(centro, centro + latitudeDelta/2 hacia el norte, misma lng) — media ALTURA.
 *       (b) Haversine(centro, centro + longitudeDelta/2 hacia el este, misma lat) — media ANCHURA.
 *     Es decir, el radio del círculo INSCRITO en el rectángulo del viewport (WYSIWYG:
 *     el círculo NUNCA se sale del viewport, a costa de NO cubrir las 4 esquinas ni,
 *     si el viewport es muy asimétrico, las franjas sobrantes del lado más largo).
 *   - Clamp: MIN_RADIUS_M=100 <= radius_m <= MAX_RADIUS_M=50_000 (sin cambio).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÁLCULO A MANO (Haversine, R=6371000m), verificado con:
 *   node -e '... (haversine + min(media altura, media anchura)) ...'
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * GDL_REGION (mobile/src/features/map/constants.ts): lat=20.6736, lng=-103.344,
 *   latitudeDelta=0.12, longitudeDelta=0.12 (viewport CUADRADO).
 *   media altura  = Haversine((20.6736,-103.344), (20.7336,-103.344))  ≈ 6671.6956 m
 *   media anchura = Haversine((20.6736,-103.344), (20.6736,-103.284)) ≈ 6242.0837 m
 *   → radio esperado = min(6671.6956, 6242.0837) ≈ 6242.08 m (±2%)
 *   Diagonal (fórmula VIEJA, ya no aplica) ≈ 9135.63 m — el nuevo radio debe ser
 *   claramente MENOR (assert < 7000) que esa diagonal.
 *
 * VIEWPORT_VERTICAL (teléfono, latitudeDelta > longitudeDelta): lat=20.6736,
 *   lng=-103.344, latitudeDelta=0.12, longitudeDelta=0.06.
 *   media altura  ≈ 6671.6956 m (igual que arriba, no cambió latitudeDelta)
 *   media anchura ≈ 3121.0419 m (longitudeDelta a la mitad → mitad de la anchura de GDL)
 *   → GANA la media anchura (menor): radio esperado ≈ 3121.04 m (±2%)
 *   Diagonal vieja (para contraste, un mutante que no migró) ≈ 7365.36 m — muy distinta.
 *
 * VIEWPORT_HORIZONTAL (tablet, longitudeDelta > latitudeDelta): lat=20.6736,
 *   lng=-103.344, latitudeDelta=0.03, longitudeDelta=0.12.
 *   media altura  ≈ 1667.9239 m (latitudeDelta a un cuarto de GDL)
 *   media anchura ≈ 6242.0837 m (igual que GDL, no cambió longitudeDelta)
 *   → GANA la media altura (menor): radio esperado ≈ 1667.92 m (±2%)
 *   Diagonal vieja (contraste) ≈ 6460.78 m — muy distinta.
 *
 * CDMX_REGION (viewport asimétrico, NO existe en constants.ts): lat=19.4326,
 *   lng=-99.1332, latitudeDelta=0.05, longitudeDelta=0.08.
 *   media altura  ≈ 2779.8732 m
 *   media anchura ≈ 4194.4217 m (cos(19.4326°)≈0.9430)
 *   → GANA la media altura (menor): radio esperado ≈ 2779.87 m (±2%)
 *
 * ZOOM_EXTREMO_CHICO: latitudeDelta=0.0001, longitudeDelta=0.0001 → media
 *   altura ≈ 5.56 m, media anchura ≈ 5.20 m, min ≈ 5.20 m, MUY por debajo de
 *   MIN_RADIUS_M=100 → clamp a EXACTAMENTE 100.
 *
 * ZOOM_EXTREMO_GRANDE: latitudeDelta=10, longitudeDelta=10 → media altura
 *   ≈ 555,974.63 m, media anchura ≈ 520,153.06 m, min ≈ 520,153.06 m, MUY por
 *   encima de MAX_RADIUS_M=50_000 → clamp a EXACTAMENTE 50000.
 *
 * EDGE CASES CUBIERTOS (11 casos):
 *
 * ### Happy path — conversión básica (círculo inscrito, GDL_REGION)
 * - (EC-1) gdl_region_centro_exacto_y_radio_inscrito_menor_que_diagonal_vieja
 *
 * ### Extracción de centro (passthrough exacto, sin cambio)
 * - (EC-2) centro_es_passthrough_exacto_de_latitude_longitude_sin_redondeo
 *
 * ### Clamp mínimo (zoom extremo chico)
 * - (EC-3) zoom_extremo_chico_clampa_a_min_radius_m_100
 *
 * ### Clamp máximo (zoom extremo grande)
 * - (EC-4) zoom_extremo_grande_clampa_a_max_radius_m_50000
 *
 * ### Nuevo contrato — gana el lado MENOR del rectángulo (no la diagonal)
 * - (EC-5) viewport_vertical_gana_la_media_anchura_no_la_media_altura
 * - (EC-6) viewport_horizontal_gana_la_media_altura_no_la_media_anchura
 * - (EC-7) cdmx_region_asimetrica_radio_es_la_media_altura_menor_que_la_anchura
 *
 * ### Boundary — radio dentro de rango normal NO se clampa
 * - (EC-8) radio_en_rango_normal_no_se_clampa_ni_a_min_ni_a_max
 *
 * ### Determinismo / pureza
 * - (EC-9) misma_region_produce_siempre_el_mismo_resultado_funcion_pura
 *
 * ### Mutante: usar max en vez de min NUNCA debe pasar ambos EC-5 y EC-6 a la vez
 * (cubierto implícitamente: EC-5 y EC-6 usan viewports con lado ganador
 * INVERTIDO entre sí, así que max() falla en al menos uno de los dos).
 */

import { GDL_REGION } from '../constants';
import type { Region } from '../lib/clusterMarkers';
import { viewport_to_area, MIN_RADIUS_M, MAX_RADIUS_M } from '../lib/viewportToArea';

// ---------------------------------------------------------------------------
// Regiones de prueba
// ---------------------------------------------------------------------------

/** CDMX: viewport asimétrico (latitudeDelta != longitudeDelta), NO existe en constants.ts. */
const CDMX_REGION: Region = {
  latitude: 19.4326,
  longitude: -99.1332,
  latitudeDelta: 0.05,
  longitudeDelta: 0.08,
};

/** Viewport vertical (teléfono): latitudeDelta > longitudeDelta → gana la media anchura. */
const VIEWPORT_VERTICAL: Region = {
  latitude: 20.6736,
  longitude: -103.344,
  latitudeDelta: 0.12,
  longitudeDelta: 0.06,
};

/** Viewport horizontal (tablet): longitudeDelta > latitudeDelta → gana la media altura. */
const VIEWPORT_HORIZONTAL: Region = {
  latitude: 20.6736,
  longitude: -103.344,
  latitudeDelta: 0.03,
  longitudeDelta: 0.12,
};

/** Zoom extremo chico: casi una cuadra — el radio crudo cae MUY por debajo de MIN_RADIUS_M. */
const ZOOM_EXTREMO_CHICO: Region = {
  latitude: 20.6736,
  longitude: -103.344,
  latitudeDelta: 0.0001,
  longitudeDelta: 0.0001,
};

/** Zoom extremo grande: viewport del tamaño de un país — el radio crudo excede MAX_RADIUS_M. */
const ZOOM_EXTREMO_GRANDE: Region = {
  latitude: 20.6736,
  longitude: -103.344,
  latitudeDelta: 10,
  longitudeDelta: 10,
};

describe('viewport_to_area (círculo inscrito)', () => {
  it('(EC-1) gdl_region_centro_exacto_y_radio_inscrito_menor_que_diagonal_vieja: GDL_REGION → center={lat:20.6736,lng:-103.344}, radius_m ≈ 6242.08 (±2%) y estrictamente < 7000 (la diagonal vieja era ~9135.6)', () => {
    const result = viewport_to_area(GDL_REGION);

    expect(result.center).toEqual({ lat: 20.6736, lng: -103.344 });
    const esperado = 6242.083741037052;
    expect(result.radius_m).toBeGreaterThanOrEqual(esperado * 0.98);
    expect(result.radius_m).toBeLessThanOrEqual(esperado * 1.02);
    expect(result.radius_m).toBeLessThan(7000);
  });

  it('(EC-2) centro_es_passthrough_exacto_de_latitude_longitude_sin_redondeo: center.lat === region.latitude, center.lng === region.longitude exactos (sin redondeo)', () => {
    const region: Region = {
      latitude: 19.123456,
      longitude: -99.654321,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    };

    const result = viewport_to_area(region);

    expect(result.center.lat).toBe(region.latitude);
    expect(result.center.lng).toBe(region.longitude);
  });

  it('(EC-3) zoom_extremo_chico_clampa_a_min_radius_m_100: latitudeDelta/longitudeDelta=0.0001 (radio crudo inscrito ~5.2m) → radius_m === MIN_RADIUS_M (100), exacto', () => {
    const result = viewport_to_area(ZOOM_EXTREMO_CHICO);

    expect(result.radius_m).toBe(100);
    expect(result.radius_m).toBe(MIN_RADIUS_M);
  });

  it('(EC-4) zoom_extremo_grande_clampa_a_max_radius_m_50000: latitudeDelta/longitudeDelta=10 (radio crudo inscrito ~520km) → radius_m === MAX_RADIUS_M (50000), exacto', () => {
    const result = viewport_to_area(ZOOM_EXTREMO_GRANDE);

    expect(result.radius_m).toBe(50000);
    expect(result.radius_m).toBe(MAX_RADIUS_M);
  });

  it('(EC-5) viewport_vertical_gana_la_media_anchura_no_la_media_altura: latitudeDelta=0.12, longitudeDelta=0.06 → radius_m ≈ 3121.04 (±2%), NO ≈ 6671.70 (media altura) ni ≈ 7365.36 (diagonal vieja)', () => {
    const result = viewport_to_area(VIEWPORT_VERTICAL);

    const esperado = 3121.041883849568;
    expect(result.radius_m).toBeGreaterThanOrEqual(esperado * 0.98);
    expect(result.radius_m).toBeLessThanOrEqual(esperado * 1.02);
  });

  it('(EC-6) viewport_horizontal_gana_la_media_altura_no_la_media_anchura: latitudeDelta=0.03, longitudeDelta=0.12 → radius_m ≈ 1667.92 (±2%), NO ≈ 6242.08 (media anchura) ni ≈ 6460.78 (diagonal vieja)', () => {
    const result = viewport_to_area(VIEWPORT_HORIZONTAL);

    const esperado = 1667.9238996684442;
    expect(result.radius_m).toBeGreaterThanOrEqual(esperado * 0.98);
    expect(result.radius_m).toBeLessThanOrEqual(esperado * 1.02);
  });

  it('(EC-7) cdmx_region_asimetrica_radio_es_la_media_altura_menor_que_la_anchura: CDMX_REGION → radius_m ≈ 2779.87 (±2%), menor que la media anchura 4194.42m calculada a mano', () => {
    const result = viewport_to_area(CDMX_REGION);

    const esperado = 2779.87316611381;
    expect(result.radius_m).toBeGreaterThanOrEqual(esperado * 0.98);
    expect(result.radius_m).toBeLessThanOrEqual(esperado * 1.02);
    expect(result.radius_m).toBeLessThan(4194.421683182413);
  });

  it('(EC-8) radio_en_rango_normal_no_se_clampa_ni_a_min_ni_a_max: GDL_REGION produce un radio estrictamente ENTRE MIN_RADIUS_M y MAX_RADIUS_M (no toca ninguno de los dos clamps)', () => {
    const result = viewport_to_area(GDL_REGION);

    expect(result.radius_m).toBeGreaterThan(MIN_RADIUS_M);
    expect(result.radius_m).toBeLessThan(MAX_RADIUS_M);
  });

  it('(EC-9) misma_region_produce_siempre_el_mismo_resultado_funcion_pura: dos llamadas con el MISMO objeto Region (valores nuevos, no la misma referencia) devuelven resultados idénticos', () => {
    const region_1: Region = { ...GDL_REGION };
    const region_2: Region = { ...GDL_REGION };

    const result_1 = viewport_to_area(region_1);
    const result_2 = viewport_to_area(region_2);

    expect(result_1).toEqual(result_2);
  });
});
