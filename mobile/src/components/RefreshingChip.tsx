/**
 * RefreshingChip — indicador propio del pull-to-refresh (#243.2).
 *
 * El RefreshControl nativo se queda como GESTO (transparente) y este chip
 * «Actualizando» con el UrbeaLoader es lo que la persona ve mientras
 * `refreshing` es true — igual en iOS y Android. Nació porque el spinner
 * nativo del feed (gray_1) quedaba invisible bajo el scrim y los tabs.
 *
 * Dos modos de colocación:
 *   - `top` definido → absoluto, centrado, a esa coordenada (feed: debajo de
 *     los tabs de sección; ítems de pantalla completa, no hay flujo).
 *   - sin `top` → en flujo (para meterlo en un ListHeaderComponent: Guardados,
 *     CRM), centrado con margen vertical s_8.
 *
 * `tone` sigue la superficie: 'dark' sobre el feed, 'light' sobre gestión.
 * Sin toque (pointerEvents none). Renderiza null cuando no está visible.
 *
 * ponytail: sin animación de entrada/salida — aparece y desaparece con el
 * estado; si se pide, Reanimated ya está.
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { colors, fonts, spacing } from '@/theme/theme';

export const REFRESHING_CHIP_HEIGHT = 32;

export interface RefreshingChipProps {
  visible: boolean;
  tone?: 'dark' | 'light';
  /** Coordenada superior → modo absoluto. Sin ella, en flujo. */
  top?: number;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

export function RefreshingChip({
  visible,
  tone = 'light',
  top,
  label = 'Actualizando',
  style,
}: RefreshingChipProps) {
  if (!visible) return null;
  const is_dark = tone === 'dark';
  return (
    <View
      style={[
        styles.chip,
        is_dark ? styles.chip_dark : styles.chip_light,
        top != null ? [styles.absolute, { top }] : styles.in_flow,
        style,
      ]}
      pointerEvents="none"
      testID="refreshing-chip"
      accessibilityLiveRegion="polite"
    >
      <UrbeaLoader
        size={18}
        color={is_dark ? colors.primary_soft : colors.primary}
        accessibilityLabel={label}
      />
      <Text style={[styles.label, is_dark ? styles.label_dark : styles.label_light]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    height: REFRESHING_CHIP_HEIGHT,
    paddingLeft: spacing.s_8,
    paddingRight: spacing.s_12,
    borderRadius: REFRESHING_CHIP_HEIGHT / 2,
    alignSelf: 'center',
  },
  chip_dark: {
    backgroundColor: 'rgba(23,20,15,0.62)', // colors.ink_feed @ 0.62
  },
  chip_light: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.primary_tint,
  },
  absolute: {
    position: 'absolute',
    zIndex: 10,
  },
  in_flow: {
    marginVertical: spacing.s_8,
  },
  label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 13,
    lineHeight: 16,
  },
  label_dark: {
    color: '#F1EBE2',
  },
  label_light: {
    color: colors.ink,
  },
});
