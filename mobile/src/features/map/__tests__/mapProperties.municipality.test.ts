/**
 * Tests fase RED — fetchMapProperties, modo MUNICIPIO vía RPC (#232.3)
 * Archivo SUT: mobile/src/features/map/lib/mapProperties.ts
 *
 * ⚠️ RESTRICCIÓN DURA: modo municipio PURAMENTE ADITIVO (4to parámetro
 * opcional). NO modifica mapProperties.test.ts / .radius-null / .filters /
 * .zone / .neighborhood (deben seguir en verde sin cambios).
 *
 * Contrato NUEVO (4to parámetro, #232 punto 3 de los contratos pinneados):
 *
 *   fetchMapProperties(deps?, filters?, neighborhood_id?, municipality?: {id, bbox} | null)
 *
 *   - `municipality` → rpc('properties_within_municipality', {p_municipality_id})
 *     → ids → .in('id', ids) + base + build_filter_query + build_map_result.
 *     Reemplaza el círculo clamped a 50km que #157 usaba al seleccionar un
 *     municipio en el mapa.
 *   - Municipio GANA sobre `filters.area` (misma prioridad que colonia).
 *   - Colonia (`neighborhood_id`) sigue ganando SOBRE municipio si ambos
 *     vinieran set (no debería pasar en UI real — XOR — pero el contrato del
 *     lib no depende de esa garantía externa).
 *   - RPC vacía → [] SIN tocar PostgREST.
 *   - 🔴 FAIL-CLOSED estilo useCanAdvertise: error con `code === '42883'`
 *     (función no existe — ventana de deploy sin el schema de 232.1) → NO
 *     lanza; cae al círculo clamped a 50km del bbox del municipio (mismo
 *     mecanismo que `filters.area`, D4/D5 de #157) vía
 *     `properties_within_radius`.
 *   - Cualquier OTRO error de la RPC → lanza normal.
 *   - 🔒 Invariante A1: el id del municipio NUNCA viaja por build_filter_query.
 *
 * EDGE CASES:
 * - (EC-M1) municipio_llama_rpc_y_aplica_in_ids
 * - (EC-M2) municipio_gana_sobre_area
 * - (EC-M3) municipio_con_filtros_combinados_id_no_viaja_al_builder
 * - (EC-M4) rpc_vacia_devuelve_vacio_sin_postgrest
 * - (EC-M5) rpc_con_error_no_42883_lanza
 * - (EC-M6) fail_closed_parse_location_reusado
 * - (EC-M7) codigo_42883_cae_al_circulo_clamped_del_bbox
 * - (EC-M8) sin_municipio_ramas_actuales_intactas
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import { bbox_to_region } from '../lib/bboxRegion';
import { viewport_to_area } from '../lib/viewportToArea';
import type { PlaceBBox } from '../lib/placeSearch';

import { fetchMapProperties } from '../lib/mapProperties';
import type { MapProperty } from '../types';

/** WKT de Guadalajara: lng=-103.35, lat=20.67 */
const WKT_GDL = 'POINT(-103.35 20.67)';

const MUNI_BBOX: PlaceBBox = {
  min_lat: 20.55,
  min_lng: -103.5,
  max_lat: 20.79,
  max_lng: -103.2,
};
const MUNICIPALITY = { id: '14039', bbox: MUNI_BBOX };

// ---------------------------------------------------------------------------
// Tipos y factories (espejo de mapProperties.neighborhood.test.ts)
// ---------------------------------------------------------------------------

type QueryRow = {
  id: string;
  price: number;
  address: string;
  property_type: string;
  operation_type: 'rent' | 'sale' | 'both';
  bedrooms: number | null;
  bathrooms: number | null;
  location: string | null;
};

type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };
type RpcResult = { data: { id: string }[] | null; error: { message: string; code?: string } | null };

function make_row(id: string, overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    id,
    price: 1650000,
    address: `Av. Providencia ${id}, Guadalajara, Jalisco`,
    property_type: 'house',
    operation_type: 'sale',
    bedrooms: 3,
    bathrooms: 2,
    location: WKT_GDL,
    ...overrides,
  };
}

