/**
 * Tests — UnmanagedLeadRow (subtarea 269.6).
 * Archivo SUT: mobile/src/features/leads/components/UnmanagedLeadRow.tsx
 *
 * Reloj fijo (memoria tests_bomba_de_fecha_y_estado_inicial): format_relative_time usa Date.now().
 *
 * Casos:
 * (EC-1) pinta nombre, "ENTRÓ hace X" y grados.
 * (EC-2) first_contact_at null → sin línea "ENTRÓ".
 * (EC-3) tap en ASIGNAR llama onPressAssign (no en cualquier punto de la fila).
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { UnmanagedLeadRow } from '../UnmanagedLeadRow';
import type { UnmanagedLeadRow as UnmanagedLeadRowData } from '../../types';

function make_row(overrides: Partial<UnmanagedLeadRowData> = {}): UnmanagedLeadRowData {
  return {
    lead_id: 'lead-1',
    lead_display_name: 'Diego Martínez',
    temperature: 91,
    first_contact_at: '2026-09-06T11:42:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('UnmanagedLeadRow', () => {
  it('(EC-1) pinta nombre, "ENTRÓ hace X" y grados', async () => {
    await render(<UnmanagedLeadRow row={make_row()} onPressAssign={jest.fn()} />);

    expect(screen.getByText('Diego Martínez')).toBeTruthy();
    expect(screen.getByText('ENTRÓ hace 18 min')).toBeTruthy();
    expect(screen.getByText('91°')).toBeTruthy();
    expect(screen.getByText('ASIGNAR')).toBeTruthy();
  });

  it('(EC-2) first_contact_at null → sin línea "ENTRÓ"', async () => {
    await render(<UnmanagedLeadRow row={make_row({ first_contact_at: null })} onPressAssign={jest.fn()} />);

    expect(screen.queryByText(/ENTRÓ/)).toBeNull();
  });

  it('(EC-3) tap en ASIGNAR llama onPressAssign', async () => {
    const on_assign = jest.fn();
    await render(<UnmanagedLeadRow row={make_row()} onPressAssign={on_assign} />);

    fireEvent.press(screen.getByText('ASIGNAR'));

    expect(on_assign).toHaveBeenCalledTimes(1);
  });
});
