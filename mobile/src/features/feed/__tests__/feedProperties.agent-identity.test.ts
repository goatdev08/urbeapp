/**
 * Tests fase RED — #145.2: identidad real del agente en el feed.
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 *
 * Contrato NUEVO:
 *   - FEED_SELECT embebe la vista agent_public_profiles ANIDADA en users
 *     (users!properties_owner_user_id_fkey(phone, agent_public_profiles(...)))
 *     — verificado en vivo contra el remoto (PostgREST resuelve la vista por
 *     los FKs de su tabla base; smoke 2026-08-10 devolvió full_name+foto).
 *   - FeedPropertyWithUrl gana agent_name y agent_photo_url (string | null).
 *     agent_photo_url es el valor CRUDO de la vista: key R2 nueva o URL legacy
 *     de Storage — la resolución a URL presentable la hace useR2Urls en la UI
 *     (passthrough de http(s), mint de keys).
 *   - Fail-open: sin embed (agente sin fila en la vista, p.ej. sin preferencias
 *     o fixture viejo) → agent_name/agent_photo_url null y la propiedad SIGUE
 *     en el feed (la identidad es decoración, no requisito).
 *   - PostgREST puede devolver el embed to-one como objeto O array de 1 — se
 *     normaliza igual que el embed users existente.
 *
 * EDGE CASES:
 * - (AI-1) embed_objeto_mapea_agent_name_y_photo + select pide la vista
 * - (AI-2) sin_embed_agent_fields_null_propiedad_no_se_omite
 * - (AI-3) embed_array_de_uno_se_normaliza
 */

import { fetchFeedProperties } from '../lib/feedProperties';

type ProfileEmbed = { full_name: string | null; profile_photo_url: string | null };

type QueryRow = {
  id: string;
  price: number;
  address: string;
  bedrooms: number;
  bathrooms: number;
  owner_user_id: string;
  agency_id: string | null;
  created_at: string;
  users: {
    phone: string | null;
    agent_public_profiles?: ProfileEmbed | ProfileEmbed[] | null;
  } | null;
  property_videos: { id: string; storage_path: string; position: number }[];
};

function make_row(n: number, users: QueryRow['users']): QueryRow {
  return {
    id: `prop-id-${n}`,
    price: 1500000,
    address: `Calle ${n} #100, GDL`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: `agent-uuid-${n}`,
    agency_id: null,
    created_at: `2026-08-0${n}T10:00:00Z`,
    users,
    property_videos: [
      { id: `vid-id-${n}`, storage_path: `agent-uuid-${n}/vid-id-${n}.mp4`, position: 0 },
    ],
  };
}

function make_minted(n: number) {
  return {
    property_id: `prop-id-${n}`,
    video_id: `vid-id-${n}`,
    signed_url: `https://signed/prop-id-${n}`,
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
        data: { videos: rows.map((_, i) => make_minted(i + 1)) },
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

describe('fetchFeedProperties — identidad del agente (#145.2)', () => {
  it('(AI-1) embed_objeto_mapea_agent_name_y_photo: users.agent_public_profiles objeto → agent_name/agent_photo_url en el resultado; el select PIDE la vista anidada', async () => {
    const rows = [
      make_row(1, {
        phone: '+523311122233',
        agent_public_profiles: {
          full_name: 'Vladimir YEH',
          profile_photo_url: 'avatars/vlad.jpg',
        },
      }),
    ];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.agent_name).toBe('Vladimir YEH');
    expect(result.data[0]!.agent_photo_url).toBe('avatars/vlad.jpg');
    expect(result.data[0]!.agent_phone).toBe('+523311122233');

    const select_arg = mock_supabase._builder.select.mock.calls[0]?.[0] as string;
    expect(select_arg).toContain('agent_public_profiles(full_name, profile_photo_url)');
  });

  it('(AI-2) sin_embed_agent_fields_null_propiedad_no_se_omite: users sin agent_public_profiles → agent_name/agent_photo_url null y la propiedad sigue en el feed', async () => {
    const rows = [make_row(1, { phone: null })];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.agent_name).toBeNull();
    expect(result.data[0]!.agent_photo_url).toBeNull();
  });

  it('(AI-3) embed_array_de_uno_se_normaliza: agent_public_profiles como [fila] → se lee el primer elemento (mismo trato que el embed users)', async () => {
    const rows = [
      make_row(1, {
        phone: null,
        agent_public_profiles: [
          { full_name: 'Sofía Ramos', profile_photo_url: null },
        ],
      }),
    ];
    const mock_supabase = make_mock_supabase(rows);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data[0]!.agent_name).toBe('Sofía Ramos');
    expect(result.data[0]!.agent_photo_url).toBeNull();
  });
});
