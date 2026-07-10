/**
 * Tests fase RED — fetchFeedProperties
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 * Subtarea Taskmaster: 9.5 — capa de datos del feed
 * REDISEÑO (#42.2 — RPC de proximidad, approach A1 lean):
 *
 * SUT: fetchFeedProperties(cursor?, deps?, filters?) →
 *        Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }>
 *
 * Contrato NUEVO (#42.2):
 *   - `radius = filters.radius_m ?? 5000`. Llama SIEMPRE
 *     `client.rpc('properties_within_radius', { p_lat, p_lng, p_radius_m: radius })`
 *     ANTES de tocar PostgREST. `p_lat/p_lng` vienen de `deps.coords` (fallback
 *     GDL si se omite — no cubierto aquí, es responsabilidad de la impl GREEN).
 *   - Expansión de radio: si la RPC devuelve `[]`, reintenta ×2 hasta
 *     MAX_ATTEMPTS=3 (radios 5000→10000→20000→40000). Si los 4 intentos
 *     devuelven vacío → `{ data: [], nextCursor: null }` SIN tocar PostgREST.
 *   - RPC con error → lanza inmediatamente (sin reintentar).
 *   - Paginación OFFSET sobre los ids de la RPC (YA NO created_at cursor):
 *     `offset = cursor ? parseInt(cursor) : 0`; `page_ids = ids.slice(offset, offset+10)`;
 *     query `.in('id', page_ids)` + `.eq('status','active')` + `.is('deleted_at', null)`
 *     + `build_filter_query(query, filters)` intacto. `nextCursor` se calcula
 *     sobre `ids.length` (universo de la RPC), no sobre las filas devueltas.
 *   - Extrae property_ids de las filas → invoca mint-video-url EF → { videos: MintedVideo[] }.
 *   - Merge fail-closed: props sin signed_url se OMITEN (nunca items sin URL).
 *   - Re-sort cliente: el resultado final se ordena por distance_m (de la RPC)
 *     ASC, sin importar el orden en que PostgREST devuelva las filas.
 *   - Query error (PostgREST) → lanza. EF error → lanza (fail-closed).
 *
 * PATRÓN DE MOCK:
 *   - DI via deps.supabase (igual que usePropertyActions/usePublish).
 *   - Query builder encadenable thenable → resuelve a { data, error }.
 *   - functions.invoke → resuelve a { data: { videos: MintedVideo[] }, error }.
 *   - supabase.rpc('properties_within_radius', {...}) → resuelve a
 *     { data: {id,distance_m}[] | null, error }. Por default, `make_mock_supabase`
 *     DERIVA los ids de la RPC a partir de `query_result.data` (o un id placeholder
 *     si `query_result.data` es null) para que los 15 tests EC-1..EC-15 heredados
 *     no necesiten tocar su cuerpo — solo el arnés cambió.
 *
 * EF RESPONSE SHAPE (verificado en handler.ts línea 62):
 *   json_response({ videos }, 200)  →  { videos: MintedVideo[] }
 *   MintedVideo = { property_id, video_id, signed_url }
 *   La key es 'videos', NO 'results'.
 *
 * EDGE CASES CUBIERTOS (20 casos):
 *
 * ### Happy path
 * - (EC-1) happy_path_n_propiedades_devuelve_feed_con_signed_url
 *
 * ### Edge cases PRD (fail-closed)
 * - (EC-2) ef_devuelve_subconjunto_excluye_propiedad_sin_url_fail_closed
 * - (EC-3) ef_devuelve_array_vacio_data_vacio_sin_throw
 * - (EC-4) query_vacia_no_invoca_ef_y_devuelve_vacios
 *
 * ### Cursor / paginación — REDISEÑADOS a offset sobre ids de la RPC (#42.2)
 * - (EC-5) cursor_offset_aplica_slice_de_ids_rpc_y_filtro_in_id
 * - (EC-6) sin_cursor_offset_cero_pagina_primeros_10_ids
 * - (EC-7) next_cursor_offset_mas_10_menor_a_total_ids_rpc
 * - (EC-8) next_cursor_null_cuando_offset_mas_10_no_menor_a_total_ids_rpc
 *
 * ### Error / boundary
 * - (EC-9) error_query_supabase_lanza_error
 * - (EC-10) error_ef_lanza_error_fail_closed
 *
 * ### Shape / contratos internos
 * - (EC-11) signed_url_mergeado_correctamente_por_property_id
 * - (EC-12) invoke_recibe_property_ids_del_resultado_query
 * - (EC-13) invoke_recibe_nombre_mint_video_url
 *
 * ### Múltiples videos / fail-closed por video_id
 * - (EC-14) video_reconciliado_con_video_id_ef_no_primer_elemento_array
 * - (EC-15) propiedad_omitida_cuando_video_id_ef_no_matchea_ningun_video_embebido
 *
 * ### RPC de proximidad, expansión de radio, re-sort (#42.2 — NUEVOS)
 * - (EC-16) resultado_ordenado_por_distancia_asc_segun_distance_map_no_orden_de_postgrest
 * - (EC-17) expansion_de_radio_5000_a_10000_cuando_rpc_devuelve_vacio_en_primer_intento
 * - (EC-17b) expansion_agotada_4_intentos_devuelve_vacio_sin_tocar_postgrest
 * - (EC-18) filters_radius_m_20000_viaja_a_rpc_como_p_radius_m
 * - (EC-19) rpc_devuelve_error_lanza_excepcion_sin_reintentar
 */

