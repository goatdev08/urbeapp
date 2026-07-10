/**
 * Tests fase RED — fetchFeedProperties, path NULL de radius_m (#58.3)
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 * Subtarea Taskmaster: 58.3 — invocación condicional de la RPC de proximidad
 *
 * Contrato NUEVO exigido por esta subtarea:
 *   - `filters.radius_m === null` → SALTA por completo la RPC
 *     `properties_within_radius` (NO se llama `client.rpc(...)`).
 *   - En su lugar: query PLANA directa a PostgREST
 *     `.from('properties').select(...).eq('status','active').is('deleted_at',null)`
 *     + `build_filter_query(query, filters)` (los mismos filtros de usuario que
 *     el path de proximidad — #12.7 — SIGUEN aplicando).
 *   - Paginación OFFSET vía `.range(offset, offset+PAGE_SIZE-1)` (PAGE_SIZE=10,
 *     ver header de feedProperties.ts) — NO slice sobre ids de la RPC.
 *   - `nextCursor`: página completa (PAGE_SIZE filas, no vacía) → siguiente
 *     offset; página vacía → null ("paginar hasta página vacía", demo scale,
 *     sin `.count()`).
 *   - SIN `distance_m` / SIN re-sort por distancia: el orden final es el orden
 *     en que PostgREST devuelve las filas (NO se reordena por proximidad).
 *   - `filters.radius_m` NUMÉRICO (no null) → el path de proximidad #42
 *     (RPC + expansión + re-sort) sigue exactamente igual (regression guard).
 *
 * ⚠️ GOTCHA capturado por estos tests (bug HOY, #58.1 ya cambió el tipo pero
 * NO la lógica): `const base_radius = filters?.radius_m ?? DEFAULT_RADIUS_M;`
 * (línea ~87) convierte `radius_m: null` en `DEFAULT_RADIUS_M` (5000) vía `??`,
 * por lo que HOY un `radius_m: null` explícito cae en el path de proximidad
 * (SÍ llama a la RPC). Cada test de comportamiento nuevo aquí incluye como
 * aserción-ancla `expect(mock_supabase._mock_rpc).not.toHaveBeenCalled()`,
 * que FALLA hoy exactamente por ese bug.
 *
 * PATRÓN DE MOCK: reusa el query builder thenable + mock de supabase de
 * feedProperties.test.ts, agregando `.range()` (chainable, faltante en el
 * arnés original porque el path viejo nunca lo usaba).
 *
 * EDGE CASES CUBIERTOS (7 casos — 5 comportamiento nuevo + 2 regresión):
 *
 * ### Comportamiento nuevo (radius_m === null)
 * - (EC-FEED-NULL-1) radius_null_no_llama_rpc_consulta_postgrest_directa_devuelve_propiedades
 * - (EC-FEED-NULL-2a) radius_null_pagina_llena_range_offset_cero_a_nueve_next_cursor_diez
 * - (EC-FEED-NULL-2b) radius_null_pagina_vacia_en_cursor_diez_next_cursor_null
 * - (EC-FEED-NULL-3) radius_null_orden_preservado_de_postgrest_sin_resort_por_distancia
 * - (EC-FEED-NULL-4) radius_null_aplica_filtros_operation_types_y_zone_via_build_filter_query
 *
 * ### Regression guard (radius_m numérico — path de proximidad #42 intacto)
 * - (EC-FEED-NULL-5) radius_5000_numerico_si_llama_rpc_path_proximidad_intacto
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchFeedProperties } from '../lib/feedProperties';

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

type QueryRow = {
  id: string;
  price: number;
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  property_videos: { id: string; storage_path: string; position: number; thumbnail_url: string | null }[];
};

type MintedVideo = {
  property_id: string;
  video_id: string;
  signed_url: string;
};

type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };
type InvokeResult = { data: { videos: MintedVideo[] } | null; error: { message: string } | null };
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function make_row(id: string, overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    id,
    price: 1650000,
    address: `Calle ${id} #100, Guadalajara`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: `agent-uuid-${id}`,
    agency_id: null,
    created_at: '2026-07-01T10:00:00Z',
    property_videos: [{ id: `vid-${id}`, storage_path: `agent-uuid-${id}/vid-${id}.mp4`, position: 0, thumbnail_url: null }],
    ...overrides,
  };
}

function make_minted(id: string): MintedVideo {
  return {
    property_id: id,
    video_id: `vid-${id}`,
    signed_url: `https://storage.supabase.co/signed/${id}?token=tok`,
  };
}

// ---------------------------------------------------------------------------
// Mock del query builder encadenable (thenable) — CON .range()
// ---------------------------------------------------------------------------

function make_query_builder(result: QueryResult) {
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    lt: jest.Mock;
    in: jest.Mock;
    range: jest.Mock;
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
    lt: jest.fn(),
    in: jest.fn(),
    range: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'lt', 'in', 'range'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

function make_mock_supabase(opts: {
  query_result?: QueryResult;
  invoke_result?: InvokeResult;
  rpc_result?: RpcResult;
} = {}) {
  const {
    query_result = { data: [], error: null },
    invoke_result = { data: { videos: [] }, error: null },
    rpc_result = {
      data:
        query_result.data === null
          ? [{ id: 'rpc-placeholder-id', distance_m: 1 }]
          : query_result.data.map((r) => ({ id: r.id, distance_m: 1 })),
      error: null,
    },
  } = opts;

  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);
  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);
  const mock_rpc = jest.fn().mockResolvedValue(rpc_result);

  return {
    from: mock_from,
    functions: { invoke: mock_invoke },
    rpc: mock_rpc,
    _mock_from: mock_from,
    _mock_invoke: mock_invoke,
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

describe('fetchFeedProperties — radius_m null (path plano, #58.3)', () => {

  // ── (EC-FEED-NULL-1) radius_m=null → NO RPC, query plana, devuelve props ──

  it('(EC-FEED-NULL-1) radius_null_no_llama_rpc_consulta_postgrest_directa_devuelve_propiedades: filters.radius_m=null → client.rpc NUNCA se llama; consulta PostgREST directa (.from) devuelve las propiedades con signed_url', async () => {
    const rows = [make_row('prop-1'), make_row('prop-2'), make_row('prop-3')];
    const videos = rows.map((r) => make_minted(r.id));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    // Aserción-ancla: hoy el `??` manda radius_m:null al path de proximidad → FALLA.
    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
    expect(result.data).toHaveLength(3);
    expect(result.data.map((d) => d.id).sort()).toEqual(['prop-1', 'prop-2', 'prop-3']);
  });

  // ── (EC-FEED-NULL-2a) radius_m=null → página llena → .range(0,9), nextCursor="10"

  it('(EC-FEED-NULL-2a) radius_null_pagina_llena_range_offset_cero_a_nueve_next_cursor_diez: sin cursor + radius_m=null → .range(0,9) invocado; página completa (10 filas) → nextCursor="10"', async () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => make_row(`prop-${i + 1}`));
    const videos = rows.map((r) => make_minted(r.id));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.range).toHaveBeenCalledWith(0, PAGE_SIZE - 1);
    expect(result.nextCursor).toBe('10');
  });

  // ── (EC-FEED-NULL-2b) radius_m=null → página vacía en offset=10 → nextCursor null

  it('(EC-FEED-NULL-2b) radius_null_pagina_vacia_en_cursor_diez_next_cursor_null: cursor="10" + radius_m=null → .range(10,19) invocado; página vacía → data:[] y nextCursor:null', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
      invoke_result: { data: { videos: [] }, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties('10', { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.range).toHaveBeenCalledWith(10, 19);
    expect(result.data).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  // ── (EC-FEED-NULL-3) radius_m=null → orden preservado, sin re-sort por distancia

  it('(EC-FEED-NULL-3) radius_null_orden_preservado_de_postgrest_sin_resort_por_distancia: radius_m=null → el orden final es EXACTAMENTE el de las filas de PostgREST (prop-a, prop-b, prop-c), sin reordenar por distance_m', async () => {
    const rows = [make_row('prop-a'), make_row('prop-b'), make_row('prop-c')];
    const videos = rows.map((r) => make_minted(r.id));
    // Si el código (con el bug) tomara el path de proximidad, esta distance_map
    // forzaría el orden inverso (prop-c, prop-a, prop-b) tras el re-sort.
    const rpc_result: RpcResult = {
      data: [
        { id: 'prop-c', distance_m: 100 },
        { id: 'prop-a', distance_m: 200 },
        { id: 'prop-b', distance_m: 300 },
      ],
      error: null,
    };
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result,
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(result.data.map((d) => d.id)).toEqual(['prop-a', 'prop-b', 'prop-c']);
  });

  // ── (EC-FEED-NULL-4) radius_m=null → filtros de usuario siguen aplicando ──

  it('(EC-FEED-NULL-4) radius_null_aplica_filtros_operation_types_y_zone_via_build_filter_query: radius_m=null + operation_types=["rent"] + zone="Zapopan" → query builder recibe .in("operation_type",["rent","both"]) y .eq("zone","Zapopan")', async () => {
    const rows = [make_row('prop-1')];
    const videos = rows.map((r) => make_minted(r.id));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });
    const filters: FilterState = {
      ...EMPTY_FILTERS,
      radius_m: null,
      operation_types: ['rent'],
      zone: 'Zapopan',
    };

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('operation_type', ['rent', 'both']);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('zone', 'Zapopan');
  });

  // ── (EC-FEED-NULL-5) REGRESSION GUARD: radius_m numérico → SÍ llama RPC ──

  it('(EC-FEED-NULL-5) radius_5000_numerico_si_llama_rpc_path_proximidad_intacto: filters.radius_m=5000 (numérico) → SÍ invoca client.rpc("properties_within_radius", {..., p_radius_m:5000}) — path de proximidad #42 sin cambios', async () => {
    const rows = [make_row('prop-1'), make_row('prop-2')];
    const videos = rows.map((r) => make_minted(r.id));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: 5000 };

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith(
      'properties_within_radius',
      expect.objectContaining({ p_radius_m: 5000 }),
    );
  });

});
