/**
 * feedProperties.listing-meta.test.ts — Metadatos del listado en el feed
 * (quick fix 2026-08-15, sin tarea de Taskmaster).
 *
 * El overlay del feed necesita pintar chips de operación/tipo, la divisa del
 * precio y respetar price_visible. Hasta ahora FEED_SELECT no pedía ninguno
 * de esos campos → el overlay hardcodeaba MXN y mostraba siempre el monto.
 *
 * INVARIANTES:
 *   - FEED_SELECT pide operation_type, property_type, currency, price_visible.
 *   - Se mapean tal cual al FeedProperty.
 *   - Fail-open para filas viejas (fixtures / cache sin las columnas):
 *     currency ausente → 'MXN' (todo el catálogo previo es en pesos);
 *     price_visible ausente → true (comportamiento previo: siempre visible).
 *
 * EDGE CASES:
 * - (LM-1) select_pide_los_4_campos_y_se_mapean
 * - (LM-2) currency_y_price_visible_ausentes_caen_a_MXN_y_true
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

describe('fetchFeedProperties — metadatos del listado (chips, divisa, price_visible)', () => {
  it('(LM-1) select_pide_los_4_campos_y_se_mapean', async () => {
    const rows = [
      make_row(1, {
        operation_type: 'sale',
        property_type: 'terreno',
        currency: 'USD',
        price_visible: false,
      }),
    ];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.operation_type).toBe('sale');
    expect(result.data[0]!.property_type).toBe('terreno');
    expect(result.data[0]!.currency).toBe('USD');
    expect(result.data[0]!.price_visible).toBe(false);

    const select_arg = mock_supabase._builder.select.mock.calls[0]?.[0] as string;
    for (const col of ['operation_type', 'property_type', 'currency', 'price_visible']) {
      expect(select_arg).toContain(col);
    }
  });

  it('(LM-2) currency_y_price_visible_ausentes_caen_a_MXN_y_true', async () => {
    const rows = [make_row(1, { operation_type: 'rent', property_type: 'casa' })];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data[0]!.currency).toBe('MXN');
    expect(result.data[0]!.price_visible).toBe(true);
  });
});