import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

import { fetchFeedProperties } from '../lib/feedProperties';
import type { FeedPropertyWithUrl } from '../types';

// ---------------------------------------------------------------------------
// Tipos auxiliares para los datos de test
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
  // status es opcional: la query embebida puede incluirlo para que la impl
  // pueda reconciliar por video_id (y filtrar por status si lo necesita).
  property_videos: { id: string; storage_path: string; position: number; status?: string }[];
};

type MintedVideo = {
  property_id: string;
  video_id: string;
  signed_url: string;
};

// ---------------------------------------------------------------------------
// Factories — datos de test
// ---------------------------------------------------------------------------

/** Crea una fila de query con valores predecibles. */
function make_query_row(n: number): QueryRow {
  return {
    id: `prop-id-${n}`,
    price: 1000000 + n * 50000,
    address: `Calle ${n} #100, CDMX`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: `agent-uuid-${n}`,
    agency_id: null,
    created_at: `2026-06-${String(28 - n).padStart(2, '0')}T10:00:00Z`,
    property_videos: [{ id: `vid-id-${n}`, storage_path: `agent-uuid-${n}/vid-id-${n}.mp4`, position: 0 }],
  };
}

/** Crea un MintedVideo para la prop n (lo que devuelve la EF). */
function make_minted_video(n: number): MintedVideo {
  return {
    property_id: `prop-id-${n}`,
    video_id: `vid-id-${n}`,
    signed_url: `https://storage.supabase.co/signed/prop-id-${n}?token=tok${n}`,
  };
}

/** Genera N filas de query. */
function make_query_rows(count: number): QueryRow[] {
  return Array.from({ length: count }, (_, i) => make_query_row(i + 1));
}

/** Genera N MintedVideo (uno por prop). */
function make_minted_videos(count: number): MintedVideo[] {
  return Array.from({ length: count }, (_, i) => make_minted_video(i + 1));
}

/**
 * Crea una fila con DOS videos embebidos: el primero es NOT-ready (uploading),
 * el segundo es el ready. El NOT-ready está en índice 0 para exponer que
 * `property_videos[0]` es la elección incorrecta cuando la EF elige el ready.
 * Incluye `status` para que la implementación correcta pueda reconciliar.
 */
