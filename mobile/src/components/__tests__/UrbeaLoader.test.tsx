/**
 * UrbeaLoader / RefreshingChip — render bajo los mocks de reanimated y svg
 * (#243.1). No crítica: garantiza que el drop-in de ActivityIndicator monta en
 * Jest (vive dentro de decenas de pantallas con suite) y que los testIDs pasan.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { RefreshingChip } from '../RefreshingChip';
import { UrbeaLoader, resolve_loader_size, stroke_width_for } from '../UrbeaLoader';

describe('UrbeaLoader', () => {
  it('monta con testID y rol progressbar (API drop-in de ActivityIndicator)', async () => {
    const { getByTestId } = await render(<UrbeaLoader testID="loading-indicator" size="large" />);
    const node = getByTestId('loading-indicator');
    expect(node.props.accessibilityRole).toBe('progressbar');
    expect(node.props.accessibilityLabel).toBe('Cargando');
  });

  it('small=20 · large=36 · número tal cual', () => {
    expect(resolve_loader_size('small')).toBe(20);
    expect(resolve_loader_size('large')).toBe(36);
    expect(resolve_loader_size(48)).toBe(48);
  });

  it('el trazo engorda al achicarse', () => {
    expect(stroke_width_for(48)).toBe(2.4);
    expect(stroke_width_for(36)).toBe(3.2);
    expect(stroke_width_for(20)).toBe(4);
  });

  it('(#244.3) el contenedor NO fija width/height: un estilo de llenado centra el trazo', async () => {
    // Varias pantallas le pasan StyleSheet.absoluteFill (o top/left/right/bottom
    // en 0) porque el ActivityIndicator que reemplazó se estiraba y centraba su
    // spinner. Con width/height fijos el loader se colapsaba a la esquina
    // superior izquierda — encima del reloj en el feed (smoke Android).
    const { getByTestId } = await render(
      <UrbeaLoader testID="fill-loader" size="large" style={StyleSheet.absoluteFill} />,
    );
    const flat = StyleSheet.flatten(getByTestId('fill-loader').props.style);
    expect(flat.width).toBeUndefined();
    expect(flat.height).toBeUndefined();
    expect(flat.alignItems).toBe('center');
    expect(flat.justifyContent).toBe('center');
    // El estilo del llamador sobrevive intacto.
    expect(flat.position).toBe('absolute');
    expect(flat.left).toBe(0);
  });

  it('renderiza la puerta a ≥20 px y la omite a 16 px', async () => {
    const big = await render(<UrbeaLoader size={24} />);
    expect(big.queryByTestId('urbea-loader-door')).toBeTruthy();
    const tiny = await render(<UrbeaLoader size={16} />);
    expect(tiny.queryByTestId('urbea-loader-door')).toBeNull();
  });
});

describe('RefreshingChip', () => {
  it('visible → muestra «Actualizando» con el loader', async () => {
    const { getByText, getByTestId } = await render(<RefreshingChip visible tone="dark" top={80} />);
    expect(getByText('Actualizando')).toBeTruthy();
    expect(getByTestId('refreshing-chip')).toBeTruthy();
  });

  it('no visible → no renderiza nada', async () => {
    const { queryByTestId } = await render(<RefreshingChip visible={false} />);
    expect(queryByTestId('refreshing-chip')).toBeNull();
  });
});
