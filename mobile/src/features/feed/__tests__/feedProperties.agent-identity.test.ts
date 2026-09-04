/**
 * Tests — identidad del publicador en el feed (#145.2 → reescrito por #250).
 * Archivo SUT: mobile/src/features/feed/lib/feedProperties.ts
 *
 * POR QUÉ CAMBIA EL CONTRATO (smoke de producción #222, 2026-09-03)
 *   El contrato anterior embebía la vista ANIDADA bajo users
 *   (`users!properties_owner_user_id_fkey(phone, agent_public_profiles(...))`).
 *   Funcionó mientras se probó con admins, pero la fila de `users` de un
 *   publicador admin es INVISIBLE para cualquier no-admin (users_select solo
 *   abre la rama pública a role='agent' verificado): sin fila de users, el
 *   embed anidado viene null y con él se caen nombre, foto Y el teléfono →
 *   las 8 propiedades activas de producción salían anónimas y sin WhatsApp
 *   para los dos buscadores reales.
 *
 * CONTRATO NUEVO
 *   - El select NO pide `users`: el feed ya no depende de la RLS de esa tabla
 *     y el teléfono CRUDO deja de viajar al cliente (#116).
 *   - La identidad se lee de la vista `agent_public_profiles` en UNA query
 *     batch por página: `.in('user_id', owner_ids)` (PostgREST NO resuelve un
 *     embed directo properties→vista: probado en local, PGRST200).
 *   - `agent_phone: string | null` → `agent_has_phone: boolean`, derivado de la
 *     columna has_phone de la vista. El botón de WhatsApp del feed ya pasa por
 *     la EF contact-agent, que resuelve el número server-side.
 *   - Fail-open: sin fila en la vista (o si la query de identidad falla) la
 *     propiedad SIGUE en el feed sin identidad — es decoración, no requisito.
 *
 * EDGE CASES:
 * - (AI-1) fila_de_la_vista_mapea_nombre_foto_y_has_phone + el select NO pide users
 * - (AI-2) sin_fila_en_la_vista_identidad_null_y_propiedad_no_se_omite
 * - (AI-3) publicador_sin_telefono_agent_has_phone_false
 * - (AI-4) owners_repetidos_se_consultan_una_sola_vez (batch deduplicado)
 * - (AI-5) error_en_la_query_de_identidad_no_tumba_el_feed
 */

import { fetchFeedProperties } from '../lib/feedProperties';

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  profile_photo_url: string | null;
  has_phone: boolean;
};

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