function make_query_row_con_videos_multiples(prop_id: string): QueryRow {
  return {
    id: prop_id,
    price: 2500000,
    address: 'Av. Insurgentes Sur #1234, CDMX',
    bedrooms: 3,
    bathrooms: 2,
    owner_user_id: 'agent-uuid-multi',
    agency_id: null,
    created_at: '2026-06-28T10:00:00Z',
    property_videos: [
      // índice 0: uploading — el que toma [0] erróneamente
      { id: 'vid-upload', storage_path: 'x/upload.mp4', position: 1, status: 'uploading' },
      // índice 1: ready — el que la EF devuelve via video_id
      { id: 'vid-ready', storage_path: 'x/ready.mp4', position: 2, status: 'ready' },
    ],
  };
}

// ---------------------------------------------------------------------------
// Mock del query builder encadenable
//
// Supabase usa un PostgrestFilterBuilder thenable: cada método devuelve el
// mismo objeto; al `await`ar se llama su `.then()`.
// ---------------------------------------------------------------------------

type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };

function make_query_builder(result: QueryResult) {
  // Declaramos primero para poder referenciarlo en los mockReturnValue.
  const builder: {
    select: jest.Mock;
    eq: jest.Mock;
    is: jest.Mock;
    order: jest.Mock;
    limit: jest.Mock;
    lt: jest.Mock;
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
    lt: jest.fn(),
    in: jest.fn(),
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  // Cada método encadenable devuelve el propio builder.
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'lt', 'in'] as const) {
    builder[method].mockReturnValue(builder);
  }

  return builder;
}

// ---------------------------------------------------------------------------
// Mock del cliente Supabase completo
// ---------------------------------------------------------------------------

type InvokeResult = {
  data: { videos: MintedVideo[] } | null;
  error: { message: string } | null;
};

/** Fila cruda que devuelve la RPC properties_within_radius (#42.2). */
type RpcRow = { id: string; distance_m: number };
type RpcResult = { data: RpcRow[] | null; error: { message: string } | null };

