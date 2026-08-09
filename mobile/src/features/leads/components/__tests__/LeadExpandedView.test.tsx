/**
 * Tests — LeadExpandedView: desplegable de estados (#117).
 * Archivo SUT: mobile/src/features/leads/components/LeadExpandedView.tsx
 *
 * POR QUÉ EXISTE ESTE ARCHIVO (y por qué NO basta):
 * este sheet lleva dos reportes del dueño encima. El segundo (#113) fue un
 * `flex: 1` colapsado a altura 0: el sheet abría vacío y los 99 tests de leads
 * pasaban igual antes y después, porque **RNTL no calcula layout**. Lo que RNTL
 * SÍ ve es el renderizado condicional — y eso es exactamente lo que el
 * desplegable de #117 introduce. Estos tests pinean esa parte; la parte de
 * layout se sigue verificando con captura en el simulador, no aquí.
 *
 * Contrato bajo prueba:
 *   - Cerrado por defecto: las opciones NO están montadas, pero el estado
 *     actual SÍ se ve (es el disparador).
 *   - Tocar el disparador despliega las 8 opciones de ALL_LEAD_STATUSES.
 *   - Elegir una opción llama update_status y CIERRA la lista.
 *   - readOnly: el disparador no despliega nada (permisos intactos).
 *   - El error de la EF se ve aunque la lista esté cerrada — vive fuera del
 *     desplegable a propósito (si viviera dentro, sería invisible justo cuando
 *     importa, porque elegir una opción cierra la lista).
 *
 * NOTA RNTL v14: render() retorna Promise → await render(...).
 */

import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';

import { LeadExpandedView } from '../LeadExpandedView';
import { ALL_LEAD_STATUSES, get_status_meta } from '../../lead_status_meta';
import type { AgentLead } from '../../types';

// ── Mocks de los 3 hooks de datos (el SUT es la UI, no la red) ───────────────
const mock_update_status = jest.fn().mockResolvedValue({ ok: true });
let mock_status_error: string | null = null;

jest.mock('../../hooks/useUpdateLeadStatus', () => ({
  useUpdateLeadStatus: () => ({
    update_status: mock_update_status,
    is_updating: false,
    error: mock_status_error,
  }),
}));

jest.mock('../../hooks/useUpdateLeadNote', () => ({
  useUpdateLeadNote: () => ({
    update_note: jest.fn().mockResolvedValue({ ok: true }),
    is_updating: false,
    error: null,
  }),
}));

jest.mock('../../hooks/useLeadStatusHistory', () => ({
  useLeadStatusHistory: () => ({ history: [], loading: false, error: null }),
}));

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const LEAD: AgentLead = {
  id: 'lead-1',
  user_id: 'user-1',
  agent_id: 'agent-1',
  status: 'whatsapp_opened',
  full_name: 'Ana Buscadora',
  phone: '+521111111111',
  profile_photo_url: null,
  internal_notes: null,
  first_contact_at: '2026-08-01T00:00:00Z',
  last_contact_at: null,
  updated_at: '2026-08-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z',
  origin_property_id: null,
  origin_property_address: null,
  origin_property_thumbnail_url: null,
  score: 0,
  level: 'frio',
  is_follow_up: false,
} as unknown as AgentLead;

/** Etiqueta de un estado que NO es el actual — sirve para distinguir
 *  "la opción está montada" de "el disparador muestra el estado actual". */
const OTRO_ESTADO = ALL_LEAD_STATUSES.find((s) => s !== LEAD.status)!;
const OTRO_LABEL = get_status_meta(OTRO_ESTADO).label;

function renderView(overrides: Partial<React.ComponentProps<typeof LeadExpandedView>> = {}) {
  return render(
    <LeadExpandedView
      lead={LEAD}
      visible
      onClose={jest.fn()}
      onSuccess={jest.fn()}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  mock_update_status.mockClear();
  mock_status_error = null;
});

describe('LeadExpandedView — desplegable de estados (#117)', () => {
  it('arranca CERRADO: no monta las opciones, pero el estado actual sí se ve', async () => {
    await renderView();

    // El disparador muestra el estado actual (FIX3: siempre visible).
    expect(screen.getByText(get_status_meta(LEAD.status).label)).toBeTruthy();
    // …y ninguna otra opción está montada todavía.
    expect(screen.queryByText(OTRO_LABEL)).toBeNull();
  });

  it('al tocar el disparador despliega TODAS las opciones', async () => {
    const user = userEvent.setup();
    await renderView();

    await user.press(screen.getByLabelText(/Abrir la lista de estados/i));

    for (const s of ALL_LEAD_STATUSES) {
      expect(screen.getAllByText(get_status_meta(s).label).length).toBeGreaterThan(0);
    }
  });

  it('elegir una opción llama update_status y CIERRA la lista', async () => {
    const user = userEvent.setup();
    await renderView();

    await user.press(screen.getByLabelText(/Abrir la lista de estados/i));
    await user.press(screen.getByLabelText(new RegExp(`^Estado: ${OTRO_LABEL}$`, 'i')));

    expect(mock_update_status).toHaveBeenCalledWith('lead-1', OTRO_ESTADO, undefined);
    // Cerrada: la opción ya no está montada (el estado actual sigue en el trigger).
    expect(screen.queryByText(OTRO_LABEL)).toBeNull();
  });

  it('readOnly: el disparador NO despliega nada (permisos intactos)', async () => {
    const user = userEvent.setup();
    await renderView({ readOnly: true });

    // Sin caret ni acción: la etiqueta del trigger es solo texto.
    expect(screen.queryByLabelText(/Abrir la lista de estados/i)).toBeNull();
    await user.press(screen.getByLabelText(`Estado: ${get_status_meta(LEAD.status).label}`));
    expect(screen.queryByText(OTRO_LABEL)).toBeNull();
    expect(mock_update_status).not.toHaveBeenCalled();
  });

  it('el error de la EF se ve aunque la lista esté cerrada', async () => {
    mock_status_error = 'No se pudo actualizar el estado.';
    await renderView();

    // Sin abrir el desplegable: si el error viviera dentro, aquí sería invisible.
    expect(screen.getByText('No se pudo actualizar el estado.')).toBeTruthy();
  });
});
