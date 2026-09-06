/**
 * Tests — LeadInlineDetail (subtarea 267.6): ficha inline expandida del CRM.
 * Archivo SUT: mobile/src/features/leads/components/LeadInlineDetail.tsx
 *
 * Molde: LeadExpandedView.test.tsx (mock de hooks de datos + expo-router) +
 * memorias RNTL 14 (render()/renderHook() son async → `await`).
 *
 * Los 6 hooks de datos/mutación se mockean (el SUT es la UI, no la red):
 * useCrmLeadDetail, useLeadActivity, useCrmSuggestedMessage, useLeadPhone,
 * useUpdateLeadStatus, useUpdateLeadNote. Los mocks de mutación CAPTURAN
 * los `deps` que el componente pasa al hook (igual que la implementación
 * real) para poder disparar `onSuccess` (= onChanged del padre) al resolver
 * — así se verifica el flujo completo update_status → onChanged sin
 * reimplementar el hook real.
 */
import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';

import { LeadInlineDetail } from '../LeadInlineDetail';
import type { CrmLeadRow } from '../../types';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

// ── Mocks de hooks de datos (siempre presentes, sin loading/error) ──────────
const mock_detail_data: {
  current: { origin_property: { property_id: string; address: string; price: number; thumbnail_url: string | null } | null; other_properties: number };
} = {
  current: {
    origin_property: { property_id: 'prop-1', address: 'Bugambilias, Zapopan', price: 10_000_000, thumbnail_url: null },
    other_properties: 2,
  },
};
jest.mock('../../hooks/useCrmLeadDetail', () => ({
  useCrmLeadDetail: (..._args: unknown[]) => {
    mock_hook_calls.crm_lead_detail.push(_args[0]);
    return { data: mock_detail_data.current, loading: false, error: null, refetch: jest.fn() };
  },
}));

const mock_activity_data: { current: { occurred_at: string; kind: string; detail: Record<string, unknown> }[] } = {
  current: [{ occurred_at: '2026-09-06T11:38:00Z', kind: 'video_view', detail: {} }],
};
const mock_load_more = jest.fn();
jest.mock('../../hooks/useLeadActivity', () => ({
  useLeadActivity: (..._args: unknown[]) => {
    mock_hook_calls.lead_activity.push(_args[0]);
    return {
      data: mock_activity_data.current,
      loading: false,
      error: null,
      hasMore: false,
      loadInitial: jest.fn(),
      loadMore: mock_load_more,
      refetch: jest.fn(),
    };
  },
}));

const mock_message: { current: string | null } = { current: 'Hola Karla, ¿te gustaría agendar una visita?' };
jest.mock('../../hooks/useCrmSuggestedMessage', () => ({
  useCrmSuggestedMessage: (..._args: unknown[]) => {
    mock_hook_calls.suggested_message.push(_args[0]);
    return { message: mock_message.current, loading: false, error: null, refetch: jest.fn() };
  },
}));

const mock_phone: { current: string | null } = { current: '+525512345678' };
jest.mock('../../hooks/useLeadPhone', () => ({
  useLeadPhone: (..._args: unknown[]) => {
    mock_hook_calls.lead_phone.push(_args[0]);
    return { phone: mock_phone.current, loading: false, error: null, refetch: jest.fn() };
  },
}));

const mock_hook_calls: {
  crm_lead_detail: unknown[];
  lead_activity: unknown[];
  suggested_message: unknown[];
  lead_phone: unknown[];
} = { crm_lead_detail: [], lead_activity: [], suggested_message: [], lead_phone: [] };

// ── Mocks de mutación — capturan `deps.onSuccess` para simular el flujo real ──
const mock_update_status = jest.fn().mockResolvedValue({ ok: true, error: null });
const mock_status_deps: { current: { onSuccess?: () => void } | undefined } = { current: undefined };
jest.mock('../../hooks/useUpdateLeadStatus', () => ({
  useUpdateLeadStatus: (deps: { onSuccess?: () => void }) => {
    mock_status_deps.current = deps;
    return {
      update_status: async (...args: [string, string, string?]) => {
        const result = await mock_update_status(...args);
        if (result.ok) mock_status_deps.current?.onSuccess?.();
        return result;
      },
      is_updating: false,
      error: null,
    };
  },
}));

const mock_update_note = jest.fn().mockResolvedValue(undefined);
jest.mock('../../hooks/useUpdateLeadNote', () => ({
  useUpdateLeadNote: () => ({
    update_note: mock_update_note,
    is_updating: false,
    error: null,
  }),
}));

const mock_open_whatsapp_text = jest.fn();
jest.mock('../../../property-detail/utils/whatsapp', () => ({
  open_whatsapp_text: (...args: unknown[]) => mock_open_whatsapp_text(...args),
}));