function make_mock_supabase(opts: {
  query_result?: QueryResult;
  invoke_result?: InvokeResult;
  rpc_result?: RpcResult;
} = {}) {
  const {
    query_result = { data: [], error: null },
    invoke_result = { data: { videos: [] }, error: null },
    // ponytail: default DERIVADO — si no se pasa rpc_result explícito, la RPC
    // "encuentra" exactamente los ids de query_result.data (o un id placeholder
    // si query_result.data es null, para que el flujo SIGA llegando a PostgREST
    // y el error de la query pueda observarse — ver EC-9). Esto evita tocar el
    // cuerpo de los 15 tests EC-1..EC-15 preexistentes.
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
  const mock_functions = { invoke: mock_invoke };

  const mock_rpc = jest.fn().mockResolvedValue(rpc_result);

  return {
    from: mock_from,
    functions: mock_functions,
    rpc: mock_rpc,
    // Expuestos para aserciones directas
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

describe('fetchFeedProperties', () => {

  // ── (EC-1) Happy path — N propiedades con signed_url ─────────────────────

  it('(EC-1) happy_path_n_propiedades_devuelve_feed_con_signed_url: 5 props con video ready → array de 5 FeedPropertyWithUrl con signed_url mergeado por property_id', async () => {
    const rows = make_query_rows(5);
    const videos = make_minted_videos(5);
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(5);
    // Cada item debe tener signed_url
    for (const item of result.data) {
      expect(typeof item.signed_url).toBe('string');
      expect(item.signed_url.length).toBeGreaterThan(0);
    }
  });

  // ── (EC-2) EF devuelve subconjunto → fail-closed parcial ─────────────────

  it('(EC-2) ef_devuelve_subconjunto_excluye_propiedad_sin_url_fail_closed: EF devuelve 2 de 3 props → resultado tiene exactamente 2 items (la 3ª omitida)', async () => {
    const rows = make_query_rows(3);
    // La EF solo devuelve URL para prop-id-1 y prop-id-2, excluye prop-id-3
    const videos = [make_minted_video(1), make_minted_video(2)];
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(2);
    const ids = result.data.map((item: FeedPropertyWithUrl) => item.id);
    expect(ids).toContain('prop-id-1');
    expect(ids).toContain('prop-id-2');
    expect(ids).not.toContain('prop-id-3');
  });

  // ── (EC-3) EF devuelve [] → data vacío, sin throw ─────────────────────────

  it('(EC-3) ef_devuelve_array_vacio_data_vacio_sin_throw: EF devuelve videos:[] → data:[] sin lanzar excepción', async () => {
    const rows = make_query_rows(3);
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos: [] }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toEqual([]);
  });

  // ── (EC-4) Query vacía → no invoca EF, devuelve vacios ───────────────────

  it('(EC-4) query_vacia_no_invoca_ef_y_devuelve_vacios: 0 propiedades activas → data:[], nextCursor:null, functions.invoke NO llamado', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
      invoke_result: { data: { videos: [] }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toEqual([]);
    expect(result.nextCursor).toBeNull();
    expect(mock_supabase._mock_invoke).not.toHaveBeenCalled();
  });

  // ── (EC-5) Cursor = offset sobre ids de la RPC → .in('id', slice) ────────

  it('(EC-5) cursor_offset_aplica_slice_de_ids_rpc_y_filtro_in_id: cursor="10" (offset) → page_ids = ids.slice(10,20) → query builder recibe .in("id", page_ids) con el slice exacto', async () => {
    const rows = make_query_rows(15);
    const rpc_ids = rows.map((r, i) => ({ id: r.id, distance_m: i }));
    const page_rows = rows.slice(10, 15); // solo quedan 5 tras el offset 10 (universo de 15)
    const page_ids = page_rows.map((r) => r.id);
    const mock_supabase = make_mock_supabase({
      query_result: { data: page_rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });

    await fetchFeedProperties('10', { supabase: mock_supabase });

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', page_ids);
  });

  // ── (EC-6) Sin cursor → offset=0 → primeros 10 ids de la RPC ─────────────

  it('(EC-6) sin_cursor_offset_cero_pagina_primeros_10_ids: sin cursor → offset=0 → .in("id", ids.slice(0,10)) con los primeros 10 ids de la RPC', async () => {
    const rows = make_query_rows(15);
    const rpc_ids = rows.map((r, i) => ({ id: r.id, distance_m: i }));
    const page_rows = rows.slice(0, 10);
    const page_ids = page_rows.map((r) => r.id);
    const mock_supabase = make_mock_supabase({
      query_result: { data: page_rows, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });

    await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._query_builder.in).toHaveBeenCalledWith('id', page_ids);
  });

  // ── (EC-7) nextCursor: offset+10 < total de ids de la RPC ─────────────────

  it('(EC-7) next_cursor_offset_mas_10_menor_a_total_ids_rpc: RPC devuelve 15 ids → sin cursor, offset(0)+10=10 < 15 → nextCursor === "10"', async () => {
    const rows = make_query_rows(15);
    const rpc_ids = rows.map((r, i) => ({ id: r.id, distance_m: i }));
    const page_rows = rows.slice(0, 10);
    const videos = make_minted_videos(15).slice(0, 10);
    const mock_supabase = make_mock_supabase({
      query_result: { data: page_rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.nextCursor).toBe('10');
  });

  // ── (EC-8) nextCursor: offset+10 NO menor a total de ids de la RPC → null ─
  // Boundary EXACTO (offset+10 === total, no "menos de 10 filas") a propósito:
  // con 7 ids totales, el código VIEJO (basado en rows.length===PAGE_SIZE)
  // también da null por casualidad (7 !== 10), lo cual NO demuestra RED real.
  // Con exactamente 10 ids en el universo de la RPC, el código viejo SÍ
  // devuelve un nextCursor no-nulo (rows.length===10 → created_at del 10º),
  // mientras que el contrato nuevo exige null (offset(0)+10=10 no es < 10).

  it('(EC-8) next_cursor_null_cuando_offset_mas_10_no_menor_a_total_ids_rpc: RPC devuelve EXACTAMENTE 10 ids (boundary) → offset(0)+10=10 no es menor a 10 → nextCursor === null', async () => {
    const rows = make_query_rows(10);
    const rpc_ids = rows.map((r, i) => ({ id: r.id, distance_m: i }));
    const videos = make_minted_videos(10);
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result: { data: rpc_ids, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.nextCursor).toBeNull();
  });

  // ── (EC-9) Error de query Supabase → lanza Error ─────────────────────────

  it('(EC-9) error_query_supabase_lanza_error: query devuelve {data:null, error:{message}} → fetchFeedProperties lanza y supabase.from fue llamado', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: null, error: { message: 'connection refused' } },
    });

    await expect(
      fetchFeedProperties(undefined, { supabase: mock_supabase }),
    ).rejects.toThrow();

    // La query debe haberse intentado (not_implemented lanza ANTES de llamar from,
    // así que esta aserción fallará en RED y pasará en GREEN cuando la implementación
    // real intente la query antes de propagar el error).
    expect(mock_supabase._mock_from).toHaveBeenCalledWith('properties');
  });

  // ── (EC-10) Error de EF → fail-closed, lanza Error ───────────────────────

  it('(EC-10) error_ef_lanza_error_fail_closed: functions.invoke devuelve {data:null, error:{message}} → función lanza (fail-closed, invoke fue llamado)', async () => {
    const rows = make_query_rows(3);
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: null, error: { message: 'EF internal error' } },
    });

    await expect(
      fetchFeedProperties(undefined, { supabase: mock_supabase }),
    ).rejects.toThrow();

    // La EF debe haberse invocado antes de lanzar (not_implemented lanza sin invocar,
    // así que esta aserción fallará en RED y pasará en GREEN).
    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('mint-video-url', expect.anything());
  });

  // ── (EC-11) signed_url mergeado por property_id correcto ─────────────────

  it('(EC-11) signed_url_mergeado_correctamente_por_property_id: cada signed_url corresponde al property_id correcto (no mezclado)', async () => {
    // 3 props con URLs distintas
    const rows = make_query_rows(3);
    const videos: MintedVideo[] = [
      { property_id: 'prop-id-1', video_id: 'vid-id-1', signed_url: 'https://url-para-prop-1.com' },
      { property_id: 'prop-id-2', video_id: 'vid-id-2', signed_url: 'https://url-para-prop-2.com' },
      { property_id: 'prop-id-3', video_id: 'vid-id-3', signed_url: 'https://url-para-prop-3.com' },
    ];
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    const item1 = result.data.find((i: FeedPropertyWithUrl) => i.id === 'prop-id-1');
    const item2 = result.data.find((i: FeedPropertyWithUrl) => i.id === 'prop-id-2');
    const item3 = result.data.find((i: FeedPropertyWithUrl) => i.id === 'prop-id-3');

    expect(item1?.signed_url).toBe('https://url-para-prop-1.com');
    expect(item2?.signed_url).toBe('https://url-para-prop-2.com');
    expect(item3?.signed_url).toBe('https://url-para-prop-3.com');
  });

  // ── (EC-12) invoke recibe los property_ids correctos ─────────────────────

  it('(EC-12) invoke_recibe_property_ids_del_resultado_query: body de invoke contiene exactamente los ids devueltos por la query', async () => {
    const rows = make_query_rows(3);
    const videos = make_minted_videos(3);
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });

    await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
    const call_args = mock_supabase._mock_invoke.mock.calls[0] as [string, { body: { property_ids: string[] } }];
    const received_ids = call_args[1]?.body?.property_ids;

    expect(received_ids).toEqual(
      expect.arrayContaining(['prop-id-1', 'prop-id-2', 'prop-id-3']),
    );
    expect(received_ids).toHaveLength(3);
  });

  // ── (EC-13) invoke recibe el nombre exacto 'mint-video-url' ───────────────

  it('(EC-13) invoke_recibe_nombre_mint_video_url: primer argumento de functions.invoke es exactamente "mint-video-url"', async () => {
    const rows = make_query_rows(2);
    const videos = make_minted_videos(2);
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });

    await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith(
      'mint-video-url',
      expect.anything(),
    );
  });

  // ── (EC-14) Múltiples videos: video reconciliado con video_id de la EF ────
  //
  // Hueco mock-vs-prod (lección #8): la impl toma property_videos[0] sin
  // reconciliar. Si el primer video es uploading y el segundo es ready, el
  // campo `video` del resultado describe el uploading en lugar del ready.

  it('(EC-14) video_reconciliado_con_video_id_ef_no_primer_elemento_array: propiedad con dos videos embebidos (uploading en [0], ready en [1]) → video del resultado corresponde al ready (el que devuelve la EF por video_id), NO al uploading del índice 0', async () => {
    const prop_id = 'prop-multi-video';
    const row = make_query_row_con_videos_multiples(prop_id);

    // La EF elige el video ready (vid-ready), que está en índice 1 del array.
    const minted: MintedVideo = {
      property_id: prop_id,
      video_id: 'vid-ready',
      signed_url: 'https://signed/ready',
    };

    const mock_supabase = make_mock_supabase({
      query_result: { data: [row], error: null },
      invoke_result: { data: { videos: [minted] }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    const item = result.data[0]!;

    // El video debe ser el ready (reconciliado con video_id de la EF),
    // NO el uploading que está en property_videos[0].
    expect(item.video.id).toBe('vid-ready');
    expect(item.video.storage_path).toBe('x/ready.mp4');
    expect(item.video.position).toBe(2);
    // El signed_url debe corresponder al video ready
    expect(item.signed_url).toBe('https://signed/ready');
    expect(item.video_id).toBe('vid-ready');
  });

  // ── (EC-15) Fail-closed: video_id de la EF no matchea ningún video embebido

  it('(EC-15) propiedad_omitida_cuando_video_id_ef_no_matchea_ningun_video_embebido: EF devuelve video_id que no existe en property_videos → la propiedad se OMITE (fail-closed, no aparece en data)', async () => {
    // La propiedad tiene un solo video embebido con id 'vid-other'.
    const row: QueryRow = {
      id: 'prop-huerfana',
      price: 1800000,
      address: 'Calle Inconsistente #42, CDMX',
      bedrooms: 2,
      bathrooms: 1,
      owner_user_id: 'agent-uuid-huerfana',
      agency_id: null,
      created_at: '2026-06-28T09:00:00Z',
      property_videos: [
        { id: 'vid-other', storage_path: 'x/other.mp4', position: 0, status: 'ready' },
      ],
    };

    // La EF devuelve un video_id que NO existe en el array embebido — caso
    // degenerado de inconsistencia de datos entre la query y la EF.
    const minted: MintedVideo = {
      property_id: 'prop-huerfana',
      video_id: 'vid-nonexistent',
      signed_url: 'https://signed/nonexistent',
    };

    const mock_supabase = make_mock_supabase({
      query_result: { data: [row], error: null },
      invoke_result: { data: { videos: [minted] }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    // La propiedad debe OMITIRSE porque no se puede reconciliar el video.
    expect(result.data).toHaveLength(0);
    const ids = result.data.map((item: FeedPropertyWithUrl) => item.id);
    expect(ids).not.toContain('prop-huerfana');
  });

  // ── (EC-16) Re-sort cliente por distance_m, no por orden de PostgREST ────

  it('(EC-16) resultado_ordenado_por_distancia_asc_segun_distance_map_no_orden_de_postgrest: RPC devuelve 3 ids con distance_m 300/100/200 → resultado final ordenado ASC por distancia (100,200,300) sin importar el orden de las filas de PostgREST', async () => {
    const row1 = make_query_row(1);
    const row2 = make_query_row(2);
    const row3 = make_query_row(3);
    // Postgrest devuelve las filas en un orden que NO coincide con la distancia
    // (simula que .in() no preserva el orden de los ids solicitados).
    const shuffled_rows = [row3, row1, row2];
    const videos = [make_minted_video(1), make_minted_video(2), make_minted_video(3)];
    const rpc_result = {
      data: [
        { id: 'prop-id-3', distance_m: 300 },
        { id: 'prop-id-1', distance_m: 100 },
        { id: 'prop-id-2', distance_m: 200 },
      ],
      error: null,
    };
    const mock_supabase = make_mock_supabase({
      query_result: { data: shuffled_rows, error: null },
      invoke_result: { data: { videos }, error: null },
      rpc_result,
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data.map((item: FeedPropertyWithUrl) => item.id)).toEqual([
      'prop-id-1',
      'prop-id-2',
      'prop-id-3',
    ]);
  });

  // ── (EC-17) Expansión de radio: 5000 vacío → 10000 encuentra props ───────

  it('(EC-17) expansion_de_radio_5000_a_10000_cuando_rpc_devuelve_vacio_en_primer_intento: RPC vacía a 5000m → segundo intento con p_radius_m=10000 encuentra 2 props → data no vacío; ambas llamadas a la RPC reciben los argumentos correctos', async () => {
    const rows = make_query_rows(2);
    const videos = make_minted_videos(2);
    const rpc_ids = rows.map((r, i) => ({ id: r.id, distance_m: i }));
    const coords = { latitude: 20.6597, longitude: -103.3496 };
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });
    mock_supabase._mock_rpc
      .mockReset()
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: rpc_ids, error: null });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase, coords });

    expect(result.data.length).toBeGreaterThan(0);
    expect(mock_supabase._mock_rpc).toHaveBeenNthCalledWith(1, 'properties_within_radius', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_radius_m: 5000,
    });
    expect(mock_supabase._mock_rpc).toHaveBeenNthCalledWith(2, 'properties_within_radius', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_radius_m: 10000,
    });
  });

  // ── (EC-17b) Expansión agotada (4 intentos) → vacío, sin tocar PostgREST ──

  it('(EC-17b) expansion_agotada_4_intentos_devuelve_vacio_sin_tocar_postgrest: RPC vacía en los 4 intentos (5000/10000/20000/40000) → {data:[], nextCursor:null} y PostgREST NUNCA consultado', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
    });
    mock_supabase._mock_rpc.mockReset().mockResolvedValue({ data: [], error: null });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(mock_supabase._mock_rpc).toHaveBeenCalledTimes(4);
    const radii = mock_supabase._mock_rpc.mock.calls.map(
      (call: unknown[]) => (call[1] as { p_radius_m: number }).p_radius_m,
    );
    expect(radii).toEqual([5000, 10000, 20000, 40000]);
    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
  });

  // ── (EC-18) filters.radius_m viaja a la RPC como p_radius_m ──────────────

  it('(EC-18) filters_radius_m_20000_viaja_a_rpc_como_p_radius_m: filters.radius_m=20000 → RPC recibe p_radius_m:20000 (no el default 5000)', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: [{ id: 'prop-id-1', distance_m: 1 }], error: null },
    });
    const filters: FilterState = { ...EMPTY_FILTERS, radius_m: 20000 };

    await fetchFeedProperties(undefined, { supabase: mock_supabase }, filters);

    expect(mock_supabase._mock_rpc).toHaveBeenCalledWith(
      'properties_within_radius',
      expect.objectContaining({ p_radius_m: 20000 }),
    );
  });

  // ── (EC-19) Error de RPC → lanza, sin reintentar ──────────────────────────

  it('(EC-19) rpc_devuelve_error_lanza_excepcion_sin_reintentar: RPC responde {data:null, error:{message}} → fetchFeedProperties lanza y la RPC se llamó exactamente 1 vez (solo data vacía dispara expansión, no el error)', async () => {
    const mock_supabase = make_mock_supabase({
      rpc_result: { data: null, error: { message: 'PostGIS function timeout' } },
    });

    await expect(
      fetchFeedProperties(undefined, { supabase: mock_supabase }),
    ).rejects.toThrow();

    expect(mock_supabase._mock_rpc).toHaveBeenCalledTimes(1);
  });

});
