/**
 * Tests — RadarAnonRow (#267.5).
 * Archivo SUT: mobile/src/features/leads/components/RadarAnonRow.tsx
 *
 * 🔒 Invariante de privacidad (exploración 045 §7.5, decisión R2): esta fila
 * NUNCA porta identidad ni contacto. Se verifica:
 *   - Sin botón (`queryByRole('button')` → null, la fila no es Pressable).
 *   - Sin `Image` (sin avatar real — el slot es un ícono neutro).
 *   - El árbol de <Text> es EXACTAMENTE la lista permitida: microcopy,
 *     tiempo relativo, property_label, grados y delta — nada de nombre ni
 *     iniciales. `signals` en cero para no meter el contador de SignalIcons
 *     en la lista (ver comentario ahí: solo aparece si video_count>0).
 *
 * Reloj fijo (jest.useFakeTimers + setSystemTime) — format_relative_time usa
 * Date.now().
 *
 * NOTA RNTL v14: render() retorna Promise → await render(...).
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { RadarAnonRow } from '../RadarAnonRow';
import type { CrmRadarRow } from '../../types';

const ROW: CrmRadarRow = {
  row_n: 1,
  property_label: 'Depa en Colinas de San Javier, Zapopan',
  temperature: 68,
  delta: 9,
  sparkline: new Array(14).fill(0.3),
  signals: { views: 0, completed: false, saved: false, liked: false },
  last_activity_at: '2026-09-06T11:20:00.000Z',
};

beforeEach(() => {
  jest.useFakeTimers().setSystemTime(new Date('2026-09-06T12:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('RadarAnonRow', () => {
  it('(EC-1) 🔒 sin botón, sin Image, sin nombre/iniciales — solo los 5 textos permitidos', async () => {
    const { queryByRole, container, getByText, getByTestId } = await render(<RadarAnonRow row={ROW} />);

    // No es una acción tocable: la fila anónima no navega ni contacta.
    expect(queryByRole('button')).toBeNull();

    // Sin avatar real (Image) — el slot es un ícono neutro (Eye).
    expect(container.queryAll((i) => i.type === 'Image')).toHaveLength(0);

    // testID de anclaje del invariante (usado también por el screen 267.6/267.7).
    expect(getByTestId('radar-anon-row')).toBeTruthy();

    // Lista EXACTA de textos — nada de nombre/iniciales.
    const texts = container
      .queryAll((i) => i.type === 'Text')
      .map((i) => i.children.join(''));
    expect(texts.sort()).toEqual(
      [
        'Alguien está mirando',
        'hace 40 min',
        'Depa en Colinas de San Javier, Zapopan',
        '68°',
        '+9 en 3 d',
      ].sort(),
    );

    // Sanity de cada texto por separado (mensaje de fallo más claro que el array).
    expect(getByText('Alguien está mirando')).toBeTruthy();
    expect(getByText('hace 40 min')).toBeTruthy();
    expect(getByText(ROW.property_label)).toBeTruthy();
    expect(getByText('68°')).toBeTruthy();
    expect(getByText('+9 en 3 d')).toBeTruthy();
  });
});
