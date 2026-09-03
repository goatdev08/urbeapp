/**
 * FeedSectionTabs — tabs de texto «Venta · Renta» sobre el feed oscuro (#241.2).
 *
 * Mini-spec de diseño (CLAUDE.md §8 — UI ausente del mockup canónico; techo =
 * tokens existentes de theme.ts, cero tokens nuevos). Decisión Abraham
 * 2026-09-02: tabs de texto estilo TikTok, NO píldora segmentada — no tapan el
 * video y se leen sobre cualquier fotograma gracias a la sombra de texto.
 *   - Layout: fila centrada (alignSelf 'center'), position 'absolute'; el
 *     padre inyecta `top` (insets.top + s_12, misma coordenada que el botón de
 *     filtros, que queda a la derecha — no se estorban).
 *   - Activa: on_primary (blanco) con fonts.sans_bold + subrayado de 2px
 *     (primary_soft, el Salvia claro del feed). Inactiva: gray_1, sans_semibold.
 *   - Área táctil: paddingVertical s_8 / paddingHorizontal s_12 + hitSlop;
 *     gap s_24 entre tabs.
 *   - Altura total conocida (FEED_SECTION_TABS_HEIGHT) para que el chip de
 *     zona pueda colgarse debajo sin medir.
 *
 * Presentacional puro: recibe la sección y el callback; la verdad vive en el
 * FilterProvider (lib/feedSection.ts).
 *
 * ponytail: dos Pressable con Text — sin ScrollView (solo hay 2 tabs) ni
 * animación del subrayado (techo conocido; si se pide, Reanimated ya está).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FEED_SECTIONS, type FeedSection } from '@/features/search/lib/feedSection';
import { colors, fonts, spacing } from '@/theme/theme';

/** Alto del bloque (padding 8+8 + línea 22 + subrayado 2 + margen 2) — para posicionar lo que cuelga debajo. */
export const FEED_SECTION_TABS_HEIGHT = 42;

interface FeedSectionTabsProps {
  section: FeedSection;
  on_change: (section: FeedSection) => void;
  /** El padre inyecta `top` (safe area). */
  style?: StyleProp<ViewStyle>;
}

export function FeedSectionTabs({ section, on_change, style }: FeedSectionTabsProps) {
  return (
    <View style={[styles.row, style]} accessibilityRole="tablist">
      {FEED_SECTIONS.map((tab) => {
        const is_active = tab.value === section;
        return (
          <Pressable
            key={tab.value}
            onPress={() => on_change(tab.value)}
            hitSlop={8}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityState={{ selected: is_active }}
            accessibilityLabel={`Sección ${tab.label}`}
            testID={`feed-section-${tab.value}`}
          >
            <Text style={[styles.label, is_active ? styles.label_active : styles.label_inactive]}>
              {tab.label}
            </Text>
            <View style={[styles.underline, is_active && styles.underline_active]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: spacing.s_24,
    height: FEED_SECTION_TABS_HEIGHT,
    zIndex: 10,
  },
  tab: {
    paddingVertical: spacing.s_8,
    paddingHorizontal: spacing.s_12,
    alignItems: 'center',
  },
  label: {
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.2,
    // Legible sobre cualquier fotograma (cielo claro, pared blanca).
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  label_active: {
    color: colors.on_primary,
    fontFamily: fonts.sans_bold,
  },
  label_inactive: {
    color: colors.gray_1,
    fontFamily: fonts.sans_semibold,
  },
  underline: {
    marginTop: 2,
    height: 2,
    width: 20,
    borderRadius: 1,
    backgroundColor: 'transparent',
  },
  underline_active: {
    backgroundColor: colors.primary_soft,
  },
});
