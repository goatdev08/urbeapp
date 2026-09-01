/**
 * Smoke — AdminRequestsScreen (mobile/app/admin/requests/index.tsx)
 * Subtarea Taskmaster: 221.4.
 *
 * Pantalla NO crítica (verificación ligera): monta con las 3 secciones,
 * cablea aprobar/rechazar de las dos colas mutables a sus respectivos
 * hooks (ya cubiertos por sus propias suites críticas —
 * useAdminRequestsQueues.test.ts / useResolveRequest.test.ts). Aquí solo se
 * prueba que la pantalla PASE los params correctos, mismo criterio que
 * app/admin/reports/__tests__/index.test.tsx.
 */
import React from 'react';
import { render, act, cleanup, screen, fireEvent } from '@testing-library/react-native';

import {
  useAdminAgentApplications,
  useAdminPendingAgencies,
  useAdminAdvertisingRequests,
} from '@/features/admin/hooks/useAdminRequestsQueues';
import {
  useResolveAgentApplication,
  useResolveAdvertisingRequest,
} from '@/features/admin/hooks/useResolveRequest';
import AdminRequestsScreen from '../index';

jest.mock('@/features/admin/hooks/useAdminRequestsQueues', () => ({
  useAdminAgentApplications: jest.fn(),
  useAdminPendingAgencies: jest.fn(),
  useAdminAdvertisingRequests: jest.fn(),
}));

jest.mock('@/features/admin/hooks/useResolveRequest', () => ({
  useResolveAgentApplication: jest.fn(),
  useResolveAdvertisingRequest: jest.fn(),
}));

const mock_push = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mock_push }),
}));

const mock_agent_applications = useAdminAgentApplications as jest.MockedFunction<
  typeof useAdminAgentApplications
>;
const mock_pending_agencies = useAdminPendingAgencies as jest.MockedFunction<
  typeof useAdminPendingAgencies
>;
const mock_advertising_requests = useAdminAdvertisingRequests as jest.MockedFunction<
  typeof useAdminAdvertisingRequests
>;
const mock_resolve_agent_application = useResolveAgentApplication as jest.MockedFunction<
  typeof useResolveAgentApplication
>;
const mock_resolve_advertising_request = useResolveAdvertisingRequest as jest.MockedFunction<
  typeof useResolveAdvertisingRequest
>;

type RenderResult = Awaited<ReturnType<typeof render>>;

const AGENT_APPLICATION = {
  id: 'app-1',
  user_id: 'user-1',
  application_type: 'independent' as const,
  agency_id: null,
  reason: 'Quiero publicar',
  created_at: '2026-08-29T00:00:00Z',
  applicant: { first_name: 'Ana', last_name: 'García', email: 'ana@example.com' },
  agency: null,
};

const PENDING_AGENCY = {
  id: 'agency-1',
  name: 'Inmobiliaria Ejemplo',
  slug: 'inmobiliaria-ejemplo',
  contact_name: 'Bruno',
  contact_email: 'bruno@example.com',
  created_at: '2026-08-29T00:00:00Z',
};

const ADVERTISING_REQUEST = {
  id: 'req-1',
  agency_id: 'agency-1',
  requested_by_user_id: 'user-1',
  proposed_category: 'seguros' as const,
  created_at: '2026-08-29T00:00:00Z',
  agency: { id: 'agency-1', name: 'Inmobiliaria Ejemplo' },
};

function set_default_mocks() {
  mock_agent_applications.mockReturnValue({
    items: [AGENT_APPLICATION],
    is_loading: false,
    error_message: null,
    refetch: jest.fn(),
  });
  mock_pending_agencies.mockReturnValue({
    items: [PENDING_AGENCY],
    is_loading: false,
    error_message: null,
    refetch: jest.fn(),
  });
  mock_advertising_requests.mockReturnValue({
    items: [ADVERTISING_REQUEST],
    is_loading: false,
    error_message: null,
    refetch: jest.fn(),
  });
  mock_resolve_agent_application.mockReturnValue({
    resolve: jest.fn().mockResolvedValue({ ok: true, error: null }),
    is_submitting: false,
    error_message: null,
  });
  mock_resolve_advertising_request.mockReturnValue({
    resolve: jest.fn().mockResolvedValue({ ok: true, error: null }),
    is_submitting: false,
    error_message: null,
  });
}

async function render_screen(): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = await render(<AdminRequestsScreen />);
  });
  return result;
}

beforeEach(() => {
  jest.clearAllMocks();
  set_default_mocks();
});

afterEach(() => {
  cleanup();
});

describe('AdminRequestsScreen', () => {
  it('monta las 3 secciones con sus filas', async () => {
    await render_screen();
    expect(screen.getByText('Solicitudes de agente')).toBeTruthy();
    expect(screen.getByText('Inmobiliarias por aprobar')).toBeTruthy();
    expect(screen.getByText('Solicitudes de cuenta comercial')).toBeTruthy();
    expect(screen.getByTestId('agent-application-app-1')).toBeTruthy();
    expect(screen.getByTestId('pending-agency-agency-1')).toBeTruthy();
    expect(screen.getByTestId('advertising-request-req-1')).toBeTruthy();
  });

  it('aprobar una solicitud de agente llama resolve con approve:true', async () => {
    const resolve = jest.fn().mockResolvedValue({ ok: true, error: null });
    mock_resolve_agent_application.mockReturnValue({
      resolve,
      is_submitting: false,
      error_message: null,
    });
    await render_screen();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('approve-agent-application-app-1'));
    });
    expect(resolve).toHaveBeenCalledWith({ application_id: 'app-1', approve: true });
  });

  it('rechazar una solicitud de agente abre el modal y exige motivo', async () => {
    const resolve = jest.fn().mockResolvedValue({ ok: true, error: null });
    mock_resolve_agent_application.mockReturnValue({
      resolve,
      is_submitting: false,
      error_message: null,
    });
    await render_screen();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reject-agent-application-app-1'));
    });
    const confirm_btn = screen.getByTestId('rejection-reason-confirm');
    expect(confirm_btn.props.accessibilityState?.disabled).toBe(true);

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('rejection-reason-input'), 'Datos incompletos');
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('rejection-reason-confirm'));
    });
    expect(resolve).toHaveBeenCalledWith({
      application_id: 'app-1',
      approve: false,
      reason: 'Datos incompletos',
    });
  });

  it('tocar una inmobiliaria pendiente navega al detalle existente', async () => {
    await render_screen();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('pending-agency-agency-1'));
    });
    expect(mock_push).toHaveBeenCalledWith('/admin/agencies/agency-1');
  });

  it('aprobar una solicitud de cuenta comercial llama resolve con approve:true', async () => {
    const resolve = jest.fn().mockResolvedValue({ ok: true, error: null });
    mock_resolve_advertising_request.mockReturnValue({
      resolve,
      is_submitting: false,
      error_message: null,
    });
    await render_screen();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('approve-advertising-request-req-1'));
    });
    expect(resolve).toHaveBeenCalledWith({ request_id: 'req-1', approve: true });
  });

  it('las 3 secciones muestran estado vacío de forma independiente', async () => {
    mock_agent_applications.mockReturnValue({
      items: [],
      is_loading: false,
      error_message: null,
      refetch: jest.fn(),
    });
    await render_screen();
    expect(screen.getByTestId('agent-applications-empty')).toBeTruthy();
    expect(screen.getByTestId('pending-agency-agency-1')).toBeTruthy();
    expect(screen.getByTestId('advertising-request-req-1')).toBeTruthy();
  });
});
