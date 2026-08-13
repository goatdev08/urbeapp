/**
 * Tests fase RED — neighborhoodPolygon (perímetro de colonia, #157.5)
 * Archivo SUT: mobile/src/features/map/lib/neighborhoodPolygon.ts
 *
 * Dos piezas:
 *
 * 1. geojson_to_polygons(geojson: string): LatLng[][] — PURA.
 *    GeoJSON (Polygon|MultiPolygon) → lista de anillos EXTERIORES en el formato
 *    de react-native-maps ({latitude, longitude}[]).
 *    ⚠️ GOTCHA de orden: GeoJSON es [lng, lat] (x, y) — hay que invertir. Mismo
 *    gotcha documentado en parse_location y en la RPC de radio.
 *    - Holes (anillos 2..n de un Polygon) se IGNORAN a propósito: sobre-pintar
 *      el relleno translúcido no es bug visible; el filtro real es la RPC.
 *    - Fail-closed: JSON inválido, tipo no soportado (Point…), coordenadas
 *      malformadas → [] (nunca lanza — es render, no lógica de negocio).
 *
 * 2. fetch_neighborhood_polygon(id: string, deps?): NeighborhoodPolygon | null
 *    Llama rpc('get_neighborhood_geojson', { p_neighborhood_id: Number(id) })
 *    (la RPC recibe bigint; el id viaja como string en PlaceSuggestion).
 *    - 0 filas → null (not-found, sin excepción).
 *    - error de RPC → throw Error(message).
 *    - Fila → { id, name, polygons (vía geojson_to_polygons), bbox }.
 *
 * EDGE CASES:
 * - (EC-NP1) polygon_simple_invierte_lng_lat
 * - (EC-NP2) multipolygon_devuelve_un_anillo_por_poligono
 * - (EC-NP3) holes_se_ignoran
 * - (EC-NP4) json_invalido_devuelve_vacio
 * - (EC-NP5) tipo_no_soportado_devuelve_vacio
 * - (EC-NP6) fetch_mapea_fila_a_neighborhood_polygon
 * - (EC-NP7) fetch_cero_filas_devuelve_null
 * - (EC-NP8) fetch_error_lanza
 */

import { geojson_to_polygons, fetch_neighborhood_polygon } from '../lib/neighborhoodPolygon';

// ---------------------------------------------------------------------------
// geojson_to_polygons (pura)
// ---------------------------------------------------------------------------

describe('geojson_to_polygons — GeoJSON → coordenadas react-native-maps (#157)', () => {
  it('(EC-NP1) polygon_simple_invierte_lng_lat: [[-103.38, 20.69], …] → [{latitude: 20.69, longitude: -103.38}, …]', () => {
    const geojson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [[-103.38, 20.69], [-103.36, 20.69], [-103.36, 20.71], [-103.38, 20.69]],
      ],
    });

    const result = geojson_to_polygons(geojson);

    expect(result).toEqual([
      [
        { latitude: 20.69, longitude: -103.38 },
        { latitude: 20.69, longitude: -103.36 },
        { latitude: 20.71, longitude: -103.36 },
        { latitude: 20.69, longitude: -103.38 },
      ],
    ]);
  });

  it('(EC-NP2) multipolygon_devuelve_un_anillo_por_poligono: MultiPolygon de 2 → 2 anillos exteriores', () => {
    const square = (offset: number) => [
      [[0 + offset, 0], [1 + offset, 0], [1 + offset, 1], [0 + offset, 0]],
    ];
    const geojson = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [square(0), square(10)],
    });

    const result = geojson_to_polygons(geojson);

    expect(result).toHaveLength(2);
    expect(result[0]?.[0]).toEqual({ latitude: 0, longitude: 0 });
    expect(result[1]?.[0]).toEqual({ latitude: 0, longitude: 10 });
  });

  it('(EC-NP3) holes_se_ignoran: Polygon con anillo interior → solo el exterior', () => {
    const geojson = JSON.stringify({
      type: 'Polygon',
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 0]],          // exterior
        [[2, 2], [3, 2], [3, 3], [2, 2]],             // hole — se ignora
      ],
    });

    const result = geojson_to_polygons(geojson);

    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(4);
  });

  it('(EC-NP4) json_invalido_devuelve_vacio: string no-JSON → [] sin lanzar', () => {
    expect(geojson_to_polygons('esto no es json {')).toEqual([]);
  });

  it('(EC-NP5) tipo_no_soportado_devuelve_vacio: Point → []', () => {
    expect(geojson_to_polygons(JSON.stringify({ type: 'Point', coordinates: [1, 2] }))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// fetch_neighborhood_polygon (RPC)
// ---------------------------------------------------------------------------

type GeojsonRow = {
  id: number;
  name: string;
  geojson: string;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
};

function make_mock_supabase(result: { data: GeojsonRow[] | null; error: { message: string } | null }) {
  const mock_rpc = jest.fn().mockResolvedValue(result);
  return { rpc: mock_rpc, _mock_rpc: mock_rpc };
}

const ROW: GeojsonRow = {
  id: 42,
  name: 'Providencia',
  geojson: JSON.stringify({
    type: 'MultiPolygon',
    coordinates: [[[[-103.38, 20.69], [-103.36, 20.69], [-103.36, 20.71], [-103.38, 20.69]]]],
  }),
  min_lat: 20.69,
  min_lng: -103.38,
  max_lat: 20.71,
  max_lng: -103.36,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetch_neighborhood_polygon — polígono bajo demanda (#157)', () => {
  it('(EC-NP6) fetch_mapea_fila_a_neighborhood_polygon: rpc recibe p_neighborhood_id numérico; fila → {id, name, polygons, bbox}', async () => {
    const mock = make_mock_supabase({ data: [ROW], error: null });

    const result = await fetch_neighborhood_polygon('42', { supabase: mock });

    expect(mock._mock_rpc).toHaveBeenCalledWith('get_neighborhood_geojson', {
      p_neighborhood_id: 42,
    });
    expect(result).toEqual({
      id: '42',
      name: 'Providencia',
      polygons: [
        [
          { latitude: 20.69, longitude: -103.38 },
          { latitude: 20.69, longitude: -103.36 },
          { latitude: 20.71, longitude: -103.36 },
          { latitude: 20.69, longitude: -103.38 },
        ],
      ],
      bbox: { min_lat: 20.69, min_lng: -103.38, max_lat: 20.71, max_lng: -103.36 },
    });
  });

  it('(EC-NP7) fetch_cero_filas_devuelve_null: data [] → null (not-found sin excepción)', async () => {
    const mock = make_mock_supabase({ data: [], error: null });

    expect(await fetch_neighborhood_polygon('999', { supabase: mock })).toBeNull();
  });

  it('(EC-NP8) fetch_error_lanza: error {message} → throw con ese message', async () => {
    const mock = make_mock_supabase({ data: null, error: { message: 'RPC caída' } });

    await expect(fetch_neighborhood_polygon('42', { supabase: mock })).rejects.toThrow('RPC caída');
  });
});
