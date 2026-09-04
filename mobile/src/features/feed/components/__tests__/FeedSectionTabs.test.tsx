/**
 * Tests — FeedSectionTabs (#241.2, ajustado en #248).
 *
 * Por qué existe: #248 encoge la pill para que el badge legal «Patrocinado»
 * de AdFeedItem (anclado arriba-izquierda) deje de rozar la tab izquierda. Un
 * cambio de tamaño se puede pasar de mano en silencio: encoger de más rompe
 * el mínimo de 44 pt de área táctil o la legibilidad sobre el video, y ambos
 * son invisibles para el resto de la suite. Estos casos fijan el techo y el
 * piso de ese ajuste, además del comportamiento de selección.
 */
import React from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';

import { colors } from '@/theme/theme';

import { FeedSectionTabs, FEED_SECTION_TABS_HEIGHT } from '../FeedSectionTabs';

/** Mínimo de área táctil (HIG / Material). */
const MIN_TOUCH_TARGET = 44;

function flat_view(style: unknown): ViewStyle {
  return (StyleSheet.flatten(style as ViewStyle) ?? {}) as ViewStyle;
}

function flat_text(style: unknown): TextStyle {
  return (StyleSheet.flatten(style as TextStyle) ?? {}) as TextStyle;
}

describe('FeedSectionTabs — selección', () => {
  it('(EC-T1) pinta las dos secciones y marca como seleccionada SOLO la activa', async () => {
    const r = await render(<FeedSectionTabs section="sale" on_change={jest.fn()} />);

    expect(r.getByText('Venta')).toBeTruthy();
    expect(r.getByText('Renta')).toBeTruthy();
    expect(r.getByTestId('feed-section-sale').props.accessibilityState.selected).toBe(true);
    expect(r.getByTestId('feed-section-rent').props.accessibilityState.selected).toBe(false);
  });

  it('(EC-T2) tocar la sección inactiva llama on_change con SU valor', async () => {
    const on_change = jest.fn();
    const r = await render(<FeedSectionTabs section="sale" on_change={on_change} />);

    fireEvent.press(r.getByTestId('feed-section-rent'));

    expect(on_change).toHaveBeenCalledTimes(1);
    expect(on_change).toHaveBeenCalledWith('rent');
  });
});

describe('FeedSectionTabs — #248: la pill encogió sin perder contraste ni área táctil', () => {
  it('(EC-T3) 🔴 la pill + su hitSlop siguen dando al menos 44 pt de alto tocable', async () => {
    const r = await render(<FeedSectionTabs section="sale" on_change={jest.fn()} />);
    const tab = r.getByTestId('feed-section-sale');

    // hitSlop numérico: se aplica a los cuatro lados.
    const hit_slop = tab.props.hitSlop as number;
    expect(typeof hit_slop).toBe('number');
    expect(FEED_SECTION_TABS_HEIGHT + hit_slop * 2).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('(EC-T4) la pill mide 30 (menos que los 34 de #241.2) y el label no baja de 15 — encoger de más la volvería ilegible sobre el video', async () => {
    const r = await render(<FeedSectionTabs section="sale" on_change={jest.fn()} />);

    expect(FEED_SECTION_TABS_HEIGHT).toBe(30);
    expect(flat_text(r.getByText('Venta').props.style).fontSize).toBe(15);
  });

  it('(EC-T5) 🔴 el contraste se conserva: la activa mantiene la pill salvia con texto on_primary', async () => {
    const r = await render(<FeedSectionTabs section="sale" on_change={jest.fn()} />);

    expect(flat_view(r.getByTestId('feed-section-sale').props.style).backgroundColor).toBe(
      colors.primary,
    );
    expect(flat_text(r.getByText('Venta').props.style).color).toBe(colors.on_primary);
  });

  it('(EC-T6) 🔴 la inactiva conserva el blanco al 72 % y la sombra que la hace legible sobre un fotograma claro', async () => {
    const r = await render(<FeedSectionTabs section="sale" on_change={jest.fn()} />);
    const label = flat_text(r.getByText('Renta').props.style);

    expect(label.color).toBe('rgba(255,255,255,0.72)');
    expect(label.textShadowColor).toBe('rgba(0,0,0,0.6)');
    expect(label.textShadowRadius).toBe(4);
    // Sin fondo: es texto sobre el video, no una segunda pill.
    expect(flat_view(r.getByTestId('feed-section-rent').props.style).backgroundColor).toBeUndefined();
  });
});
