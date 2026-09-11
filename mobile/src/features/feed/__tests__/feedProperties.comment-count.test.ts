/**
 * feedProperties.comment-count.test.ts — RED de la subtarea 289.10 (tarea
 * #289): el rail del feed necesita `comment_count` para pintar el botón de
 * comentarios con su contador (mismo mecanismo que `currency`/`price_visible`,
 * quick fix 2026-08-15 — ver feedProperties.listing-meta.test.ts, mismo
 * patrón de fixture/mock calcado 1:1).
 *
 * Hasta esta subtarea FEED_SELECT no pide `comment_count` y build_feed_data
 * no lo mapea — `FeedProperty.comment_count` es un stub de TIPO opcional
 * (types.ts), así que hoy el valor mapeado es `undefined` para toda fila.
 *
 * INVARIANTE (GREEN futuro): fail-open a 0 para filas sin la columna —
 * mismo criterio que currency→'MXN'/price_visible→true.
 *
 * EDGE CASES:
 * - (CC-1) select_pide_comment_count_y_se_mapea
 * - (CC-2) comment_count_ausente_en_la_fila_cae_a_cero
 */

import { fetchFeedProperties } from '../lib/feedProperties';

type QueryRow = {
  id: string;
  price: number;
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  operation_type?: string;
  property_type?: string;
  currency?: string | null;
  price_visible?: boolean | null;
  comment_count?: number | null;
  users: { phone: string | null } | null;
  property_videos: { id: string; storage_path: string; position: number }[];
};

function make_row(n: number, extra: Partial<QueryRow> = {}): QueryRow {
  return {
    id: `prop-id-${n}`,
    price: 1500000,
    address: `Calle ${n} #100, GDL`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: `agent-uuid-${n}`,
    agency_id: null,
    created_at: `2026-08-0${n}T10:00:00Z`,
    users: { phone: null },
    property_videos: [
      { id: `vid-id-${n}`, storage_path: `agent-uuid-${n}/vid-id-${n}.mp4`, position: 0 },
    ],
    ...extra,
  };
}

function make_mock_supabase(rows: QueryRow[]) {
  const chain_methods = ['select', 'eq', 'is', 'in', 'gte', 'lte'] as const;
  const builder: { [K in (typeof chain_methods)[number]]: jest.Mock } & {
    then: (
      onFulfilled: (v: unknown) => unknown,
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
      Promise.resolve({ data: rows, error: null }).then(onFulfilled, onRejected),
  };
  for (const method of chain_methods) {
    builder[method].mockReturnValue(builder);
  }

  return {
    from: jest.fn().mockReturnValue(builder),
    functions: {
      invoke: jest.fn().mockResolvedValue({
        data: {
          videos: rows.map((r, i) => ({
            property_id: r.id,
            video_id: `vid-id-${i + 1}`,
            signed_url: `https://signed/${r.id}`,
          })),
        },
        error: null,
      }),
    },
    rpc: jest.fn().mockResolvedValue({
      data: rows.map((r, i) => ({ id: r.id, distance_m: (i + 1) * 100 })),
      error: null,
    }),
    _builder: builder,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchFeedProperties — comment_count del rail (289.10)', () => {
  it('(CC-1) select_pide_comment_count_y_se_mapea: la fila trae comment_count=7 → el item del feed lo expone tal cual y el select lo pide explícitamente', async () => {
    const rows = [make_row(1, { comment_count: 7 })];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.comment_count).toBe(7);

    const select_arg = mock_supabase._builder.select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('comment_count');
  });

  it('(CC-2) comment_count_ausente_en_la_fila_cae_a_cero: la fila NO trae comment_count (fixture/cache viejo) → el item del feed lo expone en 0, nunca undefined', async () => {
    const rows = [make_row(1)];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data[0]!.comment_count).toBe(0);
  });
});
