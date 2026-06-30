/**
 * Tests fase RED — cluster_properties
 * Archivo SUT: mobile/src/features/map/lib/clusterMarkers.ts
 * Subtarea Taskmaster: 11.3 — Implement clustering (lógica pura, sin dependencia externa)
 *
 * SUT: cluster_properties(properties, region, options?) → ClusterResult[]
 *
 * Algoritmo: grid absoluto anclado en (0,0).
 *   divisions = options?.divisions ?? 8
 *   cellLng = longitudeDelta / divisions
 *   cellLat = latitudeDelta / divisions
 *   celda(prop) = (floor(lng / cellLng), floor(lat / cellLat))
 *   1 prop en celda  → { type:'point', property }
 *   >1 props en celda → { type:'cluster', cluster: { id, latitude, longitude, count, properties } }
 *       id        = 'cluster_<cellX>_<cellY>'
 *       latitude  = media aritmética de .lat de los miembros
 *       longitude = media aritmética de .lng de los miembros
 *   GUARD delta<=0 → todas las props como points individuales, sin NaN.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CÁLCULO A MANO DE COORDENADAS DE PRUEBA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * REGION_A: latitudeDelta=8, longitudeDelta=8, divisions=8 → cellLat=1.0, cellLng=1.0
 *   P1(lng=0.1, lat=0.1): cellX=floor(0.1/1.0)=0, cellY=floor(0.1/1.0)=0 → celda(0,0)
 *   P2(lng=0.8, lat=0.8): cellX=floor(0.8/1.0)=0, cellY=floor(0.8/1.0)=0 → celda(0,0) [misma que P1]
 *   P3(lng=5.5, lat=4.5): cellX=floor(5.5/1.0)=5, cellY=floor(4.5/1.0)=4 → celda(5,4) [distinta]
 *
 * REGION_B (zoom IN): latitudeDelta=1, longitudeDelta=1, divisions=8 → cellSize=0.125
 *   P1(lng=0.1, lat=0.1): cellX=floor(0.1/0.125)=floor(0.8)=0 → celda(0,0)
 *   P2(lng=0.8, lat=0.8): cellX=floor(0.8/0.125)=floor(6.4)=6 → celda(6,6) [DISTINTA de P1]
 *
 * REGION_C (zoom OUT): latitudeDelta=80, longitudeDelta=80, divisions=8 → cellSize=10.0
 *   P2(lng=0.8, lat=0.8): cellX=floor(0.8/10)=0 → celda(0,0)
 *   P3(lng=5.5, lat=4.5): cellX=floor(5.5/10)=0, cellY=floor(4.5/10)=0 → celda(0,0) [MISMA que P2]
 *
 * REGION_A, divisions=16: cellSize=8/16=0.5
 *   P1(lng=0.1, lat=0.1): cellX=floor(0.1/0.5)=0 → celda(0,0)
 *   P2(lng=0.8, lat=0.8): cellX=floor(0.8/0.5)=floor(1.6)=1 → celda(1,1) [DISTINTA de P1]
 *
 * Centroide cluster P1+P2:
 *   lat  = (0.1 + 0.8) / 2 = 0.45
 *   lng  = (0.1 + 0.8) / 2 = 0.45
 *
 * ID cluster celda(0,0): 'cluster_0_0'
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * EDGE CASES CUBIERTOS (14 casos):
 *
 * ### Happy path
 * - (EC-1)  vacio_devuelve_array_vacio
 * - (EC-2)  una_propiedad_devuelve_un_point_nunca_cluster
 * - (EC-3)  dos_propiedades_celdas_distintas_devuelven_dos_points
 *
 * ### Agrupamiento principal
 * - (EC-4)  dos_propiedades_misma_celda_un_cluster_count_2
 * - (EC-5)  centroide_es_media_aritmetica_exacta
 * - (EC-6)  tres_propiedades_dos_juntas_una_lejos_cluster_mas_point
 * - (EC-7)  cluster_contiene_map_properties_completas
 *
 * ### Tipo discriminado
 * - (EC-8)  type_discriminado_point_vs_cluster_segun_ocupacion_celda
 *
 * ### Efecto zoom
 * - (EC-9)  zoom_in_separa_cluster_en_dos_points
 * - (EC-10) zoom_out_agrupa_dos_points_en_cluster
 *
 * ### options.divisions override
 * - (EC-11) divisions_override_afecta_agrupamiento
 *
 * ### Guard delta <= 0
 * - (EC-12) guard_latitudedelta_cero_todos_points_sin_nan
 * - (EC-13) guard_longitudedelta_negativo_todos_points_sin_nan
 *
 * ### ID determinista
 * - (EC-14) id_cluster_es_string_determinista_formato_celda
 */