function make_row(n: number, owner_user_id = `agent-uuid-${n}`): QueryRow {
  return {
    id: `prop-id-${n}`,
    price: 1500000,
    address: `Calle ${n} #100, GDL`,
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id,
    agency_id: null,
    created_at: `2026-08-0${n}T10:00:00Z`,
    property_videos: [
      { id: `vid-id-${n}`, storage_path: `${owner_user_id}/vid-id-${n}.mp4`, position: 0 },
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

/**
 * Mock con builders SEPARADOS por tabla: `properties` resuelve las filas y
 * `agent_public_profiles` la identidad. Un builder único para ambas tablas
 * (el mock anterior) no podía distinguir las dos queries.
 */
function make_mock_supabase(
  rows: QueryRow[],
  profiles: ProfileRow[],
  profiles_error: { message: string } | null = null,
) {
  type Builder = Record<string, jest.Mock> & {
    then: (
      onFulfilled: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise<unknown>;
    select: jest.Mock;
    in: jest.Mock;
  };

  function make_builder(result: { data: unknown; error: { message: string } | null }): Builder {
    const methods = ['select', 'eq', 'is', 'in', 'gte', 'lte'] as const;
    const builder = {
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(onFulfilled, onRejected),
    } as Builder;
    for (const method of methods) {
      builder[method] = jest.fn().mockReturnValue(builder);
    }
    return builder;
  }

  const properties_builder = make_builder({ data: rows, error: null });
  const profiles_builder = make_builder({
    data: profiles_error ? null : profiles,
    error: profiles_error,
  });

  return {
    from: jest.fn().mockImplementation((table: string) =>
      table === 'agent_public_profiles' ? profiles_builder : properties_builder,
    ),
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
    _properties: properties_builder,
    _profiles: profiles_builder,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fetchFeedProperties — identidad del publicador (#250)', () => {
  it('(AI-1) fila_de_la_vista_mapea_nombre_foto_y_has_phone: la vista alimenta agent_name/agent_photo_url/agent_has_phone y el select de properties NO pide users', async () => {
    const rows = [make_row(1, 'vlad-uuid')];
    const profiles: ProfileRow[] = [
      {
        user_id: 'vlad-uuid',
        full_name: 'Vladimir YEH',
        profile_photo_url: 'avatars/vlad.jpg',
        has_phone: true,
      },
    ];
    const mock_supabase = make_mock_supabase(rows, profiles);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.agent_name).toBe('Vladimir YEH');
    expect(result.data[0]!.agent_photo_url).toBe('avatars/vlad.jpg');
    expect(result.data[0]!.agent_has_phone).toBe(true);

    // El feed ya no depende de la RLS de users: ese embed desaparece del select.
    const select_arg = mock_supabase._properties.select.mock.calls[0]?.[0] as string;
    expect(select_arg).not.toContain('users');

    // Y la identidad se pide a la vista por owner_user_id.
    expect(mock_supabase.from).toHaveBeenCalledWith('agent_public_profiles');
    expect(mock_supabase._profiles.in).toHaveBeenCalledWith('user_id', ['vlad-uuid']);
  });

  it('(AI-2) sin_fila_en_la_vista_identidad_null_y_propiedad_no_se_omite: publicador sin fila en la vista → identidad null, has_phone false y la propiedad sigue en el feed', async () => {
    const rows = [make_row(1, 'sin-perfil-uuid')];
    const mock_supabase = make_mock_supabase(rows, []);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.agent_name).toBeNull();
    expect(result.data[0]!.agent_photo_url).toBeNull();
    expect(result.data[0]!.agent_has_phone).toBe(false);
  });

  it('(AI-3) publicador_sin_telefono_agent_has_phone_false: has_phone=false en la vista → sin botón de WhatsApp, pero con nombre y foto', async () => {
    const rows = [make_row(1, 'sin-tel-uuid')];
    const profiles: ProfileRow[] = [
      {
        user_id: 'sin-tel-uuid',
        full_name: 'Sofía Ramos',
        profile_photo_url: null,
        has_phone: false,
      },
    ];
    const mock_supabase = make_mock_supabase(rows, profiles);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data[0]!.agent_name).toBe('Sofía Ramos');
    expect(result.data[0]!.agent_has_phone).toBe(false);
  });

  it('(AI-4) owners_repetidos_se_consultan_una_sola_vez: dos propiedades del mismo publicador → un solo user_id en el .in() y ambas con identidad', async () => {
    const rows = [make_row(1, 'vlad-uuid'), make_row(2, 'vlad-uuid')];
    const profiles: ProfileRow[] = [
      {
        user_id: 'vlad-uuid',
        full_name: 'Vladimir YEH',
        profile_photo_url: 'avatars/vlad.jpg',
        has_phone: true,
      },
    ];
    const mock_supabase = make_mock_supabase(rows, profiles);

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(mock_supabase._profiles.in).toHaveBeenCalledWith('user_id', ['vlad-uuid']);
    expect(result.data).toHaveLength(2);
    expect(result.data[0]!.agent_name).toBe('Vladimir YEH');
    expect(result.data[1]!.agent_name).toBe('Vladimir YEH');
  });

  it('(AI-5) error_en_la_query_de_identidad_no_tumba_el_feed: si la vista falla, las propiedades siguen llegando sin identidad (fail-open)', async () => {
    const rows = [make_row(1, 'vlad-uuid')];
    const mock_supabase = make_mock_supabase(rows, [], { message: 'boom' });

    const result = await fetchFeedProperties(undefined, { supabase: mock_supabase });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]!.agent_name).toBeNull();
    expect(result.data[0]!.agent_has_phone).toBe(false);
  });
});
