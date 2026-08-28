/**
 * Tests fase RED — botón «Reportar» de perfil en AgentCard (subtarea 220.6,
 * tarea #220, módulo 041-M3 "reportes de perfil de publicador, alcance mínimo").
 * Archivo SUT: mobile/src/features/property-detail/components/AgentCard.tsx
 *
 * Alcance de este archivo: SOLO el botón "Reportar" nuevo + su wiring (sheet +
 * useReportUser). El resto de AgentCard (avatar/nombre/agencia/WhatsApp) es
 * comportamiento preexistente sin test hasta ahora — fuera del footprint de
 * 220.6, no se ancla aquí (evita alcance no pedido).
 *
 * Contrato nuevo (decisión 220.6, mirror del patrón owner_user_id/is_owner de
 * ActionButtons — 220.5):
 *   - AgentCardProps gana `is_self?: boolean` (default false) — la sesión
 *     actual ES el agente mostrado → el botón "Reportar" NO se renderiza (1ª
 *     capa; la 2ª es el guard dentro de useReportUser, ver
 *     useReportUser.test.tsx EC-6; la 3ª es el CHECK SQL
 *     user_reports_no_self_report).
 *   - is_self=false (o ausente) → botón "Reportar" visible,
 *     accessibilityLabel="Reportar perfil" (label DISTINTO de "Reportar
 *     publicación" de ActionButtons — coexisten en la misma pantalla de
 *     detalle sin colisionar).
 *   - Tap → abre ReportPropertySheet reusado (220.6: gana un prop `title`
 *     opcional, ver ReportPropertySheet.test.tsx) con title="Reportar perfil".
 *   - El sheet recibe on_submit=useReportUser({reported_user_id: agent.id}).submit_report.
 *
 * PATRÓN DE MOCK (mismo que ActionButtons.test.tsx): useReportUser mockeado a
 * nivel de módulo — no se mockea useAuth porque AgentCard NO llama a useAuth
 * directamente, is_self es un prop calculado por el padre (mismo patrón que
 * is_owner en ActionButtons). useR2Urls/useContactAgent también mockeados
 * (dependencias preexistentes de AgentCard, necesarias para que el render no
 * intente resolver R2/EF reales).
 *
 * EDGE CASES CUBIERTOS (6 casos):
 *
 * ### Happy path
 * - (EC-1) boton_reportar_perfil_visible_por_default_is_self_ausente
 * - (EC-2) tap_boton_reportar_perfil_abre_el_sheet_con_titulo_reportar_perfil
 * - (EC-3) submit_en_el_sheet_llama_a_useReportUser_con_reported_user_id_del_agente
 *
 * ### Edge cases del PRD (§24.2 — no auto-reporte, 1ª capa)
 * - (EC-4) is_self_true_oculta_el_boton_reportar_perfil
 * - (EC-5) is_self_false_explicito_muestra_el_boton_reportar_perfil
 *
 * ### Boundary
 * - (EC-6) boton_whatsapp_sigue_presente_junto_con_reportar_no_se_excluyen
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { useR2Urls } from '@/hooks/useR2Urls';
import { useContactAgent } from '@/hooks/useContactAgent';
import { useReportUser } from '@/features/property-detail/hooks/useReportUser';
import { AgentCard } from '../AgentCard';
import type { AgentInfo } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks de módulos — ANTES de cualquier import del SUT
// ─────────────────────────────────────────────────────────────────────────────

jest.mock('@/hooks/useR2Urls', () => ({
  useR2Urls: jest.fn(),
}));

jest.mock('@/hooks/useContactAgent', () => ({
  useContactAgent: jest.fn(),
}));

jest.mock('@/features/property-detail/hooks/useReportUser', () => ({
  useReportUser: jest.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Constantes / cast tipado
// ─────────────────────────────────────────────────────────────────────────────

const AGENT: AgentInfo = {
  id: 'agente-uuid-220-6',
  full_name: 'Vladimir Ramos',
  profile_photo_url: null,
  phone: '5215500000000',
};

const mock_use_r2_urls = useR2Urls as jest.MockedFunction<typeof useR2Urls>;
const mock_use_contact_agent = useContactAgent as jest.MockedFunction<typeof useContactAgent>;
const mock_use_report_user = useReportUser as jest.MockedFunction<typeof useReportUser>;

const mock_submit_report = jest.fn().mockResolvedValue({ ok: true });

beforeEach(() => {
  jest.clearAllMocks();
  mock_submit_report.mockClear().mockResolvedValue({ ok: true });

  mock_use_r2_urls.mockReturnValue({ urls: [null], loading: false } as any);
  mock_use_contact_agent.mockReturnValue({
    contact_agent: jest.fn().mockResolvedValue({ ok: true }),
    is_contacting: false,
  } as any);
  mock_use_report_user.mockReturnValue({
    submit_report: mock_submit_report,
    is_submitting: false,
    error_message: null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentCard — botón "Reportar" de perfil (220.6)', () => {

  it('(EC-1) boton_reportar_perfil_visible_por_default_is_self_ausente: sin pasar is_self, el botón "Reportar perfil" se renderiza', async () => {
    const { queryByLabelText } = await render(
      <AgentCard agent={AGENT} agency={null} property_id="propiedad-uuid-220-6" />
    );

    expect(queryByLabelText('Reportar perfil')).not.toBeNull();
  });

  it('(EC-2) tap_boton_reportar_perfil_abre_el_sheet_con_titulo_reportar_perfil: press → aparece el heading "Reportar perfil" del sheet reusado', async () => {
    const { queryByLabelText, queryByText } = await render(
      <AgentCard agent={AGENT} agency={null} property_id="propiedad-uuid-220-6" is_self={false} />
    );

    // Antes del tap el sheet no muestra su título (Modal visible=false).
    expect(queryByText('Reportar perfil')).toBeNull();

    // 🔴 `await` obligatorio: fireEvent es async en RNTL 14.0.1 y el commit del
    // <Modal> (visible false→true) queda diferido hasta que la promesa resuelve
    // — sin él la aserción de abajo lee el árbol viejo (gotcha de 220.5).
    await fireEvent.press(queryByLabelText('Reportar perfil')!);

    expect(queryByText('Reportar perfil')).not.toBeNull();
  });

  it('(EC-3) submit_en_el_sheet_llama_a_useReportUser_con_reported_user_id_del_agente: useReportUser se invoca con el id del agente mostrado', async () => {
    await render(
      <AgentCard agent={AGENT} agency={null} property_id="propiedad-uuid-220-6" is_self={false} />
    );

    expect(mock_use_report_user).toHaveBeenCalledWith(
      expect.objectContaining({ reported_user_id: AGENT.id }),
    );
  });

  it('(EC-4) is_self_true_oculta_el_boton_reportar_perfil: is_self=true → el botón NO se renderiza (la sesión es el propio agente)', async () => {
    const { queryByLabelText } = await render(
      <AgentCard agent={AGENT} agency={null} property_id="propiedad-uuid-220-6" is_self={true} />
    );

    expect(queryByLabelText('Reportar perfil')).toBeNull();
  });

  it('(EC-5) is_self_false_explicito_muestra_el_boton_reportar_perfil', async () => {
    const { queryByLabelText } = await render(
      <AgentCard agent={AGENT} agency={null} property_id="propiedad-uuid-220-6" is_self={false} />
    );

    expect(queryByLabelText('Reportar perfil')).not.toBeNull();
  });

  it('(EC-6) boton_whatsapp_sigue_presente_junto_con_reportar_no_se_excluyen: con teléfono presente, WhatsApp Y Reportar coexisten', async () => {
    const { queryByLabelText } = await render(
      <AgentCard agent={AGENT} agency={null} property_id="propiedad-uuid-220-6" />
    );

    expect(queryByLabelText(`Contactar a ${AGENT.full_name} por WhatsApp`)).not.toBeNull();
    expect(queryByLabelText('Reportar perfil')).not.toBeNull();
  });

});
