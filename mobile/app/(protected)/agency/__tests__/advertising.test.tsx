/**
 * Smoke — AgencyAdvertisingScreen (mobile/app/(protected)/agency/advertising.tsx)
 * Subtarea Taskmaster: 221.3.
 *
 * Pantalla NO crítica (verificación ligera): guard de rol (patrón
 * agency/invitations.tsx), y los 4 estados de la solicitud (form, pending,
 * approved, rejected). Los hooks de datos/mutación ya tienen su propia
 * cobertura crítica (useMyAdvertisingRequest.test.ts /
 * useCreateAdvertisingRequest.test.ts) — aquí solo se prueba el CABLEADO.
 */
import React from 'react';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react-native';

import { useAgencyRole } from '@/features/leads/hooks/useAgencyRole';
import { useMyAdvertisingRequest } from '@/features/agency/hooks/useMyAdvertisingRequest';
import { useCreateAdvertisingRequest } from '@/features/agency/hooks/useCreateAdvertisingRequest';
import AgencyAdvertisingScreen from '../advertising';

jest.mock('@/features/leads/hooks/useAgencyRole', () => ({
  useAgencyRole: jest.fn(),
}));

jest.mock('@/features/agency/hooks/useMyAdvertisingRequest', () => ({
  useMyAdvertisingRequest: jest.fn(),
}));

jest.mock('@/features/agency/hooks/useCreateAdvertisingRequest', () => ({
  useCreateAdvertisingRequest: jest.fn(),
}));

jest.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
}));

const mock_use_agency_role = useAgencyRole as jest.MockedFunction<typeof useAgencyRole>;
const mock_use_my_request = useMyAdvertisingRequest as jest.MockedFunction<
  typeof useMyAdvertisingRequest
>;
const mock_use_create_request = useCreateAdvertisingRequest as jest.MockedFunction<
  typeof useCreateAdvertisingRequest
>;

type RenderResult = Awaited<ReturnType<typeof render>>;

function set_owner_role() {
  mock_use_agency_role.mockReturnValue({
    isOwner: true,
    isAdmin: false,
    canViewTeam: true,
    agencyId: 'agency-1',
    memberRole: 'owner',
    loading: false,
    error: false,
    refetch: jest.fn(),
  });
}

async function render_screen(): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = await render(<AgencyAdvertisingScreen />);
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  set_owner_role();
  mock_use_create_request.mockReturnValue({
    submit: jest.fn().mockResolvedValue({ ok: true, error: null }),
    submitting: false,
    error: null,
  });
});

afterEach(() => {
  cleanup();
});

describe('AgencyAdvertisingScreen', () => {
  it('no owner → Redirect (no revienta el render)', async () => {
    mock_use_agency_role.mockReturnValue({
      isOwner: false,
      isAdmin: false,
      canViewTeam: false,
      agencyId: null,
      memberRole: null,
      loading: false,
      error: false,
      refetch: jest.fn(),
    });
    mock_use_my_request.mockReturnValue({
      loading: false,
      request: null,
      error_message: null,
      refetch: jest.fn(),
    });
    await render_screen();
    // Redirect está mockeado a null — el smoke solo confirma que no lanza.
    expect(screen.queryByText('Enviar solicitud')).toBeNull();
  });

  it('sin solicitud previa → muestra el formulario', async () => {
    mock_use_my_request.mockReturnValue({
      loading: false,
      request: null,
      error_message: null,
      refetch: jest.fn(),
    });
    await render_screen();
    expect(screen.getByText('Enviar solicitud')).toBeTruthy();
  });

  it('sin categoría seleccionada → enviar muestra el error de selección', async () => {
    mock_use_my_request.mockReturnValue({
      loading: false,
      request: null,
      error_message: null,
      refetch: jest.fn(),
    });
    const submit = jest.fn();
    mock_use_create_request.mockReturnValue({ submit, submitting: false, error: null });
    await render_screen();
    await act(async () => {
      await fireEvent.press(screen.getByText('Enviar solicitud'));
    });
    expect(screen.getByText('Selecciona una categoría de anunciante.')).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });

  it('solicitud pending → aviso "en revisión" con la categoría propuesta', async () => {
    mock_use_my_request.mockReturnValue({
      loading: false,
      request: {
        id: 'req-1',
        proposed_category: 'seguros',
        status: 'pending',
        rejection_reason: null,
        created_at: '2026-08-29T00:00:00Z',
      },
      error_message: null,
      refetch: jest.fn(),
    });
    await render_screen();
    expect(screen.getByTestId('status-pending')).toBeTruthy();
    expect(screen.getByText('Seguros')).toBeTruthy();
  });

  it('solicitud rejected → muestra el motivo y permite reintentar', async () => {
    mock_use_my_request.mockReturnValue({
      loading: false,
      request: {
        id: 'req-2',
        proposed_category: 'mudanzas',
        status: 'rejected',
        rejection_reason: 'Categoría no aplica.',
        created_at: '2026-08-29T00:00:00Z',
      },
      error_message: null,
      refetch: jest.fn(),
    });
    await render_screen();
    expect(screen.getByTestId('status-rejected')).toBeTruthy();
    expect(screen.getByText('Categoría no aplica.')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByText('Solicitar de nuevo'));
    });
    expect(screen.getByText('Enviar solicitud')).toBeTruthy();
  });

  it('solicitud approved → aviso de cuenta activa', async () => {
    mock_use_my_request.mockReturnValue({
      loading: false,
      request: {
        id: 'req-3',
        proposed_category: 'notaria',
        status: 'approved',
        rejection_reason: null,
        created_at: '2026-08-29T00:00:00Z',
      },
      error_message: null,
      refetch: jest.fn(),
    });
    await render_screen();
    expect(screen.getByTestId('status-approved')).toBeTruthy();
  });
});
