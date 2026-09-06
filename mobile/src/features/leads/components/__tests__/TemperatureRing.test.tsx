/**
 * Tests — TemperatureRing (#267.5).
 * Archivo SUT: mobile/src/features/leads/components/TemperatureRing.tsx
 *
 * Invariante bajo prueba: el `Circle` de progreso (testID="ring-progress")
 * usa SIEMPRE el color de `temperature_color(t)` — snapshot en 0/50/100.
 *
 * `Animated.timing` se mockea para que el offset final sea determinista: sin
 * mock, la animación corre en un timer real y el test dispara un warning de
 * "act()" porque el estado sigue actualizándose después de la aserción (el
 * color en sí NO depende de la animación — es una prop derivada directa de
 * `temperature`, ver SUT — pero el mock deja el componente quieto para el
 * snapshot).
 *
 * react-native-svg empaqueta `stroke` como { type, payload:number ARGB } en
 * vez de dejar el string hex — se compara contra el mismo empaquetado, no
 * contra el string.
 *
 * NOTA RNTL v14: render() retorna Promise → await render(...).
 */
import React from 'react';
import { Animated, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { TemperatureRing } from '../TemperatureRing';
import { temperature_color } from '../../utils/crm_temperature_format';

/** hex '#RRGGBB' → entero ARGB (alpha FF) — mismo empaquetado que react-native-svg. */
function pack_color(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return ((0xff << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

// Determinismo: el offset final salta directo al valor objetivo, sin timer.
jest.spyOn(Animated, 'timing').mockImplementation(((value: Animated.Value, config: { toValue: number }) => ({
  start: (cb?: (result: { finished: boolean }) => void) => {
    value.setValue(config.toValue);
    cb?.({ finished: true });
  },
  stop: () => {},
  reset: () => {},
})) as unknown as typeof Animated.timing);

describe('TemperatureRing', () => {
  it.each([0, 50, 100])('(EC-%#) temperatura=%i → stroke del progreso = temperature_color(t), snapshot', async (t) => {
    const { getByTestId, toJSON } = await render(<TemperatureRing temperature={t} />);

    const circle = getByTestId('ring-progress');
    expect(circle.props.stroke).toEqual({ type: 0, payload: pack_color(temperature_color(t)) });
    expect(toJSON()).toMatchSnapshot();
  });

  it('(EC-4) children (iniciales) se renderizan superpuestas al anillo', async () => {
    const { getByText } = await render(
      <TemperatureRing temperature={70}>
        <Text>KN</Text>
      </TemperatureRing>,
    );

    expect(getByText('KN')).toBeTruthy();
  });
});
