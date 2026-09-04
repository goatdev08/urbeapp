/**
 * Tests — PropertyDetailScreen (mobile/src/features/property-detail/PropertyDetailScreen.tsx)
 * Subtarea Taskmaster: 220.6 — fix del cableado `is_self` (violación bloqueante
 * encontrada por el guardian: el único call site de `<AgentCard>` en todo el
 * repo NO pasaba `is_self`, cae al default `false` → el botón "Reportar
 * perfil" aparece en la tarjeta de agente de TU PROPIA publicación).
 *
 * 🔴 Por qué existe: la pantalla no tenía NINGÚN test — `AgentCard.test.tsx`
 * cubre que el componente HONRA el prop `is_self` (eso ya estaba verde), pero
 * nada anclaba que la PANTALLA lo pasara. Este archivo cierra ese hueco.
 *
 * SEAM BAJO TEST: el componente `PropertyDetailScreen`, con `usePropertyDetail`
 * y `useAuth` MOCKEADOS, y CADA componente hijo (PropertyVideoPlayer,
 * PropertyInfoHeader, AmenityChips, PropertyMap, ActionButtons, DetailSkeleton,
 * ContactAgentButton, AgentCard) reemplazado por un stub que devuelve null —
 * ninguno de ellos tiene lógica bajo prueba aquí (todos ya tienen su propia
 * cobertura donde aplica). `AgentCard` es la excepción: su stub es un
 * `jest.fn()` que SÍ registra las props con las que la pantalla lo invoca —
 * es el único dato que este archivo necesita observar. Esto evita depender de
 * expo-video / react-native-maps bajo Jest (sin mock global en el repo) y
 * evita testear el comportamiento INTERNO de AgentCard (eso ya lo hace
 * AgentCard.test.tsx EC-4/EC-5 — repetirlo aquí daría falsa confianza igual
 * que el bug original).
 *
 * Casos:
 * - (EC-1) 🔴 el más importante: sesión === agente mostrado → AgentCard
 *   recibe `is_self={true}`. Mata el mutante "quitar el prop is_self del
 *   call site" (cae al default `false`, el bug original).
 * - (EC-2) sesión !== agente mostrado → AgentCard recibe `is_self={false}`.
 * - (EC-3) sin sesión (`user: null`) → AgentCard recibe `is_self={false}`
 *   (guard `user !== null` no truena con user null).
 *
 * GOTCHAS RNTL ya pagados (rntl14_renderhook_async): `render` es async →
 * SIEMPRE con `await`.
 */

import React from 'react';
import { render, cleanup } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context';
import { usePropertyDetail } from '../hooks/usePropertyDetail';
import { PropertyDetailScreen } from '../PropertyDetailScreen';
import type { PropertyDetail } from '../types';
import type { UsePropertyDetailResult } from '../hooks/usePropertyDetail';

// ---------------------------------------------------------------------------
// Mocks — babel-plugin-jest-hoist iza estos jest.mock por ENCIMA de los
// imports de arriba, así que el SUT ya los ve registrados al importarse.
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: PROPERTY_ID }),
  router: { back: jest.fn() },
}));

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../hooks/usePropertyDetail', () => ({
  usePropertyDetail: jest.fn(),
}));

// Stubs inertes — sin lógica bajo prueba en este archivo (cobertura propia
// en sus respectivos suites donde aplica).
jest.mock('../components/PropertyVideoPlayer', () => ({
  PropertyVideoPlayer: () => null,
}));
jest.mock('../components/PropertyInfoHeader', () => ({
  PropertyInfoHeader: () => null,
}));
jest.mock('../components/AmenityChips', () => ({
  AmenityChips: () => null,
}));
jest.mock('../components/PropertyMap', () => ({
  PropertyMap: () => null,
}));
// ActionButtons — registra props igual que AgentCard: el cableado
// pantalla→is_owner tampoco estaba anclado (hueco preexistente de 220.5 que el
// guardian detectó al re-arbitrar 220.6; invertir is_owner dejaba 1768/1768 en
// verde). Cuesta 4 líneas y cierra la MISMA clase de bug que motivó V1.
const mock_action_buttons = jest.fn((_props: unknown) => null);
jest.mock('../components/ActionButtons', () => ({
  ActionButtons: (props: unknown) => mock_action_buttons(props),
}));
jest.mock('../components/DetailSkeleton', () => ({
  DetailSkeleton: () => null,
}));
jest.mock('@/components/ContactAgentButton', () => ({
  ContactAgentButton: () => null,
}));

