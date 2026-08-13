/**
 * Tests fase RED — fetchMapProperties, modo COLONIA (#157.6)
 * Archivo SUT: mobile/src/features/map/lib/mapProperties.ts
 *
 * ⚠️ RESTRICCIÓN DURA: modo colonia PURAMENTE ADITIVO. Este archivo es NUEVO —
 * NO modifica mapProperties.test.ts / .radius-null / .filters / .zone (que
 * deben seguir en verde sin cambios).
 *
 * Contrato NUEVO (3er parámetro opcional, decisión D6 del plan #157 — la
 * colonia NO vive en FilterState, es estado local de MapScreen):
 *
 *   fetchMapProperties(deps?, filters?, neighborhood_id?: string | null)
 *
 *   - `neighborhood_id` string → rama de MÁXIMA prioridad (ANTES de area/#56):
 *     rpc('properties_within_neighborhood', { p_neighborhood_id: Number(id) })
 *     → ids → `.in('id', ids)` + base (status/deleted_at) + build_filter_query
 *     + build_map_result. SIN expansión de radio (una sola llamada).
 *   - Colonia GANA sobre area: con ambos set, la RPC llamada es
 *     properties_within_neighborhood (nunca properties_within_radius).
 *   - RPC devuelve [] → resultado [] SIN tocar PostgREST (la colonia no tiene
 *     propiedades; no hay fallback a otro radio — sería mentirle al usuario).
 *   - 🔒 Invariante A1: neighborhood_id NUNCA viaja por build_filter_query.
 *   - `neighborhood_id` null/undefined → TODAS las ramas actuales intactas
 *     (candado de no-regresión).
 *
 * EDGE CASES:
 * - (EC-N1) colonia_llama_rpc_con_id_numerico_y_aplica_in_ids
 * - (EC-N2) colonia_gana_sobre_area
 * - (EC-N3) colonia_con_filtros_combinados_id_no_viaja_al_builder
 * - (EC-N4) rpc_vacia_devuelve_vacio_sin_postgrest
 * - (EC-N5) rpc_con_error_lanza
 * - (EC-N6) fail_closed_parse_location_reusado
 * - (EC-N7) sin_colonia_ramas_actuales_intactas
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchMapProperties } from '../lib/mapProperties';
import type { MapProperty } from '../types';

/** WKT de Guadalajara: lng=-103.35, lat=20.67 */
const WKT_GDL = 'POINT(-103.35 20.67)';

// ---------------------------------------------------------------------------
// Tipos y factories (espejo de mapProperties.zone.test.ts)
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
type RpcResult = { data: { id: string }[] | null; error: { message: string } | null };

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

