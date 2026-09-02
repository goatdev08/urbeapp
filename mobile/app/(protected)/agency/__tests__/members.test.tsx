/**
 * Smoke — AgencyMembersScreen (mobile/app/(protected)/agency/members.tsx)
 * Subtarea Taskmaster: 203.2.
 *
 * Pantalla NO crítica (verificación ligera, patrón advertising.test.tsx): los
 * hooks de datos/mutación ya tienen su propia cobertura crítica
 * (useUnmanagedInventory.test.ts / useReassignMemberProperties.test.ts) —
 * aquí solo se prueba el CABLEADO de #203.2: la tarjeta de un miembro
 * suspendido/removido muestra "N publicaciones sin gestor" y, si N>0, el
 * botón "Reasignar publicaciones" dispara el picker (Alert.alert) → el hook
 * → el Alert de confirmación.
 */
import React from 'react';
import { Alert } from 'react-native';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react-native';

import { useAuth } from '@/features/auth/context';
import {
  fetch_own_membership,
  fetch_agency_members,
  type AgencyMemberRow,
} from '@/features/agency/api';
import { useUnmanagedInventory } from '@/features/agency/hooks/useUnmanagedInventory';
import { useReassignMemberProperties } from '@/features/agency/hooks/useReassignMemberProperties';
import AgencyMembersScreen from '../members';

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/features/agency/api', () => ({
  fetch_own_membership: jest.fn(),
  fetch_agency_members: jest.fn(),
  manage_agency_member: jest.fn(),
}));

jest.mock('@/features/agency/hooks/useUnmanagedInventory', () => ({
  useUnmanagedInventory: jest.fn(),
}));

jest.mock('@/features/agency/hooks/useReassignMemberProperties', () => ({
  useReassignMemberProperties: jest.fn(),
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
}));

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;
const mock_fetch_own_membership = fetch_own_membership as jest.MockedFunction<
  typeof fetch_own_membership
>;
const mock_fetch_agency_members = fetch_agency_members as jest.MockedFunction<
  typeof fetch_agency_members
>;
const mock_use_unmanaged_inventory = useUnmanagedInventory as jest.MockedFunction<
  typeof useUnmanagedInventory
>;
const mock_use_reassign = useReassignMemberProperties as jest.MockedFunction<
  typeof useReassignMemberProperties
>;

const AGENCY_ID = 'agencia-uuid-203-screen';
const OWNER_ID = 'owner-uuid-203';
const SUSPENDED_ID = 'agente-uuid-203-suspendido';
const ACTIVE_ID = 'agente-uuid-203-activo';

const OWNER_ROW: AgencyMemberRow = {
  id: 'member-owner',
  user_id: OWNER_ID,
  member_role: 'owner',
  status: 'active',
  full_name: 'Olivia Owner',
  profile_photo_url: null,
};

const ACTIVE_ROW: AgencyMemberRow = {
  id: 'member-active',
  user_id: ACTIVE_ID,
  member_role: 'agent',
  status: 'active',
  full_name: 'Ana Activa',
  profile_photo_url: null,
};

const SUSPENDED_ROW: AgencyMemberRow = {
  id: 'member-suspended',
  user_id: SUSPENDED_ID,
  member_role: 'agent',
  status: 'suspended',
  full_name: 'David Suspendido',
  profile_photo_url: null,
};

type RenderResult = Awaited<ReturnType<typeof render>>;

async function render_screen(): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = await render(<AgencyMembersScreen />);
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_auth.mockReturnValue({ user: { id: OWNER_ID } } as ReturnType<typeof useAuth>);
  mock_fetch_own_membership.mockResolvedValue({
    agency_id: AGENCY_ID,
    member_role: 'owner',
  });
  mock_fetch_agency_members.mockResolvedValue([OWNER_ROW, ACTIVE_ROW, SUSPENDED_ROW]);
  mock_use_reassign.mockReturnValue({
    submit: jest.fn().mockResolvedValue({ ok: true, count: 2, error: null }),
    submitting: false,
    error: null,
  });
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
});

describe('AgencyMembersScreen — inventario sin gestor (#203.2)', () => {
  it('miembro suspendido con N>0 → muestra el conteo y el botón Reasignar', async () => {
    mock_use_unmanaged_inventory.mockReturnValue({
      counts: { [SUSPENDED_ID]: 3 },
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    await render_screen();

    expect(screen.getByText('3 publicaciones sin gestor')).toBeTruthy();
    expect(
      screen.getByLabelText('Reasignar publicaciones de David Suspendido')
    ).toBeTruthy();
  });

  it('miembro suspendido con N=0 → muestra el conteo SIN botón', async () => {
    mock_use_unmanaged_inventory.mockReturnValue({
      counts: {},
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    await render_screen();

    expect(screen.getByText('0 publicaciones sin gestor')).toBeTruthy();
    expect(
      screen.queryByLabelText('Reasignar publicaciones de David Suspendido')
    ).toBeNull();
  });

  it('miembro activo → NO muestra la línea de inventario sin gestor', async () => {
    mock_use_unmanaged_inventory.mockReturnValue({
      counts: {},
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    await render_screen();

    // Solo hay un miembro con estado distinto de activo (el suspendido) —
    // si el activo también renderizara la línea, habría 2 coincidencias.
    expect(screen.getAllByText(/publicaci(ón|ones) sin gestor/)).toHaveLength(1);
  });

  it('tap en Reasignar → abre el picker con los miembros activos y, al elegir uno, llama submit + Alert de éxito', async () => {
    const submit = jest.fn().mockResolvedValue({ ok: true, count: 3, error: null });
    mock_use_reassign.mockReturnValue({ submit, submitting: false, error: null });
    mock_use_unmanaged_inventory.mockReturnValue({
      counts: { [SUSPENDED_ID]: 3 },
      loading: false,
      error: null,
      refetch: jest.fn(),
    });

    await render_screen();

    await act(async () => {
      fireEvent.press(
        screen.getByLabelText('Reasignar publicaciones de David Suspendido')
      );
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Reasignar publicaciones',
      expect.stringContaining('David Suspendido'),
      expect.any(Array)
    );

    // Simula elegir al candidato activo desde el picker — el owner NO debe
    // ofrecerse como candidato aquí porque sí es un miembro activo distinto
    // (esto documenta que el picker incluye a TODO miembro activo != origen).
    const alert_mock = Alert.alert as jest.Mock;
    const buttons = alert_mock.mock.calls[0]?.[2] as { text: string; onPress?: () => void }[];
    expect(buttons.map((b) => b.text)).toEqual(
      expect.arrayContaining(['Olivia Owner', 'Ana Activa', 'Cancelar'])
    );
    const candidate_button = buttons.find((b) => b.text === 'Ana Activa');

    await act(async () => {
      candidate_button?.onPress?.();
    });

    expect(submit).toHaveBeenCalledWith(AGENCY_ID, SUSPENDED_ID, ACTIVE_ID);
    expect(Alert.alert).toHaveBeenCalledWith(
      'Listo',
      expect.stringContaining('Ana Activa')
    );
  });
});
