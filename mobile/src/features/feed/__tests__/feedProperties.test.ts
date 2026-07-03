/**
 * Tests fase RED — fetchFeedProperties
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 * Subtarea Taskmaster: 9.5 — capa de datos del feed
 *
 * SUT: fetchFeedProperties(cursor?, deps?) →
 *        Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }>
 *
 * Contrato:
 *   - Query a Supabase: properties WHERE status='active' AND deleted_at IS NULL
 *     con nested select property_videos(id, storage_path, position)
 *     filtrando property_videos.status='ready' AND deleted_at IS NULL,
 *     ORDER BY created_at DESC, LIMIT 10. Si cursor → añade .lt('created_at', cursor).
 *   - Extrae property_ids → invoca mint-video-url EF → { videos: MintedVideo[] }.
 *   - Merge fail-closed: props sin signed_url se OMITEN (nunca items sin URL).
 *   - nextCursor: created_at del último item de la QUERY (no del merge), null si <10.
 *   - Query error → lanza. EF error → lanza (fail-closed).
 *   - Query vacía → data:[], nextCursor:null; NO invoca la EF.
 *
 * PATRÓN DE MOCK:
 *   - DI via deps.supabase (igual que usePropertyActions/usePublish).
 *   - Query builder encadenable thenable → resuelve a { data, error }.
 *   - functions.invoke → resuelve a { data: { videos: MintedVideo[] }, error }.
 *
 * EF RESPONSE SHAPE (verificado en handler.ts línea 62):
 *   json_response({ videos }, 200)  →  { videos: MintedVideo[] }
 *   MintedVideo = { property_id, video_id, signed_url }
 *   La key es 'videos', NO 'results'.
 *
 * EDGE CASES CUBIERTOS (13 casos):
 *
 * ### Happy path
 * - (EC-1) happy_path_n_propiedades_devuelve_feed_con_signed_url
 *
 * ### Edge cases PRD (fail-closed)
 * - (EC-2) ef_devuelve_subconjunto_excluye_propiedad_sin_url_fail_closed
 * - (EC-3) ef_devuelve_array_vacio_data_vacio_sin_throw
 * - (EC-4) query_vacia_no_invoca_ef_y_devuelve_vacios
 *
 * ### Cursor / paginación
 * - (EC-5) cursor_aplica_filtro_lt_created_at
 * - (EC-6) sin_cursor_no_aplica_filtro_lt
 * - (EC-7) next_cursor_exactamente_10_items_devuelve_ultimo_created_at
 * - (EC-8) next_cursor_menos_de_10_items_es_null
 *
 * ### Error / boundary
 * - (EC-9) error_query_supabase_lanza_error
 * - (EC-10) error_ef_lanza_error_fail_closed
 *
 * ### Shape / contratos internos
 * - (EC-11) signed_url_mergeado_correctamente_por_property_id
 * - (EC-12) invoke_recibe_property_ids_del_resultado_query
 * - (EC-13) invoke_recibe_nombre_mint_video_url
 */

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
    then: (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected),
  };

  // Cada método encadenable devuelve el propio builder.
  for (const method of ['select', 'eq', 'is', 'order', 'limit', 'lt'] as const) {
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

function make_mock_supabase(opts: {
  query_result?: QueryResult;
  invoke_result?: InvokeResult;
} = {}) {
  const {
    query_result = { data: [], error: null },
    invoke_result = { data: { videos: [] }, error: null },
  } = opts;

  const query_builder = make_query_builder(query_result);
  const mock_from = jest.fn().mockReturnValue(query_builder);

  const mock_invoke = jest.fn().mockResolvedValue(invoke_result);
  const mock_functions = { invoke: mock_invoke };

  return {
    from: mock_from,
    functions: mock_functions,
    // Expuestos para aserciones directas
    _mock_from: mock_from,
    _mock_invoke: mock_invoke,
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

  // ── (EC-5) Cursor aplica filtro .lt('created_at', cursor) ────────────────

  it('(EC-5) cursor_aplica_filtro_lt_created_at: cuando cursor se pasa → query builder recibe .lt("created_at", cursor) con el valor exacto', async () => {
    const cursor = '2026-06-20T10:00:00Z';
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
    });

    await fetchFeedProperties(cursor, { supabase: mock_supabase });

    expect(mock_supabase._query_builder.lt).toHaveBeenCalledWith('created_at', cursor);
  });

  // ── (EC-6) Sin cursor → .lt NO llamado ───────────────────────────────────

  it('(EC-6) sin_cursor_no_aplica_filtro_lt: sin cursor → .lt NO fue llamado en el query builder', async () => {
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
    });

    await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._query_builder.lt).not.toHaveBeenCalled();
  });

  // ── (EC-7) nextCursor: exactamente 10 items → created_at del décimo ──────

  it('(EC-7) next_cursor_exactamente_10_items_devuelve_ultimo_created_at: 10 items en query → nextCursor === created_at del 10º item', async () => {
    const rows = make_query_rows(10);
    const videos = make_minted_videos(10);
    const expected_cursor = rows[9]!.created_at; // décimo item (índice 9)
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.nextCursor).toBe(expected_cursor);
  });

  // ── (EC-8) nextCursor: menos de 10 items → null ───────────────────────────

  it('(EC-8) next_cursor_menos_de_10_items_es_null: 7 items en query → nextCursor === null', async () => {
    const rows = make_query_rows(7);
    const videos = make_minted_videos(7);
    const mock_supabase = make_mock_supabase({
      query_result: { data: rows, error: null },
      invoke_result: { data: { videos }, error: null },
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

});
