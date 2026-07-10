/**
 * Tests fase RED — fetchMapProperties, path NULL de radius_m (#58.3)
 * Archivo SUT: mobile/src/features/map/lib/mapProperties.ts
 * Subtarea Taskmaster: 58.3 — invocación condicional de la RPC de proximidad
 * (espejo de feedProperties.radius-null.test.ts)
 *
 * Contrato NUEVO exigido por esta subtarea:
 *   - `filters.radius_m === null` → SALTA por completo la RPC
 *     `properties_within_radius` (NO se llama `client.rpc(...)`).
 *   - Query PLANA directa: `.from('properties').select(...).eq('status','active')
 *     .is('deleted_at', null)` + `build_filter_query(query, filters)` — SIN
 *     `.in('id', rpc_ids)` (el mapa trae TODAS las propiedades activas que
 *     matcheen los filtros, sin restricción de proximidad).
 *   - Sin distance_map / sin re-sort (el mapa nunca ordenó por distancia).
 *   - `filters.radius_m` NUMÉRICO (no null) → el path de proximidad #42.3
 *     (RPC + expansión + `.in('id', rpc_ids)`) sigue exactamente igual
 *     (regression guard).
 *
 * ⚠️ GOTCHA capturado (mismo bug que en feed, línea ~77 de mapProperties.ts):
 * `const base_radius = filters?.radius_m ?? DEFAULT_RADIUS_M;` convierte
 * `radius_m: null` en 5000 vía `??`. Cada test de comportamiento nuevo incluye
 * como aserción-ancla `expect(mock_supabase._mock_rpc).not.toHaveBeenCalled()`,
 * que FALLA hoy por ese bug.
 *
 * PATRÓN DE MOCK: espejo de mapProperties.test.ts (mismo query builder
 * thenable + mock de supabase.rpc).
 *
 * EDGE CASES CUBIERTOS (5 casos — 3 comportamiento nuevo pedidos + 2 extra
 * que cierran el contrato de "trae TODAS sin .in()"):
 *
 * ### Comportamiento nuevo (radius_m === null)
 * - (EC-MAP-NULL-1) radius_null_no_llama_rpc_trae_todas_las_propiedades_activas
 * - (EC-MAP-NULL-1b) radius_null_query_no_recibe_in_id_restriccion_de_proximidad
 * - (EC-MAP-NULL-2) radius_null_aplica_filtros_operation_types_y_price_via_build_filter_query
 *
 * ### Regression guard (radius_m numérico — path de proximidad #42.3 intacto)
 * - (EC-MAP-NULL-3) radius_20000_numerico_si_llama_rpc_y_aplica_in_id_path_proximidad_intacto
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchMapProperties } from '../lib/mapProperties';

/** WKT de Guadalajara: lng=-103.35, lat=20.67 */
const WKT_GDL = 'POINT(-103.35 20.67)';

// ---------------------------------------------------------------------------
// Tipos auxiliares
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
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function make_row(id: string, overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    id,
    price: 1650000,
    address: `Av. Vallarta ${id}, Guadalajara, Jalisco`,
    property_type: 'house',
    operation_type: 'sale',
    bedrooms: 3,
    bathrooms: 2,
    location: WKT_GDL,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock del query builder encadenable (thenable)
// ---------------------------------------------------------------------------

function make_query_builder(result: QueryResult) {
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    in: jest.Mock;
    gte: jest.Mock;
    lte: jest.Mock;
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
    gte: jest.fn(),
    lte: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'in', 'gte', 'lte'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

function make_mock_supabase(opts: { query_result?: QueryResult; rpc_result?: RpcResult } = {}) {
  const { query_result = { data: [], error: null } } = opts;
  const {
    rpc_result = {
      data:
        query_result.data === null || query_result.data.length === 0
          ? [{ id: 'rpc-placeholder-id', distance_m: 1 }]
          : query_result.data.map((r) => ({ id: r.id, distance_m: 1 })),
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchMapProperties — radius_m null (path plano, #58.3)', () => {

  // ── (EC-MAP-NULL-1) radius_m=null → NO RPC, trae todas las activas ────────

  it('(EC-MAP-NULL-1) radius_null_no_llama_rpc_trae_todas_las_propiedades_activas: filters.radius_m=null → client.rpc NUNCA se llama; devuelve TODAS las propiedades activas que matchean status/deleted_at', async () => {
    const rows = [make_row('prop-1'), make_row('prop-2'), make_row('prop-3')];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchMapProperties({ supabase: mock_supabase }, filters);

    // Aserción-ancla: hoy el `??` manda radius_m:null al path de proximidad → FALLA.
    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
    expect(result).toHaveLength(3);
    expect(result.map((p) => p.id).sort()).toEqual(['prop-1', 'prop-2', 'prop-3']);
  });

  // ── (EC-MAP-NULL-1b) radius_m=null → sin .in('id', rpc_ids) ───────────────

  it('(EC-MAP-NULL-1b) radius_null_query_no_recibe_in_id_restriccion_de_proximidad: radius_m=null → el query builder NUNCA recibe .in("id", [...]) (no hay restricción de proximidad en el path plano)', async () => {
    const rows = [make_row('prop-1'), make_row('prop-2')];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.in).not.toHaveBeenCalledWith('id', expect.anything());
  });

  // ── (EC-MAP-NULL-2) radius_m=null → filtros de usuario siguen aplicando ───

  it('(EC-MAP-NULL-2) radius_null_aplica_filtros_operation_types_y_price_via_build_filter_query: radius_m=null + operation_types=["sale"] + price_min=1000000 → query builder recibe .in("operation_type",["sale","both"]) y .gte("price",1000000)', async () => {
    const rows = [make_row('prop-1')];
    const mock_supabase = make_mock_supabase({ query_result: { data: rows, error: null } });
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      radius_m: null,
      operation_types: ['sale'],
      price_min: 1000000,
    };

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('operation_type', ['sale', 'both']);
    expect(mock_supabase._query_builder.gte).toHaveBeenCalledWith('price', 1000000);
  });

  // ── (EC-MAP-NULL-3) REGRESSION GUARD: radius_m numérico → SÍ RPC + .in ────

  it('(EC-MAP-NULL-3) radius_20000_numerico_si_llama_rpc_y_aplica_in_id_path_proximidad_intacto: filters.radius_m=20000 (numérico) → SÍ invoca client.rpc("properties_within_radius", {..., p_radius_m:20000}) y query recibe .in("id", ids_de_la_rpc) — path de proximidad #42.3 sin cambios', async () => {
    const rows = [make_row('prop-1'), make_row('prop-2')];
    const rpc_ids = rows.map((r) => ({ id: r.id, distance_m: 1 }));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: 20000 };

    await fetchMapProperties({ supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith(
      'properties_within_radius',
      expect.objectContaining({ p_radius_m: 20000 }),
    );
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith(
      'id',
      rpc_ids.map((r) => r.id),
    );
  });

});
