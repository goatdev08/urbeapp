/**
 * Tests — identidad del publicador en el detalle (#250).
 * Archivo SUT: mobile/src/features/property-detail/hooks/usePropertyDetail.ts
 *
 * POR QUÉ (smoke de producción #222, 2026-09-03)
 *   El detalle leía el teléfono del embed `users!properties_owner_user_id_fkey`.
 *   Cuando el publicador es admin (los dueños de TODO el inventario activo de
 *   producción) esa fila es invisible para cualquier no-admin → `agent.phone`
 *   null → sin CTA de WhatsApp, aunque el nombre y la foto sí salían (esos ya
 *   venían de la vista).
 *
 * CONTRATO NUEVO
 *   - El select principal NO embebe `users`: el detalle deja de depender de la
 *     RLS de esa tabla y el teléfono crudo no viaja al cliente (#116).
 *   - `AgentInfo.phone: string | null` → `AgentInfo.has_phone: boolean`, que
 *     sale de la columna derivada has_phone de agent_public_profiles. El número
 *     lo resuelve la EF contact-agent al pulsar el botón.
 *
 * EDGE CASES:
 * - (PD-1) identidad_y_has_phone_salen_de_la_vista + el select NO pide users
 * - (PD-2) sin_fila_en_la_vista_identidad_null_y_has_phone_false
 * - (PD-3) publicador_sin_telefono_conserva_nombre_pero_has_phone_false
 */

import { renderHook } from '@testing-library/react-native';

import { usePropertyDetail } from '../hooks/usePropertyDetail';

type ProfileRow = {
  full_name: string | null;
  profile_photo_url: string | null;
  has_phone: boolean;
};

const PROPERTY_ID = 'prop-uuid-250';
const OWNER_ID = 'vlad-uuid';

const PROPERTY_ROW = {
  id: PROPERTY_ID,
  price: 4500000,
  currency: 'MXN',
  price_visible: true,
  address: 'Av. Vallarta 1000, GDL',
  property_type: 'house',
  operation_type: 'sale',
  bedrooms: 3,
  bathrooms: 2,
  half_bathrooms: 1,
  square_meters: 220,
  built_square_meters: 180,
  description: 'Casa con jardín',
  pet_friendly: true,
  allows_no_guarantor: false,
  student_friendly: false,
  amenities: [],
  location: null,
  owner_user_id: OWNER_ID,
  agency_id: null,
  agencies: null,
  property_videos: [
    {
      id: 'vid-uuid-1',
      storage_path: 'vlad/vid-1.mp4',
      position: 0,
      deleted_at: null,
      thumbnail_url: null,
    },
  ],
};

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

function make_supabase_mock(profile: ProfileRow | null) {
  const properties_builder = {
    select: jest.fn(),
    eq: jest.fn(),
    is: jest.fn(),
    single: jest.fn().mockResolvedValue({ data: PROPERTY_ROW, error: null }),
  };
  for (const key of ['select', 'eq', 'is'] as const) {
    properties_builder[key].mockReturnValue(properties_builder);
  }

  const profiles_builder = {
    select: jest.fn(),
    eq: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue({ data: profile, error: null }),
  };
  for (const key of ['select', 'eq'] as const) {
    profiles_builder[key].mockReturnValue(profiles_builder);
  }

  return {
    from: jest.fn().mockImplementation((table: string) =>
      table === 'agent_public_profiles' ? profiles_builder : properties_builder,
    ),
    functions: {
      invoke: jest.fn().mockResolvedValue({
        data: {
          videos: [
            {
              property_id: PROPERTY_ID,
              video_id: 'vid-uuid-1',
              signed_url: 'https://signed/vid-1',
            },
          ],
        },
        error: null,
      }),
    },
    _properties: properties_builder,
    _profiles: profiles_builder,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('usePropertyDetail — identidad del publicador (#250)', () => {
  it('(PD-1) identidad_y_has_phone_salen_de_la_vista: nombre, foto y has_phone vienen de agent_public_profiles y el select principal NO pide users', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      full_name: 'Vladimir YEH',
      profile_photo_url: 'avatars/vlad.jpg',
      has_phone: true,
    });

    const { result } = await renderHook(() => usePropertyDetail(PROPERTY_ID));

    expect(result.current.error).toBeNull();
    expect(result.current.data?.agent.full_name).toBe('Vladimir YEH');
    expect(result.current.data?.agent.profile_photo_url).toBe('avatars/vlad.jpg');
    expect(result.current.data?.agent.has_phone).toBe(true);
    expect(result.current.data?.agent.id).toBe(OWNER_ID);

    const select_arg = mock_supabase_holder.client._properties.select.mock.calls[0]?.[0] as string;
    expect(select_arg).not.toContain('users');

    const profile_select = mock_supabase_holder.client._profiles.select.mock.calls[0]?.[0] as string;
    expect(profile_select).toContain('has_phone');
  });

  it('(PD-2) sin_fila_en_la_vista_identidad_null_y_has_phone_false: publicador sin preferencias → nombre/foto null, has_phone false y el detalle sigue cargando', async () => {
    mock_supabase_holder.client = make_supabase_mock(null);

    const { result } = await renderHook(() => usePropertyDetail(PROPERTY_ID));

    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.agent.full_name).toBeNull();
    expect(result.current.data?.agent.profile_photo_url).toBeNull();
    expect(result.current.data?.agent.has_phone).toBe(false);
  });

  it('(PD-3) publicador_sin_telefono_conserva_nombre_pero_has_phone_false: has_phone=false en la vista → identidad visible y CTA apagado', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      full_name: 'Sofía Ramos',
      profile_photo_url: null,
      has_phone: false,
    });

    const { result } = await renderHook(() => usePropertyDetail(PROPERTY_ID));

    expect(result.current.data?.agent.full_name).toBe('Sofía Ramos');
    expect(result.current.data?.agent.has_phone).toBe(false);
  });
});
