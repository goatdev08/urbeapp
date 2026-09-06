/**
 * Tests — StatusPicker (subtarea 267.6): extracción pura de LeadExpandedView
 * (#117). Mínimo: lista los 8 vigentes, onSelect con el estado tocado,
 * readOnly sin botón. El contrato de accesibilidad/disparador ya está
 * cubierto extensamente en LeadExpandedView.test.tsx contra el mismo código
 * (antes de extraerse) — este archivo no repite esos casos.
 */
import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';

import { StatusPicker } from '../StatusPicker';
import { ALL_LEAD_STATUSES, get_status_meta } from '../../lead_status_meta';

describe('StatusPicker', () => {
  it('open=true lista los 8 estados vigentes', async () => {
    await render(
      <StatusPicker current="whatsapp_opened" open onToggle={jest.fn()} onSelect={jest.fn()} />,
    );

    for (const s of ALL_LEAD_STATUSES) {
      expect(screen.getAllByText(get_status_meta(s).label).length).toBeGreaterThan(0);
    }
  });

  it('tocar una opción llama onSelect con el estado tocado', async () => {
    const on_select = jest.fn();
    const otro = ALL_LEAD_STATUSES.find((s) => s !== 'whatsapp_opened')!;
    const otro_label = get_status_meta(otro).label;
    const user = userEvent.setup();

    await render(
      <StatusPicker current="whatsapp_opened" open onToggle={jest.fn()} onSelect={on_select} />,
    );
    await user.press(screen.getByLabelText(new RegExp(`^Estado: ${otro_label}$`, 'i')));

    expect(on_select).toHaveBeenCalledWith(otro);
  });

  it('readOnly: sin botón disparador ni opciones montadas', async () => {
    await render(
      <StatusPicker current="whatsapp_opened" open onToggle={jest.fn()} onSelect={jest.fn()} readOnly />,
    );

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryAllByRole('radio').length).toBe(0);
  });

  it('current null: el badge pinta la etiqueta proyectada y ningún ítem lleva ✓', async () => {
    const { queryByText, getByLabelText, getAllByRole } = await render(
      <StatusPicker current={null} current_label="Contactado" open onToggle={jest.fn()} onSelect={jest.fn()} />,
    );
    // El badge del disparador muestra la proyección, no un estado adivinado.
    expect(getByLabelText(/^Estado actual: Contactado\./)).toBeTruthy();
    expect(queryByText('✓')).toBeNull();
    for (const radio of getAllByRole('radio')) {
      expect(radio.props.accessibilityState.checked).toBe(false);
    }
  });
});
