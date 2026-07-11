/**
 * Tests — fetchFeedProperties, path NULL de radius_m (contrato #62, supersede #58.3)
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 *
 * Contrato #62 (corrige la decisión #58.3 tras feedback de producto):
 * "Sin límite" quita el TOPE de distancia, pero la carga contextual (orden por
 * cercanía) SIEMPRE aplica en el feed, sin importar el radio elegido.
 *
 *   - `filters.radius_m === null` → SÍ llama la RPC `properties_within_radius`,
 *     con `p_radius_m = UNLIMITED_RADIUS_M` (constante exportada por el SUT,
 *     > media circunferencia terrestre ≈ 20,015 km → cubre todo el planeta).
 *   - El path de proximidad #42 aplica ÍNTEGRO con null: paginación OFFSET
 *     sobre los ids de la RPC (`.in('id', page_ids)`), re-sort cliente por
 *     distance_m ASC, filtros de usuario vía build_filter_query.
 *   - SIN expansión ×2 cuando el radio es ilimitado: si la RPC devuelve vacío
 *     con radio infinito, no hay propiedades — expandir es inútil (1 sola
 *     llamada a la RPC).
 *   - El path PLANO de #58.3 (saltar la RPC + `.range()`) queda ELIMINADO del
 *     feed (el mapa lo conserva — los pins no tienen orden).
 *   - `filters.radius_m` NUMÉRICO → path #42 sin cambios (regression guard),
 *     incluida la expansión ×2 cuando la RPC devuelve vacío.
 *   - Invariante A1 intacta: radius_m NUNCA genera llamadas al builder.
 *
 * PATRÓN DE MOCK: query builder thenable + mock de supabase de
 * feedProperties.test.ts (con `.range()` para poder afirmar que YA NO se usa).
 *
 * EDGE CASES CUBIERTOS (8 casos — 5 comportamiento #62 + 3 regresión):
 * - (EC-NULL-RPC-1) radius_null_llama_rpc_con_radio_ilimitado_devuelve_propiedades
 * - (EC-NULL-RPC-2) radius_null_ordena_por_distance_m_de_la_rpc_no_por_orden_postgrest
 * - (EC-NULL-RPC-3a) radius_null_pagina_offset_sobre_ids_rpc_primera_pagina_next_cursor_diez
 * - (EC-NULL-RPC-3b) radius_null_pagina_offset_sobre_ids_rpc_ultima_pagina_next_cursor_null
 * - (EC-NULL-RPC-4) radius_null_rpc_vacia_una_sola_llamada_sin_expansion_data_vacia
 * - (EC-NULL-RPC-5) radius_null_aplica_filtros_usuario_y_nunca_range
 * - (EC-NULL-RPC-6) regresion_radius_5000_numerico_rpc_recibe_p_radius_m_5000
 * - (EC-NULL-RPC-7) regresion_radius_numerico_rpc_vacia_expansion_x2_sigue_viva
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchFeedProperties, UNLIMITED_RADIUS_M } from '../lib/feedProperties';

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
// Mock del query builder encadenable (thenable)
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
          : query_result.data.map((r, i) => ({ id: r.id, distance_m: i + 1 })),
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

describe('fetchFeedProperties — radius_m null = radio ilimitado, cercanía intacta (#62)', () => {

  // ── (EC-NULL-RPC-1) radius null → RPC con radio ilimitado ─────────────────

  it('(EC-NULL-RPC-1) radius_null_llama_rpc_con_radio_ilimitado_devuelve_propiedades: filters.radius_m=null → client.rpc("properties_within_radius", {p_radius_m: UNLIMITED_RADIUS_M}) SÍ se llama; UNLIMITED cubre el planeta (> 20,015 km); devuelve las propiedades con signed_url', async () => {
    const rows = [make_row('prop-1'), make_row('prop-2'), make_row('prop-3')];
    const videos = rows.map((r) => make_minted(r.id));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    // La constante misma debe cubrir todo el planeta (media circunferencia ≈ 20,015 km).
    expect(UNLIMITED_RADIUS_M).toBeGreaterThanOrEqual(20_015_000);
    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith(
      'properties_within_radius',
      expect.objectContaining({ p_radius_m: UNLIMITED_RADIUS_M }),
    );
    expect(result.data).toHaveLength(3);
    expect(result.data.map((d) => d.id).sort()).toEqual(['prop-1', 'prop-2', 'prop-3']);
  });

  // ── (EC-NULL-RPC-2) radius null → orden por distance_m, no orden PostgREST ─

  it('(EC-NULL-RPC-2) radius_null_ordena_por_distance_m_de_la_rpc_no_por_orden_postgrest: RPC devuelve c(100m), a(200m), b(300m); PostgREST devuelve a,b,c → resultado ordenado c,a,b (cercanía manda)', async () => {
    const rows = [make_row('prop-a'), make_row('prop-b'), make_row('prop-c')];
    const videos = rows.map((r) => make_minted(r.id));
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

    expect(result.data.map((d) => d.id)).toEqual(['prop-c', 'prop-a', 'prop-b']);
  });

  // ── (EC-NULL-RPC-3a/3b) radius null → paginación offset sobre ids de la RPC ─

  it('(EC-NULL-RPC-3a) radius_null_pagina_offset_sobre_ids_rpc_primera_pagina_next_cursor_diez: RPC devuelve 12 ids + sin cursor → .in("id", primeros 10) y nextCursor="10"; .range NUNCA se usa', async () => {
    const rpc_rows: RpcRow[] = Array.from({ length: 12 }, (_, i) => ({
      id: `prop-${i + 1}`,
      distance_m: (i + 1) * 10,
    }));
    const first_page_ids = rpc_rows.slice(0, PAGE_SIZE).map((r) => r.id);
    const rows = first_page_ids.map((id) => make_row(id));
    const videos = rows.map((r) => make_minted(r.id));
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result: { data: rpc_rows, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', first_page_ids);
    expect(mock_supabase._query_builder.range).not.toHaveBeenCalled();
    expect(result.nextCursor).toBe('10');
  });

  it('(EC-NULL-RPC-3b) radius_null_pagina_offset_sobre_ids_rpc_ultima_pagina_next_cursor_null: RPC devuelve 12 ids + cursor="10" → .in("id", ids 11..12) y nextCursor=null', async () => {
    const rpc_rows: RpcRow[] = Array.from({ length: 12 }, (_, i) => ({
      id: `prop-${i + 1}`,
      distance_m: (i + 1) * 10,
    }));
    const last_page_ids = rpc_rows.slice(10, 12).map((r) => r.id);
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: rpc_rows, error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties('10', { supabase: mock_supabase }, filters);

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', last_page_ids);
    expect(result.nextCursor).toBeNull();
  });

  // ── (EC-NULL-RPC-4) radius null + RPC vacía → SIN expansión ×2 ─────────────

  it('(EC-NULL-RPC-4) radius_null_rpc_vacia_una_sola_llamada_sin_expansion_data_vacia: radio ilimitado + RPC devuelve [] → NO hay reintentos ×2 (client.rpc llamado EXACTAMENTE 1 vez) y data:[] sin tocar PostgREST', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: [], error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: null };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(result.data).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });

  // ── (EC-NULL-RPC-5) radius null → filtros de usuario aplican, invariante A1 ─

  it('(EC-NULL-RPC-5) radius_null_aplica_filtros_usuario_y_nunca_range: radius_m=null + operation_types=["rent"] + zone="Zapopan" → .in("operation_type",["rent","both"]) y .eq("zone","Zapopan") llamados; .range nunca; radius_m no genera .gte/.lte', async () => {
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

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('operation_type', ['rent', 'both']);
    expect(mock_supabase._query_builder.eq).toHaveBeenCalledWith('zone', 'Zapopan');
    expect(mock_supabase._query_builder.range).not.toHaveBeenCalled();
  });

  // ── (EC-NULL-RPC-6) REGRESIÓN: radius numérico → p_radius_m intacto ────────

  it('(EC-NULL-RPC-6) regresion_radius_5000_numerico_rpc_recibe_p_radius_m_5000: filters.radius_m=5000 → client.rpc con p_radius_m:5000 — path #42 sin cambios', async () => {
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

  // ── (EC-NULL-RPC-7) REGRESIÓN: expansión ×2 sigue viva con radio numérico ──

  it('(EC-NULL-RPC-7) regresion_radius_numerico_rpc_vacia_expansion_x2_sigue_viva: radius_m=5000 + RPC siempre vacía → reintentos con 5000, 10000, 20000, 40000 (4 llamadas)', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: [], error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: 5000 };

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledTimes(4);
    expect(mock_supabase._mock_rpc).toHaveBeenNthCalledWith(
      1, 'properties_within_radius', expect.objectContaining({ p_radius_m: 5000 }),
    );
    expect(mock_supabase._mock_rpc).toHaveBeenNthCalledWith(
      4, 'properties_within_radius', expect.objectContaining({ p_radius_m: 40000 }),
    );
    expect(result.data).toEqual([]);
  });

});
