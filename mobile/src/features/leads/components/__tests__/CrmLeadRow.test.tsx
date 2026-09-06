/**
 * Tests — CrmLeadRow (#267.5).
 * Archivo SUT: mobile/src/features/leads/components/CrmLeadRow.tsx
 *
 * Mínimo pedido por la subtarea: nombre, grados "94°", delta "+22 en 3 d",
 * iniciales, `onPress` dispara, `accessibilityState.expanded` refleja la
 * prop. Reloj fijo (format_relative_time usa Date.now()).
 *
 * NOTA RNTL v14: render() retorna Promise → await render(...).
 */
import React from 'react';
import { render, screen, userEvent } from '@testing-library/react-native';

import { CrmLeadRow } from '../CrmLeadRow';
import type { CrmLeadRow as CrmLeadRowData } from '../../types';

const ROW: CrmLeadRowData = {
  lead_id: 'lead-1',
  user_id: 'user-1',
  full_name: 'Karla Núñez',
  avatar_url: null,
  temperature: 94,
  delta: 22,
  band: 'hot',
  signals: { video_completed: 0, video_views: 4, likes: 0, saves: 1 },
  sparkline: new Array(14).fill(0.5),
  last_activity_at: '2026-09-06T11:48:00.000Z',
  origin_property: {
    property_id: 'prop-1',
    address: 'Bugambilias, Zapopan',
    contacted_at: '2026-09-06T11:42:00.000Z',
  },
  status_projected: 'nuevo',
};

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CrmLeadRow', () => {
  it('(EC-1) renderiza nombre, grados, delta e iniciales', async () => {
    await render(<CrmLeadRow row={ROW} onPress={jest.fn()} />);

    expect(screen.getByText('Karla Núñez')).toBeTruthy();
    expect(screen.getByText('94°')).toBeTruthy();
    expect(screen.getByText('+22 en 3 d')).toBeTruthy();
    expect(screen.getByText('KN')).toBeTruthy();
  });

  it('(EC-2) onPress se dispara al tocar la fila', async () => {
    const on_press = jest.fn();
    await render(<CrmLeadRow row={ROW} onPress={on_press} />);

    const user = userEvent.setup();
    await user.press(screen.getByRole('button'));

    expect(on_press).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, false],
    [false, false],
    [true, true],
  ])('(EC-3) expanded=%s → accessibilityState.expanded=%s', async (expanded, expected) => {
    const props = expanded === undefined ? { row: ROW, onPress: jest.fn() } : { row: ROW, onPress: jest.fn(), expanded };
    await render(<CrmLeadRow {...props} />);

    expect(screen.getByRole('button').props.accessibilityState.expanded).toBe(expected);
  });

  it('(EC-4) full_name=null → iniciales "?" y nombre de respaldo', async () => {
    await render(<CrmLeadRow row={{ ...ROW, full_name: null }} onPress={jest.fn()} />);

    expect(screen.getByText('?')).toBeTruthy();
    expect(screen.getByText('Usuario sin nombre')).toBeTruthy();
  });
});
