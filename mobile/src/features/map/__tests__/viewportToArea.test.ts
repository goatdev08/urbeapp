/**
 * Tests fase RED — viewport_to_area
 * Archivo SUT: mobile/src/features/map/lib/viewportToArea.ts
 * Subtarea Taskmaster: 56.1 — Extend FilterState with area field and viewport
 * calculation library.
 * Doc de exploración: .taskmaster/docs/exploraciones/030-buscar-en-esta-zona.md
 *
 * SUT: viewport_to_area(region: Region): { center: {lat, lng}, radius_m: number }
 *
 * Contrato (decisión G1 de la exploración 030):
 *   - `center = { lat: region.latitude, lng: region.longitude }` — passthrough exacto.
 *   - `radius_m` = distancia Haversine del centro a la esquina del viewport,
 *     usando (latitudeDelta/2, longitudeDelta/2) como offset de la esquina —
 *     es decir, la mitad de la diagonal del rectángulo visible. El círculo
 *     resultante SOBRE-incluye las esquinas del rectángulo (aceptado para la
 *     demo, ver exploración 030 "Edge cases / riesgos").
 *   - Clamp: MIN_RADIUS_M=100 <= radius_m <= MAX_RADIUS_M=50_000.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÁLCULO A MANO (Haversine, R=6371000m) — verificado con Python (math.radians +
 * math.sin/cos/atan2), ver bitácora de la subtarea 56.1 para el script exacto.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * GDL_REGION (mobile/src/features/map/constants.ts):
 *   center = (lat=20.6736, lng=-103.344)
 *   esquina = (lat=20.6736+0.12/2=20.7336, lng=-103.344+0.12/2=-103.284)
 *   Haversine(center, esquina) ≈ 9135.63 m
 *   → radio esperado en [8678.85, 9592.41] (±5%), y dentro del rango
 *     "sano" 9000-11000 m documentado en la subtarea.
 *
 * CDMX_REGION (elegido para este archivo, NO existe en constants.ts):
 *   center = (lat=19.4326, lng=-99.1332), latitudeDelta=0.05, longitudeDelta=0.08
 *   esquina = (lat=19.4326+0.025=19.4576, lng=-99.1332+0.04=-99.0932)
 *   Haversine(center, esquina) ≈ 5031.72 m
 *   → radio esperado en [4780.13, 5283.30] (±5%).
 *
 * ZOOM_EXTREMO_CHICO: latitudeDelta=0.0001, longitudeDelta=0.0001 → Haversine
 *   crudo ≈ 7.61 m, MUY por debajo de MIN_RADIUS_M=100 → clamp a EXACTAMENTE 100.
 *
 * ZOOM_EXTREMO_GRANDE: latitudeDelta=10, longitudeDelta=10 → Haversine crudo
 *   ≈ 755,026.78 m, MUY por encima de MAX_RADIUS_M=50_000 → clamp a
 *   EXACTAMENTE 50000.
 *
 * EDGE CASES CUBIERTOS (7 casos):
 *
 * ### Happy path — conversión básica (GDL_REGION)
 * - (EC-1) gdl_region_centro_exacto_y_radio_dentro_del_rango_9000_11000
 *
 * ### Extracción de centro (passthrough exacto)
 * - (EC-2) centro_es_passthrough_exacto_de_latitude_longitude_sin_redondeo
 *
 * ### Clamp mínimo (zoom extremo chico)
 * - (EC-3) zoom_extremo_chico_clampa_a_min_radius_m_100
 *
 * ### Clamp máximo (zoom extremo grande)
 * - (EC-4) zoom_extremo_grande_clampa_a_max_radius_m_50000
 *
 * ### Precisión Haversine (viewport asimétrico conocido, CDMX)
 * - (EC-5) cdmx_region_radio_dentro_de_5_porciento_del_valor_calculado_a_mano
 *
 * ### Boundary — radio dentro de rango normal NO se clampa
 * - (EC-6) radio_en_rango_normal_no_se_clampa_ni_a_min_ni_a_max
 *
 * ### Determinismo / pureza
 * - (EC-7) misma_region_produce_siempre_el_mismo_resultado_funcion_pura
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

describe('viewport_to_area', () => {
  it('(EC-1) gdl_region_centro_exacto_y_radio_dentro_del_rango_9000_11000: GDL_REGION → center={lat:20.6736,lng:-103.344}, radius_m en [9000,11000]', () => {
    const result = viewport_to_area(GDL_REGION);

    expect(result.center).toEqual({ lat: 20.6736, lng: -103.344 });
    expect(result.radius_m).toBeGreaterThanOrEqual(9000);
    expect(result.radius_m).toBeLessThanOrEqual(11000);
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

  it('(EC-3) zoom_extremo_chico_clampa_a_min_radius_m_100: latitudeDelta/longitudeDelta=0.0001 (radio crudo ~7.6m) → radius_m === MIN_RADIUS_M (100), exacto', () => {
    const result = viewport_to_area(ZOOM_EXTREMO_CHICO);

    expect(result.radius_m).toBe(100);
    expect(result.radius_m).toBe(MIN_RADIUS_M);
  });

  it('(EC-4) zoom_extremo_grande_clampa_a_max_radius_m_50000: latitudeDelta/longitudeDelta=10 (radio crudo ~755km) → radius_m === MAX_RADIUS_M (50000), exacto', () => {
    const result = viewport_to_area(ZOOM_EXTREMO_GRANDE);

    expect(result.radius_m).toBe(50000);
    expect(result.radius_m).toBe(MAX_RADIUS_M);
  });

  it('(EC-5) cdmx_region_radio_dentro_de_5_porciento_del_valor_calculado_a_mano: CDMX_REGION (viewport asimétrico) → radius_m en [4780.13, 5283.30] (±5% de 5031.72m calculado a mano con Haversine)', () => {
    const result = viewport_to_area(CDMX_REGION);

    const esperado = 5031.715287775889;
    expect(result.radius_m).toBeGreaterThanOrEqual(esperado * 0.95);
    expect(result.radius_m).toBeLessThanOrEqual(esperado * 1.05);
  });

  it('(EC-6) radio_en_rango_normal_no_se_clampa_ni_a_min_ni_a_max: GDL_REGION produce un radio estrictamente ENTRE MIN_RADIUS_M y MAX_RADIUS_M (no toca ninguno de los dos clamps)', () => {
    const result = viewport_to_area(GDL_REGION);

    expect(result.radius_m).toBeGreaterThan(MIN_RADIUS_M);
    expect(result.radius_m).toBeLessThan(MAX_RADIUS_M);
  });

  it('(EC-7) misma_region_produce_siempre_el_mismo_resultado_funcion_pura: dos llamadas con el MISMO objeto Region (valores nuevos, no la misma referencia) devuelven resultados idénticos', () => {
    const region_1: Region = { ...GDL_REGION };
    const region_2: Region = { ...GDL_REGION };

    const result_1 = viewport_to_area(region_1);
    const result_2 = viewport_to_area(region_2);

    expect(result_1).toEqual(result_2);
  });
});