import { cluster_properties } from '../lib/clusterMarkers';
import type { ClusterResult, Region, ClusterOptions } from '../lib/clusterMarkers';
import type { MapProperty } from '../types';

// ---------------------------------------------------------------------------
// Regiones de prueba
// ---------------------------------------------------------------------------

/** REGION_A: zoom estándar. cellSize=1.0 (latDelta=8, longDelta=8, div=8). */
const REGION_A: Region = {
  latitude: 4,
  longitude: 4,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

/** REGION_B: zoom IN. cellSize=0.125 (latDelta=1, longDelta=1, div=8). */
const REGION_B: Region = {
  latitude: 0.5,
  longitude: 0.5,
  latitudeDelta: 1,
  longitudeDelta: 1,
};

/** REGION_C: zoom OUT. cellSize=10.0 (latDelta=80, longDelta=80, div=8). */
const REGION_C: Region = {
  latitude: 40,
  longitude: 40,
  latitudeDelta: 80,
  longitudeDelta: 80,
};

// ---------------------------------------------------------------------------
// Propiedades de prueba — coordenadas calculadas a mano (ver cabecera)
// ---------------------------------------------------------------------------

/**
 * P1: lng=0.1, lat=0.1
 * → REGION_A(div=8): celda(0,0)   [floor(0.1/1.0)=0]
 * → REGION_B(div=8): celda(0,0)   [floor(0.1/0.125)=floor(0.8)=0]
 * → REGION_A(div=16): celda(0,0)  [floor(0.1/0.5)=0]
 */
const P1: MapProperty = {
  id: 'p1',
  price: 1_650_000,
  lat: 0.1,
  lng: 0.1,
  operation_type: 'sale',
  property_type: 'house',
  bedrooms: 3,
  bathrooms: 2,
  address: 'Calle Uno 100, Guadalajara',
};

/**
 * P2: lng=0.8, lat=0.8
 * → REGION_A(div=8): celda(0,0)   [floor(0.8/1.0)=0] — MISMA que P1 → cluster con P1
 * → REGION_B(div=8): celda(6,6)   [floor(0.8/0.125)=floor(6.4)=6] — DISTINTA de P1
 * → REGION_C(div=8): celda(0,0)   [floor(0.8/10)=0] — MISMA que P3 → cluster con P3
 * → REGION_A(div=16): celda(1,1)  [floor(0.8/0.5)=floor(1.6)=1] — DISTINTA de P1
 */
const P2: MapProperty = {
  id: 'p2',
  price: 2_400_000,
  lat: 0.8,
  lng: 0.8,
  operation_type: 'rent',
  property_type: 'apartment',
  bedrooms: 2,
  bathrooms: 1,
  address: 'Calle Dos 200, Guadalajara',
};

/**
 * P3: lng=5.5, lat=4.5
 * → REGION_A(div=8): celda(5,4)   [floor(5.5/1.0)=5, floor(4.5/1.0)=4] — DISTINTA de P1/P2
 * → REGION_C(div=8): celda(0,0)   [floor(5.5/10)=0, floor(4.5/10)=0] — MISMA que P2
 */
const P3: MapProperty = {
  id: 'p3',
  price: 3_200_000,
  lat: 4.5,
  lng: 5.5,
  operation_type: 'sale',
  property_type: 'house',
  bedrooms: 4,
  bathrooms: 3,
  address: 'Avenida Tres 300, CDMX',
};

// ---------------------------------------------------------------------------
// Helpers de extracción con type narrowing
// ---------------------------------------------------------------------------

/**
 * Encuentra el primer ClusterResult de tipo 'cluster' en el array.
 * Lanza si no existe, para que el test falle con mensaje claro.
 */
function find_cluster(
  results: ClusterResult[],
): Extract<ClusterResult, { type: 'cluster' }> {
  const found = results.find((r) => r.type === 'cluster');
  if (!found || found.type !== 'cluster') {
    throw new Error(
      `find_cluster: no se encontró ningún cluster en [${results.map((r) => r.type).join(', ')}]`,
    );
  }
  return found;
}

/**
 * Encuentra el primer ClusterResult de tipo 'point' en el array.
 * Lanza si no existe.
 */
function find_point(
  results: ClusterResult[],
): Extract<ClusterResult, { type: 'point' }> {
  const found = results.find((r) => r.type === 'point');
  if (!found || found.type !== 'point') {
    throw new Error(
      `find_point: no se encontró ningún point en [${results.map((r) => r.type).join(', ')}]`,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cluster_properties', () => {

  // ── (EC-1) Lista vacía → [] ───────────────────────────────────────────────

  it('(EC-1) vacio_devuelve_array_vacio: lista vacía → [] sin lanzar excepción', () => {
    const result = cluster_properties([], REGION_A);
    expect(result).toEqual([]);
  });

  // ── (EC-2) 1 propiedad → 1 point, nunca cluster ──────────────────────────

  it('(EC-2) una_propiedad_devuelve_un_point_nunca_cluster: 1 prop → length=1, type="point", nunca {type:"cluster"}', () => {
    const result = cluster_properties([P1], REGION_A);

    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe('point');
    // Una sola propiedad no puede ser un cluster
    expect(result.some((r) => r.type === 'cluster')).toBe(false);
  });

  // ── (EC-3) 2 props en celdas distintas → 2 points ────────────────────────
  // REGION_A celda P1=(0,0), celda P3=(5,4) — completamente distintas

  it('(EC-3) dos_propiedades_celdas_distintas_devuelven_dos_points: P1(celda 0,0) + P3(celda 5,4) con REGION_A → 2 results, ambos type="point", sin ningún cluster', () => {
    // Cálculo: cellLng=1.0, cellLat=1.0
    //   P1: cellX=floor(0.1/1.0)=0, cellY=floor(0.1/1.0)=0 → (0,0)
    //   P3: cellX=floor(5.5/1.0)=5, cellY=floor(4.5/1.0)=4 → (5,4) — distintas
    const result = cluster_properties([P1, P3], REGION_A);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'point')).toBe(true);
    expect(result.some((r) => r.type === 'cluster')).toBe(false);

    // Verificar que ambas propiedades están presentes
    const ids = result.map((r) => (r.type === 'point' ? r.property.id : null)).sort();
    expect(ids).toEqual(['p1', 'p3']);
  });

  // ── (EC-4) 2 props misma celda → 1 cluster count=2 ───────────────────────
  // REGION_A: P1 y P2 caen en celda(0,0) → deben clusterizarse

  it('(EC-4) dos_propiedades_misma_celda_un_cluster_count_2: P1(celda 0,0) + P2(celda 0,0) con REGION_A → 1 result con type="cluster" y count=2', () => {
    // Cálculo: cellLng=1.0, cellLat=1.0
    //   P1: cellX=floor(0.1/1.0)=0, cellY=floor(0.1/1.0)=0 → (0,0)
    //   P2: cellX=floor(0.8/1.0)=0, cellY=floor(0.8/1.0)=0 → (0,0) — MISMA celda
    const result = cluster_properties([P1, P2], REGION_A);

    expect(result).toHaveLength(1);
    const r = find_cluster(result);
    expect(r.cluster.count).toBe(2);
  });

  // ── (EC-5) Centroide = media aritmética exacta ────────────────────────────
  // P1(lat=0.1, lng=0.1) + P2(lat=0.8, lng=0.8) → centroide lat=0.45, lng=0.45

  it('(EC-5) centroide_es_media_aritmetica_exacta: cluster P1+P2 → latitude=(0.1+0.8)/2=0.45, longitude=(0.1+0.8)/2=0.45', () => {
    // Cálculo del centroide esperado:
    //   latitude  = (0.1 + 0.8) / 2 = 0.45
    //   longitude = (0.1 + 0.8) / 2 = 0.45
    const result = cluster_properties([P1, P2], REGION_A);

    const r = find_cluster(result);
    expect(r.cluster.latitude).toBe(0.45);
    expect(r.cluster.longitude).toBe(0.45);
  });

  // ── (EC-6) 3 props: 2 juntas + 1 lejos → 1 cluster + 1 point ────────────

  it('(EC-6) tres_propiedades_dos_juntas_una_lejos_cluster_mas_point: P1+P2(celda 0,0) + P3(celda 5,4) con REGION_A → 2 results: 1 cluster(count=2) + 1 point(id=p3)', () => {
    const result = cluster_properties([P1, P2, P3], REGION_A);

    expect(result).toHaveLength(2);

    // Debe haber exactamente 1 cluster y 1 point
    const clusters = result.filter((r) => r.type === 'cluster');
    const points = result.filter((r) => r.type === 'point');
    expect(clusters).toHaveLength(1);
    expect(points).toHaveLength(1);

    // El cluster agrupa P1 y P2
    const cluster = find_cluster(result);
    expect(cluster.cluster.count).toBe(2);

    // El point es P3
    const point = find_point(result);
    expect(point.property.id).toBe('p3');
  });

  // ── (EC-7) cluster.properties contiene las MapProperty completas ──────────

  it('(EC-7) cluster_contiene_map_properties_completas: cluster.properties tiene los objetos MapProperty originales de P1 y P2 (todos sus campos intactos)', () => {
    const result = cluster_properties([P1, P2], REGION_A);

    const r = find_cluster(result);
    expect(r.cluster.properties).toHaveLength(2);

    // Verifica que los ids de ambas propiedades estén en el cluster
    const ids_en_cluster = r.cluster.properties.map((p) => p.id).sort();
    expect(ids_en_cluster).toEqual(['p1', 'p2']);

    // Verifica que los objetos completos son los originales (no solo el id)
    const p1_en_cluster = r.cluster.properties.find((p) => p.id === 'p1');
    const p2_en_cluster = r.cluster.properties.find((p) => p.id === 'p2');
    expect(p1_en_cluster).toEqual(P1);
    expect(p2_en_cluster).toEqual(P2);
  });

  // ── (EC-8) type discriminado correctamente ────────────────────────────────

  it('(EC-8) type_discriminado_point_vs_cluster_segun_ocupacion_celda: P1 solo → type="point" con property; P1+P2 juntas → type="cluster" con cluster.count; los dos tipos son mutuamente excluyentes', () => {
    const result_un_prop = cluster_properties([P1], REGION_A);
    const result_cluster = cluster_properties([P1, P2], REGION_A);

    // Un solo marcador → point, tiene .property
    const point_r = result_un_prop[0]!;
    expect(point_r.type).toBe('point');
    // TypeScript narrowing via cast para verificar la forma exacta
    if (point_r.type === 'point') {
      expect(point_r.property).toBeDefined();
      expect(point_r.property.id).toBe('p1');
    }

    // Dos en misma celda → cluster, tiene .cluster
    const cluster_r = result_cluster[0]!;
    expect(cluster_r.type).toBe('cluster');
    if (cluster_r.type === 'cluster') {
      expect(cluster_r.cluster).toBeDefined();
      expect(cluster_r.cluster.count).toBeGreaterThan(1);
    }
  });

  // ── (EC-9) Efecto zoom IN: cluster se separa en 2 points ─────────────────
  // P1+P2 con REGION_A (cellSize=1.0) → 1 cluster
  // P1+P2 con REGION_B (cellSize=0.125) → 2 points (P2 cae en celda(6,6))

  it('(EC-9) zoom_in_separa_cluster_en_dos_points: misma data P1+P2, REGION_A→1 cluster / REGION_B(cellSize=0.125)→2 points (P2 salta a celda(6,6))', () => {
    // Zoom OUT (REGION_A): ambas en celda(0,0) → cluster
    //   P1: floor(0.1/1.0)=0 → celda(0,0)
    //   P2: floor(0.8/1.0)=0 → celda(0,0) — misma
    const result_zoom_out = cluster_properties([P1, P2], REGION_A);
    expect(result_zoom_out).toHaveLength(1);
    expect(result_zoom_out[0]!.type).toBe('cluster');

    // Zoom IN (REGION_B): P2 salta a celda(6,6) → dos points distintos
    //   P1: floor(0.1/0.125)=floor(0.8)=0 → celda(0,0)
    //   P2: floor(0.8/0.125)=floor(6.4)=6 → celda(6,6) — DISTINTA
    const result_zoom_in = cluster_properties([P1, P2], REGION_B);
    expect(result_zoom_in).toHaveLength(2);
    expect(result_zoom_in.every((r) => r.type === 'point')).toBe(true);
  });

  // ── (EC-10) Efecto zoom OUT: 2 points se convierten en 1 cluster ─────────
  // P2+P3 con REGION_A (cellSize=1.0) → 2 points
  // P2+P3 con REGION_C (cellSize=10.0) → 1 cluster

  it('(EC-10) zoom_out_agrupa_dos_points_en_cluster: misma data P2+P3, REGION_A→2 points / REGION_C(cellSize=10.0)→1 cluster count=2', () => {
    // REGION_A: P2 en celda(0,0), P3 en celda(5,4) → distintas → 2 points
    //   P2: floor(0.8/1.0)=0 → celda(0,0)
    //   P3: floor(5.5/1.0)=5, floor(4.5/1.0)=4 → celda(5,4) — distinta
    const result_normal = cluster_properties([P2, P3], REGION_A);
    expect(result_normal).toHaveLength(2);
    expect(result_normal.every((r) => r.type === 'point')).toBe(true);

    // REGION_C (zoom OUT): cellSize=10.0; P2 y P3 caen en celda(0,0) → 1 cluster
    //   P2: floor(0.8/10)=0 → celda(0,0)
    //   P3: floor(5.5/10)=0, floor(4.5/10)=0 → celda(0,0) — MISMA que P2
    const result_zoom_out = cluster_properties([P2, P3], REGION_C);
    expect(result_zoom_out).toHaveLength(1);
    const r = find_cluster(result_zoom_out);
    expect(r.cluster.count).toBe(2);
  });

  // ── (EC-11) options.divisions override afecta agrupamiento ───────────────
  // P1+P2 con REGION_A, div=8 → 1 cluster (cellSize=1.0, ambas en celda(0,0))
  // P1+P2 con REGION_A, div=16 → 2 points (cellSize=0.5, P2 salta a celda(1,1))

  it('(EC-11) divisions_override_afecta_agrupamiento: P1+P2, REGION_A, div=16(cellSize=0.5) → P1 celda(0,0) / P2 celda(1,1) → 2 points (con div=8 sería 1 cluster)', () => {
    // div=8 (default): cellSize=1.0 → P1 y P2 en celda(0,0) → cluster
    const opts_default: ClusterOptions = { divisions: 8 };
    const result_div8 = cluster_properties([P1, P2], REGION_A, opts_default);
    expect(result_div8).toHaveLength(1);
    expect(result_div8[0]!.type).toBe('cluster');

    // div=16: cellSize=0.5 → P1 celda(0,0) / P2 celda(1,1) → 2 points separados
    //   P1: floor(0.1/0.5)=floor(0.2)=0 → celda(0,0)
    //   P2: floor(0.8/0.5)=floor(1.6)=1 → celda(1,1) — DISTINTA de P1
    const opts_div16: ClusterOptions = { divisions: 16 };
    const result_div16 = cluster_properties([P1, P2], REGION_A, opts_div16);
    expect(result_div16).toHaveLength(2);
    expect(result_div16.every((r) => r.type === 'point')).toBe(true);
  });

  // ── (EC-12) Guard: latitudeDelta=0 → todos como points, sin NaN ──────────

  it('(EC-12) guard_latitudedelta_cero_todos_points_sin_nan: region con latitudeDelta=0 → P1 y P2 devueltas como 2 points individuales, lat/lng sin NaN ni Infinity', () => {
    const region_lat_cero: Region = {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 0,   // guard: división por cero potencial
      longitudeDelta: 8,
    };

    const result = cluster_properties([P1, P2], region_lat_cero);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'point')).toBe(true);

    // Verificar que las coords de los points no son NaN ni Infinity
    for (const r of result) {
      if (r.type === 'point') {
        expect(Number.isFinite(r.property.lat)).toBe(true);
        expect(Number.isFinite(r.property.lng)).toBe(true);
        expect(Number.isNaN(r.property.lat)).toBe(false);
        expect(Number.isNaN(r.property.lng)).toBe(false);
      }
    }
  });

  // ── (EC-13) Guard: longitudeDelta<=0 → todos como points, sin NaN ─────────

  it('(EC-13) guard_longitudedelta_negativo_todos_points_sin_nan: region con longitudeDelta=-1 → P1 y P2 devueltas como 2 points individuales, lat/lng sin NaN ni Infinity', () => {
    const region_lng_negativo: Region = {
      latitude: 0,
      longitude: 0,
      latitudeDelta: 8,
      longitudeDelta: -1,  // guard: valor inválido
    };

    const result = cluster_properties([P1, P2], region_lng_negativo);

    expect(result).toHaveLength(2);
    expect(result.every((r) => r.type === 'point')).toBe(true);

    // Verificar que las coords de los points no son NaN ni Infinity
    for (const r of result) {
      if (r.type === 'point') {
        expect(Number.isFinite(r.property.lat)).toBe(true);
        expect(Number.isFinite(r.property.lng)).toBe(true);
        expect(Number.isNaN(r.property.lat)).toBe(false);
        expect(Number.isNaN(r.property.lng)).toBe(false);
      }
    }
  });

  // ── (EC-14) ID del cluster es string determinista con formato de celda ────
  // Cluster de P1+P2 en celda(0,0) → id='cluster_0_0'

  it('(EC-14) id_cluster_es_string_determinista_formato_celda: cluster de P1+P2 en celda(0,0) → id="cluster_0_0" (formato cluster_<cellX>_<cellY>), no vacío, determinista entre invocaciones', () => {
    const result1 = cluster_properties([P1, P2], REGION_A);
    const result2 = cluster_properties([P1, P2], REGION_A);

    const r1 = find_cluster(result1);
    const r2 = find_cluster(result2);

    // El id debe ser el string exacto 'cluster_0_0'
    // derivado de cellX=floor(0.1/1.0)=0, cellY=floor(0.1/1.0)=0
    expect(r1.cluster.id).toBe('cluster_0_0');

    // Determinista: dos invocaciones con misma entrada producen mismo id
    expect(r1.cluster.id).toBe(r2.cluster.id);

    // El id no está vacío
    expect(r1.cluster.id.length).toBeGreaterThan(0);
  });

});