function make_lead(overrides: Partial<CrmLeadRow> = {}): CrmLeadRow {
  return {
    lead_id: 'lead-267-6',
    user_id: 'user-1',
    full_name: 'Karla Núñez',
    avatar_url: null,
    temperature: 94,
    delta: 22,
    band: 'hot',
    signals: { video_completed: 0, video_views: 4, likes: 0, saves: 1 },
    sparkline: [1, 2, 3],
    last_activity_at: '2026-09-06T11:48:00Z',
    origin_property: { property_id: 'prop-1', address: 'Bugambilias, Zapopan', contacted_at: '2026-09-01T00:00:00Z' },
    status_projected: 'nuevo',
    ...overrides,
  };
}

const on_changed = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mock_detail_data.current = {
    origin_property: { property_id: 'prop-1', address: 'Bugambilias, Zapopan', price: 10_000_000, thumbnail_url: null },
    other_properties: 2,
  };
  mock_activity_data.current = [{ occurred_at: '2026-09-06T11:38:00Z', kind: 'video_view', detail: {} }];
  mock_message.current = 'Hola Karla, ¿te gustaría agendar una visita?';
  mock_phone.current = '+525512345678';
  mock_hook_calls.crm_lead_detail = [];
  mock_hook_calls.lead_activity = [];
  mock_hook_calls.suggested_message = [];
  mock_hook_calls.lead_phone = [];
});

describe('LeadInlineDetail', () => {
  it('(1) al montar, los 4 hooks de lectura reciben lead.lead_id', async () => {
    await render(<LeadInlineDetail lead={make_lead()} readOnly={false} onChanged={on_changed} />);

    expect(mock_hook_calls.crm_lead_detail[0]).toBe('lead-267-6');
    expect(mock_hook_calls.lead_activity[0]).toBe('lead-267-6');
    expect(mock_hook_calls.suggested_message[0]).toBe('lead-267-6');
    expect(mock_hook_calls.lead_phone[0]).toBe('lead-267-6');
  });

  it("(2) status_projected 'nuevo' — el botón marca Contactado y refresca", async () => {
    const user = userEvent.setup();
    await render(
      <LeadInlineDetail lead={make_lead({ status_projected: 'nuevo' })} readOnly={false} onChanged={on_changed} />,
    );

    await user.press(screen.getByText(/Marcar como Contactado/));

    expect(mock_update_status).toHaveBeenCalledWith('lead-267-6', 'contacted');
    expect(on_changed).toHaveBeenCalledTimes(1);
  });

  it("(3) status_projected 'visita' — el botón NO envía y abre el picker", async () => {
    const user = userEvent.setup();
    await render(
      <LeadInlineDetail lead={make_lead({ status_projected: 'visita' })} readOnly={false} onChanged={on_changed} />,
    );

    const button = screen.getByLabelText('Cerrar…');
    await user.press(button);

    expect(mock_update_status).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Cerrar…').props.accessibilityState?.expanded).toBe(true);
  });

  it("(4) status_projected 'cerrado' — label Reabrir, no envía", async () => {
    await render(
      <LeadInlineDetail lead={make_lead({ status_projected: 'cerrado' })} readOnly={false} onChanged={on_changed} />,
    );

    expect(screen.getByText('Reabrir')).toBeTruthy();
    expect(mock_update_status).not.toHaveBeenCalled();
  });

  it('(5) Agendar llama update_status con visit_scheduled', async () => {
    const user = userEvent.setup();
    await render(
      <LeadInlineDetail lead={make_lead({ status_projected: 'nuevo' })} readOnly={false} onChanged={on_changed} />,
    );

    await user.press(screen.getByLabelText('Agendar visita'));

    expect(mock_update_status).toHaveBeenCalledWith('lead-267-6', 'visit_scheduled');
  });

  it('(6) readOnly — sin botón "Marcar como", Agendar deshabilitado, WhatsApp presente', async () => {
    await render(
      <LeadInlineDetail lead={make_lead({ status_projected: 'nuevo' })} readOnly onChanged={on_changed} />,
    );

    expect(screen.queryByText(/Marcar como/)).toBeNull();
    expect(screen.getByLabelText('Agendar visita').props.accessibilityState?.disabled).toBe(true);
    expect(screen.getByLabelText('Contactar por WhatsApp')).toBeTruthy();
  });

  it('(7) phone null — WhatsApp deshabilitado', async () => {
    mock_phone.current = null;
    await render(<LeadInlineDetail lead={make_lead()} readOnly={false} onChanged={on_changed} />);

    expect(screen.getByLabelText('Contactar por WhatsApp').props.accessibilityState?.disabled).toBe(true);
  });

  it('(8) WhatsApp con phone y mensaje llama open_whatsapp_text', async () => {
    const user = userEvent.setup();
    await render(<LeadInlineDetail lead={make_lead()} readOnly={false} onChanged={on_changed} />);

    await user.press(screen.getByLabelText('Contactar por WhatsApp'));

    expect(mock_open_whatsapp_text).toHaveBeenCalledWith(
      '+525512345678',
      'Hola Karla, ¿te gustaría agendar una visita?',
    );
  });

  it('(9) mensaje sugerido null — no se renderiza la caja', async () => {
    mock_message.current = null;
    await render(<LeadInlineDetail lead={make_lead()} readOnly={false} onChanged={on_changed} />);

    expect(screen.queryByText('Mensaje sugerido')).toBeNull();
  });
});
