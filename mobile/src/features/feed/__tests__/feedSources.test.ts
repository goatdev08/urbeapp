/**
 * Tests fase RED — resolutor de fuente por tab del feed (#296.4)
 * Archivo SUT: mobile/src/features/feed/lib/feedSources.ts (stub, lanza not_implemented)
 * Subtarea Taskmaster: 296.4
 *
 * SEAMS bajo test (contrato público del módulo, NO internals):
 *   - source_for_tab(tab: FeedTab): FeedSource — resolutor puro tab → fuente.
 *   - fetch_followed_owner_ids(client, user_id): Promise<string[]> — lista de
 *     seguidos vía tabla `follows` (RLS follows_select solo abre mis filas, #78).
 *   - fetch_ordered_properties(cursor, deps, filters, owner_ids?) — página
 *     "Nuevos" (sin owner_ids) o "Siguiendo" (con owner_ids): PostgREST directo,
 *     SIN pasar por properties_within_radius (invariante A1, #42.1).
 *   - fetch_feed_page(cursor, deps, filters, ctx) — despacho por tab; para
 *     proximidad reusa `fetchFeedProperties` TAL CUAL (contrato publicado
 *     §0.5.2, properties_within_radius no se toca).
 *
 * PATRÓN DE MOCK: cliente Supabase ENCADENABLE (thenable) — nunca desprender
 * `rpc`/`from` del cliente (memoria supabase_js_metodo_desprendido: `this`
 * perdido). `_calls` registra {method,args} en orden para verificar la forma
 * exacta de la query, no solo si se llamó.
 *
 * EDGE CASES CUBIERTOS (25 casos):
 *
 * ### source_for_tab — resolutor puro (happy path, las 5 tabs)
 * - (EC-SRC-1) para_ti_resuelve_a_proximidad
 * - (EC-SRC-2) venta_resuelve_a_proximidad
 * - (EC-SRC-3) renta_resuelve_a_proximidad
 * - (EC-SRC-4) siguiendo_resuelve_a_por_owner
 * - (EC-SRC-5) nuevos_resuelve_a_ordenada
 *
 * ### fetch_followed_owner_ids
 * - (EC-SRC-6) happy_path_devuelve_los_followed_user_id_de_mis_follows
 * - (EC-SRC-7) data_null_devuelve_array_vacio
 * - (EC-SRC-8) error_de_supabase_lanza_con_el_mensaje_exacto
 *
 * ### fetch_ordered_properties — forma exacta de la query ("Nuevos", sin owner_ids)
 * - (EC-SRC-9) sin_owner_ids_arma_select_status_order_published_desc_id_asc_range_sin_in_owner
 * - (EC-SRC-10) cursor_10_traduce_a_range_10_19
 * - (EC-SRC-11) con_owner_ids_agrega_in_owner_user_id_antes_del_order
 * - (EC-SRC-12) filtros_de_usuario_se_aplican_ademas_via_build_filter_query
 * - (EC-SRC-13) invariante_a1_radius_m_y_area_en_filters_nunca_tocan_rpc_ni_mencionan_radius_distance_area
 * - (EC-SRC-14) filas_vacias_no_invoca_mint_video_url
 * - (EC-SRC-15) error_del_select_lanza_con_el_mensaje_exacto
 * - (EC-SRC-16) con_filas_invoca_mint_videos_con_los_ids_exactos_de_las_filas_y_hace_merge_fail_closed
 * - (EC-SRC-17) orden_de_salida_es_el_de_las_filas_sin_re_sort
 * - (EC-SRC-18a) next_cursor_string_offset_mas_page_size_cuando_rows_length_es_page_size
 * - (EC-SRC-18b) next_cursor_null_cuando_rows_length_menor_a_page_size
 * - (EC-SRC-26) error_de_mint_video_url_lanza_fail_closed
 *
 * ### fetch_feed_page — despacho por tab (integra con fetchFeedProperties intacta)
 * - (EC-SRC-19) para_ti_despacha_a_fetchfeedproperties_mismos_argumentos_rpc_de_proximidad
 * - (EC-SRC-20) venta_tambien_despacha_a_proximidad_rpc_llamada
 * - (EC-SRC-21) nuevos_despacha_a_ordenada_sin_tocar_rpc_ni_owner_user_id
 * - (EC-SRC-22) siguiendo_sin_user_id_devuelve_vacio_sin_ninguna_llamada_al_cliente
 * - (EC-SRC-23) siguiendo_con_follows_vacios_devuelve_vacio_sin_consultar_properties_ni_mintear
 * - (EC-SRC-24) siguiendo_con_dos_follows_filtra_in_owner_user_id_con_esos_ids
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import type { FeedTab } from '@/features/search/lib/feedSection';

import { FEED_SELECT, PAGE_SIZE, type MintedVideo, type QueryRow } from '../lib/feedProperties';
import {
  fetch_feed_page,
  fetch_followed_owner_ids,
  fetch_ordered_properties,
  source_for_tab,
} from '../lib/feedSources';

// ---------------------------------------------------------------------------
// Seam A: FEED_SELECT/PAGE_SIZE se exportan desde feedProperties.ts (296.4-A) —
// fetch_ordered_properties los reusa TAL CUAL, sin duplicar el contrato.
// ---------------------------------------------------------------------------

describe('feedProperties — seam exportado para feedSources (296.4-A)', () => {
  it('exporta FEED_SELECT (string) y PAGE_SIZE=10 para que feedSources los reuse', () => {
    expect(typeof FEED_SELECT).toBe('string');
    expect(FEED_SELECT).toContain('property_videos');
    expect(PAGE_SIZE).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Mock del query builder encadenable (thenable), registra {method,args} en orden
// ---------------------------------------------------------------------------

type Call = { method: string; args: unknown[] };
type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

const CHAINABLE_METHODS = ['select', 'eq', 'is', 'in', 'gte', 'lte', 'order', 'range'] as const;

function make_query_builder<T>(result: QueryResult<T>) {
  const calls: Call[] = [];
  const builder = {
    _calls: calls,
    then: (onFulfilled: (v: QueryResult<T>) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  } as Record<string, unknown> & { _calls: Call[] };

  for (const method of CHAINABLE_METHODS) {
    builder[method] = jest.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  return builder as typeof builder & Record<(typeof CHAINABLE_METHODS)[number], jest.Mock>;
}

type MockSupabaseOpts = {
  properties_result?: QueryResult<QueryRow>;
  follows_result?: QueryResult<{ followed_user_id: string }>;
  profiles_result?: QueryResult<unknown>;
  rpc_result?: { data: { id: string; distance_m: number }[] | null; error: { message: string } | null };
  invoke_result?: { data: { videos: MintedVideo[] } | null; error: { message: string } | null };
};

function make_mock_supabase(opts: MockSupabaseOpts = {}) {
  const properties_builder = make_query_builder<QueryRow>(
    opts.properties_result ?? { data: [], error: null },
  );
  const follows_builder = make_query_builder<{ followed_user_id: string }>(
    opts.follows_result ?? { data: [], error: null },
  );
  const profiles_builder = make_query_builder<unknown>(opts.profiles_result ?? { data: [], error: null });

  const mock_from = jest.fn((table: string) => {
    if (table === 'properties') return properties_builder;
    if (table === 'follows') return follows_builder;
    if (table === 'agent_public_profiles') return profiles_builder;
    throw new Error(`tabla inesperada en el mock: ${table}`);
  });
  const mock_invoke = jest.fn().mockResolvedValue(opts.invoke_result ?? { data: { videos: [] }, error: null });
  const mock_rpc = jest
    .fn()
    .mockResolvedValue(opts.rpc_result ?? { data: [{ id: 'rpc-placeholder-id', distance_m: 1 }], error: null });

  return {
    from: mock_from,
    functions: { invoke: mock_invoke },
    rpc: mock_rpc,
    _mock_from: mock_from,
    _mock_invoke: mock_invoke,
    _mock_rpc: mock_rpc,
    _properties_builder: properties_builder,
    _follows_builder: follows_builder,
    _profiles_builder: profiles_builder,
  };
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function make_row(id: string, overrides: Partial<QueryRow> = {}): QueryRow {
  return {
    id,
    price: 1650000,
    operation_type: 'sale',
    property_type: 'house',
    currency: 'MXN',
    price_visible: true,
    address: `Calle ${id} #100, Guadalajara`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: `owner-${id}`,
    agency_id: null,
    created_at: '2026-09-01T10:00:00Z',
    comment_count: 0,
    like_count: 0,
    property_videos: [{ id: `vid-${id}`, storage_path: `owner-${id}/vid-${id}.mp4`, position: 0, thumbnail_url: null }],
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

function make_filters(overrides: Partial<FilterState> = {}): FilterState {
  return { ...EMPTY_FILTERS, ...overrides };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// source_for_tab
// ---------------------------------------------------------------------------

describe('source_for_tab — resolutor puro tab → fuente', () => {
  it('(EC-SRC-1) para_ti_resuelve_a_proximidad', () => {
    expect(source_for_tab('para_ti')).toBe('proximidad');
  });

  it('(EC-SRC-2) venta_resuelve_a_proximidad', () => {
    expect(source_for_tab('venta')).toBe('proximidad');
  });

  it('(EC-SRC-3) renta_resuelve_a_proximidad', () => {
    expect(source_for_tab('renta')).toBe('proximidad');
  });

  it('(EC-SRC-4) siguiendo_resuelve_a_por_owner', () => {
    expect(source_for_tab('siguiendo')).toBe('por_owner');
  });

  it('(EC-SRC-5) nuevos_resuelve_a_ordenada', () => {
    expect(source_for_tab('nuevos')).toBe('ordenada');
  });
});

// ---------------------------------------------------------------------------
// fetch_followed_owner_ids
// ---------------------------------------------------------------------------

describe('fetch_followed_owner_ids — lista de seguidos vía tabla follows', () => {
  it('(EC-SRC-6) happy_path_devuelve_los_followed_user_id_de_mis_follows: 2 filas de follows → ["u1","u2"], query exacta from(follows).select(followed_user_id).eq(follower_user_id, user_id)', async () => {
    const mock_supabase = make_mock_supabase({
      follows_result: { data: [{ followed_user_id: 'u1' }, { followed_user_id: 'u2' }], error: null },
    });

    const result = await fetch_followed_owner_ids(mock_supabase, 'me-uuid');

    expect(result).toEqual(['u1', 'u2']);
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('follows');
    expect(mock_supabase._follows_builder.select).toHaveBeenCalledWith('followed_user_id');
    expect(mock_supabase._follows_builder.eq).toHaveBeenCalledWith('follower_user_id', 'me-uuid');
  });

  it('(EC-SRC-7) data_null_devuelve_array_vacio: follows data:null → []', async () => {
    const mock_supabase = make_mock_supabase({ follows_result: { data: null, error: null } });

    const result = await fetch_followed_owner_ids(mock_supabase, 'me-uuid');

    expect(result).toEqual([]);
  });

  it('(EC-SRC-8) error_de_supabase_lanza_con_el_mensaje_exacto: follows error → rejects con Error(message)', async () => {
    const mock_supabase = make_mock_supabase({
      follows_result: { data: null, error: { message: 'boom_follows' } },
    });

    await expect(fetch_followed_owner_ids(mock_supabase, 'me-uuid')).rejects.toThrow('boom_follows');
  });
});

// ---------------------------------------------------------------------------
// fetch_ordered_properties
// ---------------------------------------------------------------------------

describe('fetch_ordered_properties — página "Nuevos" (sin owner_ids) / "Siguiendo" (con owner_ids)', () => {
  it('(EC-SRC-9) sin_owner_ids_arma_select_status_order_published_desc_id_asc_range_sin_in_owner: sin owner_ids → NUNCA .in("owner_user_id", …); query exacta select→eq(status,active)→is(deleted_at,null)→order(published_at desc)→order(id asc)→range(0,9)', async () => {
    const rows = [make_row('n1')];
    const mock_supabase = make_mock_supabase({
      properties_result: { data: rows, error: null },
      invoke_result: { data: { videos: [make_minted('n1')] }, error: null },
    });

    await fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    const owner_calls = mock_supabase._properties_builder._calls.filter(
      (c) => c.method === 'in' && c.args[0] === 'owner_user_id',
    );
    expect(owner_calls).toEqual([]);
    expect(mock_supabase._properties_builder._calls.slice(0, 6)).toEqual([
      { method: 'select', args: [FEED_SELECT] },
      { method: 'eq', args: ['status', 'active'] },
      { method: 'is', args: ['deleted_at', null] },
      { method: 'order', args: ['published_at', { ascending: false }] },
      { method: 'order', args: ['id', { ascending: true }] },
      { method: 'range', args: [0, PAGE_SIZE - 1] },
    ]);
  });

  it('(EC-SRC-10) cursor_10_traduce_a_range_10_19: cursor="10" → .range(10,19)', async () => {
    const mock_supabase = make_mock_supabase({ properties_result: { data: [], error: null } });

    await fetch_ordered_properties('10', { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(mock_supabase._properties_builder.range).toHaveBeenCalledWith(10, 19);
  });

  it('(EC-SRC-11) con_owner_ids_agrega_in_owner_user_id_antes_del_order: owner_ids=["u1","u2"] → .in("owner_user_id", ["u1","u2"]) llamado ANTES de los .order', async () => {
    const mock_supabase = make_mock_supabase({ properties_result: { data: [], error: null } });

    await fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS, ['u1', 'u2']);

    const calls = mock_supabase._properties_builder._calls;
    const in_idx = calls.findIndex((c) => c.method === 'in' && c.args[0] === 'owner_user_id');
    const order_idx = calls.findIndex((c) => c.method === 'order');
    expect(in_idx).toBeGreaterThanOrEqual(0);
    expect(calls[in_idx]?.args).toEqual(['owner_user_id', ['u1', 'u2']]);
    expect(in_idx).toBeLessThan(order_idx);
  });

  it('(EC-SRC-12) filtros_de_usuario_se_aplican_ademas_via_build_filter_query: filters.price_min=1000 y operation_types=["sale"] → .gte("price",1000) Y .in("operation_type",["sale","both"]) AMBOS llamados', async () => {
    const mock_supabase = make_mock_supabase({ properties_result: { data: [], error: null } });
    const filters = make_filters({ price_min: 1000, operation_types: ['sale'] });

    await fetch_ordered_properties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._properties_builder.gte).toHaveBeenCalledWith('price', 1000);
    expect(mock_supabase._properties_builder.in).toHaveBeenCalledWith('operation_type', ['sale', 'both']);
  });

  it('(EC-SRC-13) invariante_a1_radius_m_y_area_en_filters_nunca_tocan_rpc_ni_mencionan_radius_distance_area: filters.radius_m=1000 + filters.area fijada → client.rpc NUNCA llamado; ninguna llamada del chain menciona "radius"/"distance"/"area" como columna', async () => {
    const mock_supabase = make_mock_supabase({ properties_result: { data: [], error: null } });
    const filters = make_filters({ radius_m: 1000, area: { center: { lat: 20.6, lng: -103.3 }, radius_m: 500 } });

    await fetch_ordered_properties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    const suspicious = mock_supabase._properties_builder._calls.filter((c) =>
      c.args.some(
        (a) => typeof a === 'string' && (a.includes('radius') || a.includes('distance') || a.includes('area')),
      ),
    );
    expect(suspicious).toEqual([]);
  });

  it('(EC-SRC-14) filas_vacias_no_invoca_mint_video_url: select devuelve data:[] → {data:[],nextCursor:null} y functions.invoke NUNCA llamado', async () => {
    const mock_supabase = make_mock_supabase({ properties_result: { data: [], error: null } });

    const result = await fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  it('(EC-SRC-15) error_del_select_lanza_con_el_mensaje_exacto: select error → rejects con Error(message)', async () => {
    const mock_supabase = make_mock_supabase({
      properties_result: { data: null, error: { message: 'boom_select' } },
    });

    await expect(
      fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS),
    ).rejects.toThrow('boom_select');
  });

  it('(EC-SRC-16) con_filas_invoca_mint_videos_con_los_ids_exactos_de_las_filas_y_hace_merge_fail_closed: 2 filas, mint solo firma 1 → invoke recibe property_ids=[id de ambas filas] pero el resultado SOLO trae la fila con signed_url (fail-closed)', async () => {
    const rows = [make_row('ord-a'), make_row('ord-b')];
    const mock_supabase = make_mock_supabase({
      properties_result: { data: rows, error: null },
      invoke_result: { data: { videos: [make_minted('ord-a')] }, error: null },
    });

    const result = await fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('mint-video-url', {
      body: { property_ids: ['ord-a', 'ord-b'] },
    });
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('ord-a');
  });

  it('(EC-SRC-17) orden_de_salida_es_el_de_las_filas_sin_re_sort: filas devueltas en el orden [B,A] → result.data conserva ESE orden (sin reordenar)', async () => {
    const rows = [make_row('ord-b'), make_row('ord-a')];
    const mock_supabase = make_mock_supabase({
      properties_result: { data: rows, error: null },
      invoke_result: { data: { videos: [make_minted('ord-b'), make_minted('ord-a')] }, error: null },
    });

    const result = await fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(result.data.map((d) => d.id)).toEqual(['ord-b', 'ord-a']);
  });

  it('(EC-SRC-18a) next_cursor_string_offset_mas_page_size_cuando_rows_length_es_page_size: 10 filas (=PAGE_SIZE) con offset 0 → nextCursor="10"', async () => {
    const rows = Array.from({ length: PAGE_SIZE }, (_, i) => make_row(`page-${i + 1}`));
    const mock_supabase = make_mock_supabase({
      properties_result: { data: rows, error: null },
      invoke_result: { data: { videos: rows.map((r) => make_minted(r.id)) }, error: null },
    });

    const result = await fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(result.nextCursor).toBe(String(PAGE_SIZE));
  });

  it('(EC-SRC-18b) next_cursor_null_cuando_rows_length_menor_a_page_size: 3 filas (< PAGE_SIZE) → nextCursor=null', async () => {
    const rows = [make_row('short-1'), make_row('short-2'), make_row('short-3')];
    const mock_supabase = make_mock_supabase({
      properties_result: { data: rows, error: null },
      invoke_result: { data: { videos: rows.map((r) => make_minted(r.id)) }, error: null },
    });

    const result = await fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS);

    expect(result.nextCursor).toBeNull();
  });

  it('(EC-SRC-26) error_de_mint_video_url_lanza_fail_closed: functions.invoke devuelve error → fetch_ordered_properties lanza Error con ese mensaje (mismo contrato fail-closed que mint_videos)', async () => {
    const rows = [make_row('mint-fail')];
    const mock_supabase = make_mock_supabase({
      properties_result: { data: rows, error: null },
      invoke_result: { data: null, error: { message: 'ef_caida' } },
    });

    await expect(
      fetch_ordered_properties(undefined, { supabase: mock_supabase }, EMPTY_FILTERS),
    ).rejects.toThrow('ef_caida');
  });
});

// ---------------------------------------------------------------------------
// fetch_feed_page — despacho por tab
// ---------------------------------------------------------------------------

describe('fetch_feed_page — despacho por tab', () => {
  it('(EC-SRC-19) para_ti_despacha_a_fetchfeedproperties_mismos_argumentos_rpc_de_proximidad: tab="para_ti" → SÍ llama client.rpc("properties_within_radius", …) con las coords de deps y arma la propiedad completa vía el pipeline de fetchFeedProperties (mint + perfil)', async () => {
    const row = make_row('prox-1');
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: [{ id: 'prox-1', distance_m: 5 }], error: null },
      properties_result: { data: [row], error: null },
      invoke_result: { data: { videos: [make_minted('prox-1')] }, error: null },
    });
    const coords = { latitude: 20.6597, longitude: -103.3496 };

    const result = await fetch_feed_page(
      undefined,
      { supabase: mock_supabase, coords },
      EMPTY_FILTERS,
      { tab: 'para_ti', user_id: null },
    );

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith('properties_within_radius', expect.objectContaining({
      p_lat: coords.latitude,
      p_lng: coords.longitude,
    }));
    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('prox-1');
    expect(result.data[0]?.signed_url).toBeTruthy();
  });

  it('(EC-SRC-20) venta_tambien_despacha_a_proximidad_rpc_llamada: tab="venta" → client.rpc("properties_within_radius", …) SÍ se llama (mismo camino que para_ti)', async () => {
    const mock_supabase = make_mock_supabase({ rpc_result: { data: [], error: null } });

    const result = await fetch_feed_page(
      undefined,
      { supabase: mock_supabase, coords: { latitude: 1, longitude: 2 } },
      make_filters({ operation_types: ['sale'] }),
      { tab: 'venta', user_id: null },
    );

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith(
      'properties_within_radius',
      expect.objectContaining({ p_lat: 1, p_lng: 2 }),
    );
    expect(result).toEqual({ data: [], nextCursor: null });
  });

  it('(EC-SRC-21) nuevos_despacha_a_ordenada_sin_tocar_rpc_ni_owner_user_id: tab="nuevos" → client.rpc NUNCA llamado; la query a properties usa order(published_at desc)/range, sin .in("owner_user_id", …)', async () => {
    const rows = [make_row('new-1')];
    const mock_supabase = make_mock_supabase({
      properties_result: { data: rows, error: null },
      invoke_result: { data: { videos: [make_minted('new-1')] }, error: null },
    });

    const result = await fetch_feed_page(undefined, { supabase: mock_supabase }, EMPTY_FILTERS, {
      tab: 'nuevos',
      user_id: null,
    });

    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._properties_builder.order).toHaveBeenCalledWith('published_at', { ascending: false });
    const owner_calls = mock_supabase._properties_builder._calls.filter(
      (c) => c.method === 'in' && c.args[0] === 'owner_user_id',
    );
    expect(owner_calls).toEqual([]);
    expect(result.data).toHaveLength(1);
  });

  it('(EC-SRC-22) siguiendo_sin_user_id_devuelve_vacio_sin_ninguna_llamada_al_cliente: tab="siguiendo" + user_id=null → {data:[],nextCursor:null} y from/rpc/functions.invoke CERO llamadas', async () => {
    const mock_supabase = make_mock_supabase();

    const result = await fetch_feed_page(undefined, { supabase: mock_supabase }, EMPTY_FILTERS, {
      tab: 'siguiendo',
      user_id: null,
    });

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(mock_supabase._mock_rpc).not.toHaveBeenCalled();
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  it('(EC-SRC-23) siguiendo_con_follows_vacios_devuelve_vacio_sin_consultar_properties_ni_mintear: tab="siguiendo" + user_id set + follows data:[] → {data:[],nextCursor:null}, "properties" NUNCA consultada, invoke NUNCA llamado', async () => {
    const mock_supabase = make_mock_supabase({ follows_result: { data: [], error: null } });

    const result = await fetch_feed_page(undefined, { supabase: mock_supabase }, EMPTY_FILTERS, {
      tab: 'siguiendo',
      user_id: 'me-uuid',
    });

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('follows');
    expect(mock_supabase._mock_from).not.toHaveBeenCalledWith('properties');
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  it('(EC-SRC-24) siguiendo_con_dos_follows_filtra_in_owner_user_id_con_esos_ids: tab="siguiendo" + follows=["u1","u2"] → la query a properties incluye .in("owner_user_id", ["u1","u2"])', async () => {
    const rows = [make_row('sig-1', { owner_user_id: 'u1' })];
    const mock_supabase = make_mock_supabase({
      follows_result: { data: [{ followed_user_id: 'u1' }, { followed_user_id: 'u2' }], error: null },
      properties_result: { data: rows, error: null },
      invoke_result: { data: { videos: [make_minted('sig-1')] }, error: null },
    });

    const result = await fetch_feed_page(undefined, { supabase: mock_supabase }, EMPTY_FILTERS, {
      tab: 'siguiendo',
      user_id: 'me-uuid',
    });

    expect(mock_supabase._properties_builder.in).toHaveBeenCalledWith('owner_user_id', ['u1', 'u2']);
    expect(result.data).toHaveLength(1);
  });
});
