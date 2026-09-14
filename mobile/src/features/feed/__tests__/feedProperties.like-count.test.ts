/**
 * feedProperties.like-count.test.ts — RED de la subtarea 293.2 (tarea #293,
 * rediseño del overlay del feed): el overlay necesita `like_count` para
 * pintar el contador de "me gusta" (mismo mecanismo que `comment_count`,
 * subtarea 289.10 — ver feedProperties.comment-count.test.ts, mismo patrón
 * de fixture/mock calcado 1:1).
 *
 * Hasta esta subtarea FEED_SELECT no pide `like_count` y build_feed_data no
 * lo mapea — `FeedProperty` todavía no declara el campo, así que el valor
 * mapeado hoy es `undefined` para toda fila (el acceso se hace vía `any`
 * para que el test falle por ASERCIÓN en jest-expo/babel, no por tipos —
 * este proyecto no type-checkea los tests con tsc al correrlos).
 *
 * Backend: properties.like_count YA EXISTE (20260604000005) y lo mantiene
 * update_like_count() (20260701000001, pgTAP 07) — este RED no toca
 * supabase/.
 *
 * INVARIANTE (GREEN futuro): fail-open a 0 para filas sin la columna —
 * mismo criterio que comment_count→0 / currency→'MXN' / price_visible→true.
 *
 * EDGE CASES:
 * - (LC-1) select_pide_like_count_y_se_mapea
 * - (LC-2) like_count_ausente_en_la_fila_cae_a_cero
 * - (LC-3) like_count_null_en_la_fila_cae_a_cero
 * - (LC-4) select_conserva_las_columnas_que_esperan_las_suites_hermanas
 * - (LC-5) like_count_cero_explicito_se_conserva_como_cero
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
  like_count?: number | null;
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

describe('fetchFeedProperties — like_count del overlay (293.2)', () => {
  it('(LC-1) select_pide_like_count_y_se_mapea: la fila trae like_count=42 → el item del feed lo expone tal cual y el select lo pide explícitamente', async () => {
    const rows = [make_row(1, { like_count: 42 })];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).like_count).toBe(42);

    const select_arg = mock_supabase._builder.select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('like_count');
  });

  it('(LC-2) like_count_ausente_en_la_fila_cae_a_cero: la fila NO trae like_count (fixture/cache viejo) → el item del feed lo expone en 0, nunca undefined', async () => {
    const rows = [make_row(1)];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect((result.data[0] as any).like_count).toBe(0);
  });

  it('(LC-3) like_count_null_en_la_fila_cae_a_cero: la fila trae like_count=null (columna nula en DB) → el item del feed lo expone en 0', async () => {
    const rows = [make_row(1, { like_count: null })];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect((result.data[0] as any).like_count).toBe(0);
  });

  it('(LC-4) select_conserva_las_columnas_que_esperan_las_suites_hermanas: el select agrega like_count SIN reemplazar comment_count, id, price, owner_user_id ni el embed property_videos(', async () => {
    const rows = [make_row(1, { like_count: 5, comment_count: 3 })];
    const mock_supabase = make_mock_supabase(rows);

    await fetchFeedProperties(undefined, { supabase: mock_supabase });

    const select_arg = mock_supabase._builder.select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('like_count');
    expect(select_arg).toContain('comment_count');
    expect(select_arg).toContain('id');
    expect(select_arg).toContain('price');
    expect(select_arg).toContain('owner_user_id');
    expect(select_arg).toContain('property_videos(');
  });

  it('(LC-5) like_count_cero_explicito_se_conserva_como_cero: la fila trae like_count=0 (propiedad sin likes aún) → se conserva como 0, no se confunde con "ausente"', async () => {
    const rows = [make_row(1, { like_count: 0 })];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect((result.data[0] as any).like_count).toBe(0);
  });
});
