/**
 * AreaSearchPill.tsx — Pill flotante "Buscar en esta zona" (#56.4).
 *
 * Mini-spec de diseño (CLAUDE.md §8 — UI nueva, ausente del mockup canónico
 * `urbea-identidad-visual.html`; techo = tokens existentes, ningún token nuevo):
 *   - Posición: absolute, bottom-center (alignSelf: 'center').
 *     Bottom base = spacing.s_24 (mismo nivel que PropertyMiniCard).
 *     Cuando `lifted` (mini-card visible), sube por encima de ella:
 *     spacing.s_24 (bottom de la mini-card)
 *       + spacing.s_32*2 (thumb 64px de la mini-card = 2×s_32)
 *       + spacing.s_12*2 (padding vertical de la fila de la mini-card)
 *       + spacing.s_16 (gap visual entre pill y mini-card)
 *   - Fondo: colors.primary · Texto: colors.on_primary, type_scale.body +
 *     fonts.sans_semibold (HankenGrotesk_600SemiBold).
 *   - Borde: radii.r_24 (full pill). Sombra: shadows.primary.
 *   - Padding: vertical spacing.s_12, horizontal spacing.s_24.
 *   - Estados: solo se renderiza cuando el padre decide mostrarlo
 *     (show_area_pill); sin estado propio de press más allá de
 *     TouchableOpacity (activeOpacity estándar del resto del mapa).
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';

import { colors, fonts, radii, shadows, spacing, type_scale } from '@/theme/theme';

// Offset del pill sobre la mini-card — ver mini-spec arriba (todo desde spacing.*).
const MINI_CARD_BOTTOM = spacing.s_24;
const MINI_CARD_THUMB_HEIGHT = spacing.s_32 * 2; // 64 — coincide con THUMB_SIZE de PropertyMiniCard
const MINI_CARD_ROW_PADDING = spacing.s_12 * 2;
const PILL_GAP_ABOVE_MINI_CARD = spacing.s_16;

const LIFTED_BOTTOM =
  MINI_CARD_BOTTOM + MINI_CARD_THUMB_HEIGHT + MINI_CARD_ROW_PADDING + PILL_GAP_ABOVE_MINI_CARD;

interface AreaSearchPillProps {
  on_press: () => void;
  /** true cuando la PropertyMiniCard está visible — sube el pill para no encimarse. */
  lifted: boolean;
}

export function AreaSearchPill({ on_press, lifted }: AreaSearchPillProps) {
  return (
    <TouchableOpacity
      style={[styles.container, { bottom: lifted ? LIFTED_BOTTOM : MINI_CARD_BOTTOM }]}
      onPress={on_press}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel="Buscar en esta zona"
    >
      <Text style={styles.label}>Buscar en esta zona</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: colors.primary,
    borderRadius: radii.r_24,
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_24,
    ...shadows.primary,
  },
  label: {
    ...type_scale.body,
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.on_primary,
  },
});