// AgentCard — el único stub que IMPORTA: registra las props recibidas.
const mock_agent_card = jest.fn((_props: unknown) => null);
jest.mock('../components/AgentCard', () => ({
  AgentCard: (props: unknown) => mock_agent_card(props),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROPERTY_ID = 'propiedad-uuid-220-6';
const AGENT_ID = 'agente-uuid-220-6';
const OTHER_USER_ID = 'otro-usuario-uuid-220-6';

function make_property_detail(): PropertyDetail {
  return {
    id: PROPERTY_ID,
    price: 12000,
    currency: 'MXN',
    price_visible: true,
    property_type: 'departamento',
    operation_type: 'rent',
    bedrooms: 2,
    bathrooms: 1,
    half_bathrooms: null,
    square_meters: 60,
    built_square_meters: null,
    address: 'Calle Falsa 123',
    description: null,
    pet_friendly: false,
    allows_no_guarantor: false,
    student_friendly: false,
    amenities: null,
    location: null,
    agent: {
      id: AGENT_ID,
      full_name: 'Agente de Prueba',
      profile_photo_url: null,
      has_phone: false,
    },
    agency: null,
    videos: [],
  };
}

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;
const mock_use_property_detail = usePropertyDetail as jest.MockedFunction<
  typeof usePropertyDetail
>;

function mock_property_detail_result(
  data: PropertyDetail | null,
): UsePropertyDetailResult {
  return { data, isLoading: false, error: null, refetch: jest.fn() };
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PropertyDetailScreen — cableado is_self hacia AgentCard (220.6)', () => {
  it('EC-1: sesión === agente mostrado → AgentCard recibe is_self=true', async () => {
    mock_use_property_detail.mockReturnValue(
      mock_property_detail_result(make_property_detail()),
    );
    mock_use_auth.mockReturnValue({
      user: { id: AGENT_ID } as any,
    } as any);

    await render(<PropertyDetailScreen />);

    expect(mock_agent_card).toHaveBeenCalledWith(
      expect.objectContaining({ is_self: true }),
    );
  });

  it('EC-2: sesión !== agente mostrado → AgentCard recibe is_self=false', async () => {
    mock_use_property_detail.mockReturnValue(
      mock_property_detail_result(make_property_detail()),
    );
    mock_use_auth.mockReturnValue({
      user: { id: OTHER_USER_ID } as any,
    } as any);

    await render(<PropertyDetailScreen />);

    expect(mock_agent_card).toHaveBeenCalledWith(
      expect.objectContaining({ is_self: false }),
    );
  });

  it('EC-4: el mismo cálculo viaja como is_owner hacia ActionButtons (ancla el cableado hermano, hueco preexistente de 220.5)', async () => {
    mock_use_property_detail.mockReturnValue(
      mock_property_detail_result(make_property_detail()),
    );
    mock_use_auth.mockReturnValue({
      user: { id: AGENT_ID } as any,
    } as any);

    await render(<PropertyDetailScreen />);

    expect(mock_action_buttons).toHaveBeenCalledWith(
      expect.objectContaining({ is_owner: true, owner_user_id: AGENT_ID }),
    );
  });

  it('EC-5: sesión ajena → ActionButtons recibe is_owner=false', async () => {
    mock_use_property_detail.mockReturnValue(
      mock_property_detail_result(make_property_detail()),
    );
    mock_use_auth.mockReturnValue({
      user: { id: OTHER_USER_ID } as any,
    } as any);

    await render(<PropertyDetailScreen />);

    expect(mock_action_buttons).toHaveBeenCalledWith(
      expect.objectContaining({ is_owner: false, owner_user_id: AGENT_ID }),
    );
  });

  it('EC-3: sin sesión (user null) → AgentCard recibe is_self=false', async () => {
    mock_use_property_detail.mockReturnValue(
      mock_property_detail_result(make_property_detail()),
    );
    mock_use_auth.mockReturnValue({ user: null } as any);

    await render(<PropertyDetailScreen />);

    expect(mock_agent_card).toHaveBeenCalledWith(
      expect.objectContaining({ is_self: false }),
    );
  });
});