function make_query_builder(result: QueryResult) {
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    in: jest.Mock;
    then: (
      onFulfilled: (v: QueryResult) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    order: jest.fn(),
    limit: jest.fn(),
    in: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

function make_mock_supabase(opts: { query_result?: QueryResult; rpc_result?: RpcResult } = {}) {
  const { query_result = { data: [], error: null } } = opts;
  const {
    rpc_result = {
      data: (query_result.data ?? []).map((r) => ({ id: r.id })),
      error: null,
    },
  } = opts;

  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);
  const mock_rpc = jest.fn().mockResolvedValue(rpc_result);

  return {
    from: mock_from,
    rpc: mock_rpc,
    _mock_from: mock_from,
    _mock_rpc: mock_rpc,
    _query_builder: query_builder,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchMapProperties — modo municipio vía RPC (#232, aditivo)', () => {
  it('(EC-M1) municipio_llama_rpc_y_aplica_in_ids', async () => {
    const rows = [make_row('prop-m1'), make_row('prop-m2')];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rows.map((r) => ({ id: r.id })), error: null },
    });

    const result = await fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, null, MUNICIPALITY);

    expect(mock._mock_rpc).toHaveBeenCalledWith('properties_within_municipality', {
      p_municipality_id: '14039',
    });
    expect(mock._query_builder.in).toHaveBeenCalledWith('id', ['prop-m1', 'prop-m2']);
    expect(result).toHaveLength(2);
  });

  it('(EC-M2) municipio_gana_sobre_area: municipality + filters.area ambos set → SOLO la RPC de municipio', async () => {
    const rows = [make_row('prop-m3')];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: [{ id: 'prop-m3' }], error: null },
    });
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      area: { center: { lat: 20.66, lng: -103.35 }, radius_m: 1000 },
    };

    await fetchMapProperties({ supabase: mock }, filters, null, MUNICIPALITY);

    expect(mock._mock_rpc).toHaveBeenCalledTimes(1);
    expect(mock._mock_rpc).toHaveBeenCalledWith('properties_within_municipality', {
      p_municipality_id: '14039',
    });
  });

  it('(EC-M3) municipio_con_filtros_combinados_id_no_viaja_al_builder', async () => {
    const rows = [make_row('prop-m4')];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: [{ id: 'prop-m4' }], error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, property_types: ['house'] };

    await fetchMapProperties({ supabase: mock }, filters, null, MUNICIPALITY);

    expect(mock._query_builder.in).toHaveBeenCalledWith('property_type', ['house']);

    const all_builder_calls = [
      ...mock._query_builder.eq.mock.calls,
      ...mock._query_builder.in.mock.calls,
      ...mock._query_builder.is.mock.calls,
    ] as unknown[][];
    const muni_calls = all_builder_calls.filter(
      (call) => typeof call[0] === 'string' && call[0].toLowerCase().includes('municipal'),
    );
    expect(muni_calls).toEqual([]);
  });

  it('(EC-M4) rpc_vacia_devuelve_vacio_sin_postgrest', async () => {
    const mock = make_mock_supabase({ rpc_result: { data: [], error: null } });

    const result = await fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, null, MUNICIPALITY);

    expect(result).toEqual([]);
    expect(mock._mock_from).not.toHaveBeenCalled();
  });

  it('(EC-M5) rpc_con_error_no_42883_lanza', async () => {
    const mock = make_mock_supabase({
      rpc_result: { data: null, error: { message: 'reventó properties_within_municipality' } },
    });

    await expect(
      fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, null, MUNICIPALITY),
    ).rejects.toThrow('reventó properties_within_municipality');
  });

  it('(EC-M6) fail_closed_parse_location_reusado: 1 fila con location null → se omite', async () => {
    const rows = [make_row('prop-m-ok'), make_row('prop-m-null', { location: null })];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rows.map((r) => ({ id: r.id })), error: null },
    });

    const result = await fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, null, MUNICIPALITY);

    expect(result.map((p: MapProperty) => p.id)).toEqual(['prop-m-ok']);
  });

  it('(EC-M7) codigo_42883_cae_al_circulo_clamped_del_bbox: RPC no desplegada aún → fallback a properties_within_radius del bbox', async () => {
    const rows = [make_row('prop-fallback')];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: {
        data: null,
        error: { message: 'function public.properties_within_municipality(text) does not exist', code: '42883' },
      },
    });

    const result = await fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, null, MUNICIPALITY);

    // El fallback reusa exactamente bbox_to_region + viewport_to_area (mismo
    // mecanismo pre-#232 de #157 D4/D5) — se computa aquí con las MISMAS
    // funciones puras para no duplicar la matemática de Haversine en el test.
    const expected_area = viewport_to_area(bbox_to_region(MUNI_BBOX));

    expect(mock._mock_rpc).toHaveBeenCalledTimes(2); // 1ra falla (42883) + fallback
    expect(mock._mock_rpc).toHaveBeenNthCalledWith(2, 'properties_within_radius', {
      p_lat: expected_area.center.lat,
      p_lng: expected_area.center.lng,
      p_radius_m: expected_area.radius_m,
    });
    expect(result).toHaveLength(1);
  });

  it('(EC-M8) sin_municipio_ramas_actuales_intactas: municipality null/undefined → area sigue yendo por properties_within_radius', async () => {
    const rows_area = [make_row('prop-area')];
    const mock_area = make_mock_supabase({
      query_result: { data: rows_area, error: null },
      rpc_result: { data: [{ id: 'prop-area' }], error: null },
    });
    const filters_area: FilterState = {
      ...EMPTY_FILTERS,
      area: { center: { lat: 20.66, lng: -103.35 }, radius_m: 1000 },
    };

    await fetchMapProperties({ supabase: mock_area }, filters_area, null, null);

    expect(mock_area._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: 20.66,
      p_lng: -103.35,
      p_radius_m: 1000,
    });

    const mock_plano = make_mock_supabase({ query_result: { data: [make_row('prop-plano')], error: null } });
    const result_plano = await fetchMapProperties(
      { supabase: mock_plano },
      { ...EMPTY_FILTERS, radius_m: null },
      undefined,
      undefined,
    );

    expect(mock_plano._mock_rpc).not.toHaveBeenCalled();
    expect(result_plano).toHaveLength(1);
  });
});
