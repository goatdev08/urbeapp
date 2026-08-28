/**
 * Tests — ReportPropertySheet (hardening 220.5, mutante M9)
 * SUT: mobile/src/features/property-detail/components/ReportPropertySheet.tsx
 *
 * Contexto: componente puro (sin lógica de red propia) que recibe `on_submit`
 * (useReportProperty().submit_report) inyectado por el padre. Ancla lo que el
 * componente hace HOY, leído del código fuente (docblock + JSX):
 *   - Los 7 motivos del enum PropertyReportReason se listan como filas radio
 *     (accessibilityRole="radio", accessibilityLabel=label del motivo).
 *   - Seleccionar "Otro" monta un TextInput adicional
 *     (accessibilityLabel="Motivo del reporte") — para el resto de motivos NO existe.
 *   - can_submit = selected_reason !== null && !other_text_missing && !is_submitting
 *     donde other_text_missing = selected_reason === 'other' && reason_text.trim().length === 0
 *     → con "Otro" y texto vacío/solo espacios, el botón "Enviar reporte" queda
 *     deshabilitado (accessibilityState.disabled=true) y el press NO llama on_submit.
 *   - Con "Otro" y texto real, el press SÍ llama on_submit({ reason:'other', reason_text }).
 *   - Con un motivo distinto de "Otro", el submit está habilitado SIN texto
 *     (el campo de texto ni siquiera se monta) y el press llama
 *     on_submit({ reason: <motivo> }) — sin reason_text.
 *
 * No se mockea react-native-safe-area-context localmente: el mock oficial ya
 * está registrado globalmente en jest.setup.js (#206).
 *
 * NOTA RNTL v14: render() retorna Promise → todos los tests son async + await render(...).
 * Los tests RNTL no ven layout — no se asierta nada dependiente de altura/posición.
 *
 * EDGE CASES CUBIERTOS (5 casos, hardening del mutante M9 — can_submit sin
 * guard de texto en "Otro"):
 *
 * - (EC-1) los_7_motivos_se_muestran
 * - (EC-2) elegir_otro_revela_campo_de_texto
 * - (EC-3) otro_con_texto_vacio_submit_deshabilitado_no_dispara_envio
 * - (EC-4) otro_con_texto_real_dispara_envio_con_reason_text
 * - (EC-5) motivo_distinto_de_otro_submit_habilitado_sin_texto
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { ReportPropertySheet } from '../ReportPropertySheet';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de test
// ─────────────────────────────────────────────────────────────────────────────

const ALL_REASON_LABELS = [
  'No existe / es un fraude',
  'Información engañosa',
  'Precio falso',
  'Dirección incorrecta',
  'Contenido inapropiado',
  'Publicación duplicada',
  'Otro',
];

function make_on_submit() {
  return jest.fn().mockResolvedValue({ ok: true });
}

describe('ReportPropertySheet', () => {

  // ── (EC-1) Los 7 motivos se muestran ──────────────────────────────────────

  it('(EC-1) los_7_motivos_se_muestran: los 7 motivos del enum aparecen como filas radio accesibles', async () => {
    const { queryByLabelText } = await render(
      <ReportPropertySheet
        visible
        on_dismiss={jest.fn()}
        on_submit={make_on_submit()}
        is_submitting={false}
        error_message={null}
      />
    );

    for (const label of ALL_REASON_LABELS) {
      expect(queryByLabelText(label)).not.toBeNull();
    }
  });

  // ── (EC-2) Elegir "Otro" revela el campo de texto ─────────────────────────

  it('(EC-2) elegir_otro_revela_campo_de_texto: seleccionar "Otro" monta el TextInput "Motivo del reporte"; con otro motivo NO existe', async () => {
    const { queryByLabelText } = await render(
      <ReportPropertySheet
        visible
        on_dismiss={jest.fn()}
        on_submit={make_on_submit()}
        is_submitting={false}
        error_message={null}
      />
    );

    // Sin selección: el campo de texto no existe.
    expect(queryByLabelText('Motivo del reporte')).toBeNull();

    await fireEvent.press(queryByLabelText('Otro')!);

    expect(queryByLabelText('Motivo del reporte')).not.toBeNull();
  });

  // ── (EC-3) "Otro" con texto vacío → submit deshabilitado, no dispara envío ─

  it('(EC-3) otro_con_texto_vacio_submit_deshabilitado_no_dispara_envio: "Otro" sin escribir texto → botón "Enviar reporte" deshabilitado y el press NO llama on_submit', async () => {
    const on_submit = make_on_submit();

    const { queryByLabelText } = await render(
      <ReportPropertySheet
        visible
        on_dismiss={jest.fn()}
        on_submit={on_submit}
        is_submitting={false}
        error_message={null}
      />
    );

    await fireEvent.press(queryByLabelText('Otro')!);

    const submit_btn = queryByLabelText('Enviar reporte');
    expect(submit_btn).not.toBeNull();
    expect(submit_btn!.props.accessibilityState?.disabled).toBe(true);

    await fireEvent.press(submit_btn!);

    expect(on_submit).not.toHaveBeenCalled();
  });

  // ── (EC-4) "Otro" con texto real → dispara envío con reason_text ──────────

  it('(EC-4) otro_con_texto_real_dispara_envio_con_reason_text: "Otro" + texto real → press en "Enviar reporte" llama on_submit con reason "other" y el texto', async () => {
    const on_submit = make_on_submit();

    const { queryByLabelText } = await render(
      <ReportPropertySheet
        visible
        on_dismiss={jest.fn()}
        on_submit={on_submit}
        is_submitting={false}
        error_message={null}
      />
    );

    await fireEvent.press(queryByLabelText('Otro')!);
    await fireEvent.changeText(queryByLabelText('Motivo del reporte')!, 'El anuncio ya no existe');

    const submit_btn = queryByLabelText('Enviar reporte');
    expect(submit_btn!.props.accessibilityState?.disabled).not.toBe(true);

    await fireEvent.press(submit_btn!);

    expect(on_submit).toHaveBeenCalledTimes(1);
    expect(on_submit).toHaveBeenCalledWith({
      reason: 'other',
      reason_text: 'El anuncio ya no existe',
    });
  });

  // ── (EC-5) Motivo distinto de "Otro" → submit habilitado sin texto ────────

  it('(EC-5) motivo_distinto_de_otro_submit_habilitado_sin_texto: motivo "Precio falso" sin texto → botón "Enviar reporte" habilitado y el press llama on_submit sin reason_text', async () => {
    const on_submit = make_on_submit();

    const { queryByLabelText } = await render(
      <ReportPropertySheet
        visible
        on_dismiss={jest.fn()}
        on_submit={on_submit}
        is_submitting={false}
        error_message={null}
      />
    );

    await fireEvent.press(queryByLabelText('Precio falso')!);

    const submit_btn = queryByLabelText('Enviar reporte');
    expect(submit_btn!.props.accessibilityState?.disabled).not.toBe(true);

    await fireEvent.press(submit_btn!);

    expect(on_submit).toHaveBeenCalledTimes(1);
    expect(on_submit).toHaveBeenCalledWith({ reason: 'false_price' });
  });

});
