/**
 * Tests fase RED — #144.2: mint-video-url EN PARALELO con el select de PostgREST.
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 *
 * Contrato NUEVO:
 *   - La EF mint-video-url se invoca con los `page_ids` de la RPC (el slice de
 *     paginación) — NO con los ids de las filas que devuelva el select. La EF
 *     nunca necesitó las filas; esperarlas era 1 viaje de red extra en serie
 *     (+ el cold start de la EF) en el camino crítico del arranque en frío.
 *   - La invocación DISPARA sin esperar a que el select resuelva (Promise.all).
 *   - El merge fail-closed queda intacto: filas que el select no devolvió
 *     simplemente no se mergean; mint "de más" es desperdicio aceptable.
 *   - select vacío (filtros descartaron la página) → { data: [], nextCursor:
 *     null } sin throw, aunque el mint ya haya disparado.
 *
 * EDGE CASES:
 * - (PM-1) invoke_recibe_page_ids_de_la_rpc_no_ids_de_filas
 * - (PM-2) mint_dispara_sin_esperar_al_select
 * - (PM-3) select_vacio_con_mint_ya_disparado_devuelve_vacio_sin_throw
 */

import { fetchFeedProperties } from '../lib/feedProperties';

// ---------------------------------------------------------------------------
// Harness — igual que feedProperties.test.ts, con `then` opcionalmente gated
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
  property_videos: { id: string; storage_path: string; position: number }[];
};

type MintedVideo = { property_id: string; video_id: string; signed_url: string };
type QueryResult = { data: QueryRow[] | null; error: { message: string } | null };

function make_query_row(n: number): QueryRow {
  return {
    id: `prop-id-${n}`,
    price: 1000000 + n * 50000,
    address: `Calle ${n} #100, GDL`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: `agent-uuid-${n}`,
    agency_id: null,
    created_at: `2026-08-0${n}T10:00:00Z`,
    property_videos: [
      { id: `vid-id-${n}`, storage_path: `agent-uuid-${n}/vid-id-${n}.mp4`, position: 0 },
    ],
  };
}

function make_minted_video(n: number): MintedVideo {
  return {
    property_id: `prop-id-${n}`,
    video_id: `vid-id-${n}`,
    signed_url: `https://signed/prop-id-${n}?token=tok${n}`,
  };
}

/** Builder encadenable thenable; `gate` (opcional) retrasa la resolución. */
function make_mock_supabase(opts: {
  query_result: QueryResult;
  rpc_ids: { id: string; distance_m: number }[];
  videos?: MintedVideo[];
  query_gate?: Promise<void>;
}) {
  const { query_result, rpc_ids, videos = [], query_gate } = opts;

  const chain_methods = ['select', 'eq', 'is', 'in', 'gte', 'lte'] as const;
  const builder: { [K in (typeof chain_methods)[number]]: jest.Mock } & {
    then: (
      onFulfilled: (v: QueryResult) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    in: jest.fn(),
    gte: jest.fn(),
    lte: jest.fn(),
    then: (onFulfilled, onRejected) =>
      (query_gate ?? Promise.resolve())
        .then(() => query_result)
        .then(onFulfilled, onRejected),
  };
  for (const method of chain_methods) {
    builder[method].mockReturnValue(builder);
  }

  const mock_invoke = jest.fn().mockResolvedValue({ data: { videos }, error: null });

  return {
    from: jest.fn().mockReturnValue(builder),
    functions: { invoke: mock_invoke },
    rpc: jest.fn().mockResolvedValue({ data: rpc_ids, error: null }),
    _mock_invoke: mock_invoke,
  };
}

const flush_microtasks = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchFeedProperties — mint en paralelo (#144.2)', () => {
  // ── (PM-1) invoke recibe los page_ids del universo de la RPC ─────────────

  it('(PM-1) invoke_recibe_page_ids_de_la_rpc_no_ids_de_filas: RPC devuelve 3 ids pero el select solo 2 filas (una filtrada) → el body de mint-video-url trae los 3 page_ids', async () => {
    const rpc_ids = [1, 2, 3].map((n) => ({ id: `prop-id-${n}`, distance_m: n * 100 }));
    // El select "pierde" prop-id-2 (p.ej. un filtro de PostgREST la descartó).
    const mock_supabase = make_mock_supabase({
      query_result: { data: [make_query_row(1), make_query_row(3)], error: null },
      rpc_ids,
      videos: [make_minted_video(1), make_minted_video(3)],
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._mock_invoke).toHaveBeenCalledWith('mint-video-url', {
      body: { property_ids: ['prop-id-1', 'prop-id-2', 'prop-id-3'] },
    });
    // El merge sigue fail-closed sobre las filas reales del select.
    expect(result.data.map((i) => i.id)).toEqual(['prop-id-1', 'prop-id-3']);
  });

  // ── (PM-2) el mint NO espera al select ───────────────────────────────────

  it('(PM-2) mint_dispara_sin_esperar_al_select: con el select aún PENDIENTE, functions.invoke ya fue llamado; al liberar el select el resultado se arma normal', async () => {
    let release_query!: () => void;
    const query_gate = new Promise<void>((resolve) => {
      release_query = resolve;
    });
    const rpc_ids = [{ id: 'prop-id-1', distance_m: 50 }];
    const mock_supabase = make_mock_supabase({
      query_result: { data: [make_query_row(1)], error: null },
      rpc_ids,
      videos: [make_minted_video(1)],
      query_gate,
    });

    const pending = fetchFeedProperties(undefined, { supabase: mock_supabase });
    await flush_microtasks();

    // El select sigue gated y el mint YA debe haber salido (paralelo, no serie).
    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);

    release_query();
    const result = await pending;
    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.signed_url).toBe('https://signed/prop-id-1?token=tok1');
  });

  // ── (PM-3) select vacío con mint ya disparado → vacío sin throw ──────────

  it('(PM-3) select_vacio_con_mint_ya_disparado_devuelve_vacio_sin_throw: la RPC encontró ids pero el select devuelve 0 filas → { data: [], nextCursor: null } y el mint SÍ se invocó (paralelo)', async () => {
    const rpc_ids = [{ id: 'prop-id-1', distance_m: 50 }];
    const mock_supabase = make_mock_supabase({
      query_result: { data: [], error: null },
      rpc_ids,
      videos: [make_minted_video(1)],
    });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result).toEqual({ data: [], nextCursor: null });
    expect(mock_supabase._mock_invoke).toHaveBeenCalledTimes(1);
  });
});