describe('fetchMapProperties — modo colonia (#157, aditivo)', () => {
  // ── (EC-N1) Colonia: RPC con id numérico + .in(ids) ────────────────────────

  it('(EC-N1) colonia_llama_rpc_con_id_numerico_y_aplica_in_ids: neighborhood_id "42" → rpc("properties_within_neighborhood", {p_neighborhood_id: 42}) → .in("id", ids) → markers', async () => {
    const rows = [make_row('prop-n1'), make_row('prop-n2')];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rows.map((r) => ({ id: r.id })), error: null },
    });

    const result = await fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, '42');

    expect(mock._mock_rpc).toHaveBeenCalledWith('properties_within_neighborhood', {
      p_neighborhood_id: 42,
    });
    expect(mock._query_builder.in).toHaveBeenCalledWith('id', ['prop-n1', 'prop-n2']);
    expect(result).toHaveLength(2);
  });

  // ── (EC-N2) Colonia GANA sobre area ────────────────────────────────────────

  it('(EC-N2) colonia_gana_sobre_area: neighborhood_id + filters.area ambos set → SOLO la RPC de colonia (nunca properties_within_radius)', async () => {
    const rows = [make_row('prop-n3')];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: [{ id: 'prop-n3' }], error: null },
    });
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      area: { center: { lat: 20.66, lng: -103.35 }, radius_m: 1000 },
    };

    await fetchMapProperties({ supabase: mock }, filters, '42');

    expect(mock._mock_rpc).toHaveBeenCalledTimes(1);
    expect(mock._mock_rpc).toHaveBeenCalledWith('properties_within_neighborhood', {
      p_neighborhood_id: 42,
    });
  });

  // ── (EC-N3) Filtros combinados: el id no viaja al builder (A1) ────────────

  it('(EC-N3) colonia_con_filtros_combinados_id_no_viaja_al_builder: property_types=["house"] → .in("property_type") vía builder; ninguna llamada del builder menciona neighborhood', async () => {
    const rows = [make_row('prop-n4')];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: [{ id: 'prop-n4' }], error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, property_types: ['house'] };

    await fetchMapProperties({ supabase: mock }, filters, '42');

    expect(mock._query_builder.in).toHaveBeenCalledWith('property_type', ['house']);

    const all_builder_calls = [
      ...mock._query_builder.eq.mock.calls,
      ...mock._query_builder.in.mock.calls,
      ...mock._query_builder.is.mock.calls,
    ] as unknown[][];
    const neighborhood_calls = all_builder_calls.filter(
      (call) => typeof call[0] === 'string' && call[0].toLowerCase().includes('neighborhood'),
    );
    expect(neighborhood_calls).toEqual([]);
  });

  // ── (EC-N4) RPC vacía → [] sin PostgREST ──────────────────────────────────

  it('(EC-N4) rpc_vacia_devuelve_vacio_sin_postgrest: colonia sin propiedades → [] y from() jamás se llama (sin fallback a otro radio)', async () => {
    const mock = make_mock_supabase({ rpc_result: { data: [], error: null } });

    const result = await fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, '42');

    expect(result).toEqual([]);
    expect(mock._mock_from).not.toHaveBeenCalled();
  });

  // ── (EC-N5) RPC con error → lanza ─────────────────────────────────────────

  it('(EC-N5) rpc_con_error_lanza: error {message} → throw con ese message', async () => {
    const mock = make_mock_supabase({
      rpc_result: { data: null, error: { message: 'reventó la RPC de colonia' } },
    });

    await expect(
      fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, '42'),
    ).rejects.toThrow('reventó la RPC de colonia');
  });

  // ── (EC-N6) Fail-closed de parse_location reusado ─────────────────────────

  it('(EC-N6) fail_closed_parse_location_reusado: 1 fila con location null → se omite, quedan las parseables', async () => {
    const rows = [
      make_row('prop-n-ok'),
      make_row('prop-n-null', { location: null }),
    ];
    const mock = make_mock_supabase({
      query_result: { data: rows, error: null },
      rpc_result: { data: rows.map((r) => ({ id: r.id })), error: null },
    });

    const result = await fetchMapProperties({ supabase: mock }, EMPTY_FILTERS, '42');

    expect(result.map((p: MapProperty) => p.id)).toEqual(['prop-n-ok']);
  });

  // ── (EC-N7) Sin colonia: ramas actuales intactas ──────────────────────────

  it('(EC-N7) sin_colonia_ramas_actuales_intactas: neighborhood_id null y undefined → area va por properties_within_radius; radius_m null va por query plana sin RPC', async () => {
    // Sub-caso A: null + area set → rama de zona actual (#56).
    const rows_area = [make_row('prop-area')];
    const mock_area = make_mock_supabase({
      query_result: { data: rows_area, error: null },
      rpc_result: { data: [{ id: 'prop-area' }], error: null },
    });
    const filters_area: FilterState = {
      ...EMPTY_FILTERS,
      area: { center: { lat: 20.66, lng: -103.35 }, radius_m: 1000 },
    };

    await fetchMapProperties({ supabase: mock_area }, filters_area, null);

    expect(mock_area._mock_rpc).toHaveBeenCalledWith('properties_within_radius', {
      p_lat: 20.66,
      p_lng: -103.35,
      p_radius_m: 1000,
    });

    // Sub-caso B: undefined + radius_m null → query plana sin RPC (#58.3).
    const mock_plano = make_mock_supabase({
      query_result: { data: [make_row('prop-plano')], error: null },
    });
    const filters_plano: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result_plano = await fetchMapProperties({ supabase: mock_plano }, filters_plano);

    expect(mock_plano._mock_rpc).not.toHaveBeenCalled();
    expect(result_plano).toHaveLength(1);
  });
});
