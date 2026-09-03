/**
 * FeedSectionTabs — tabs de texto «Venta · Renta» sobre el feed oscuro (#241.2).
 *
 * Mini-spec de diseño (CLAUDE.md §8 — UI ausente del mockup canónico; techo =
 * tokens existentes de theme.ts, cero tokens nuevos). Decisión Abraham
 * 2026-09-02: tabs de texto estilo TikTok, NO píldora segmentada — no tapan el
 * video y se leen sobre cualquier fotograma gracias a la sombra de texto.
 *   - Layout: fila centrada (alignSelf 'center'), position 'absolute'; el
 *     padre inyecta `top` (insets.top + s_4 — pegado a la status bar / Dynamic
 *     Island sin invadirla; misma coordenada que el botón de filtros, que
 *     queda a la derecha — no se estorban).
 *   - Activa: PILL Salvia (colors.primary, el verde Urbea) con texto on_primary
 *     sans_bold — pedido de Abraham en el smoke iOS 2026-09-03 (el subrayado
 *     de 3px no se distinguía). Inactiva: blanco al 72 % (como TikTok — el
 *     gray_1 cálido se ensuciaba sobre el video), sans_semibold, sin fondo.
 *     Sombra de texto + scrim del padre para leerse sobre cielo/pared clara.
 *   - Área táctil: la pill (paddingVertical 6 / paddingHorizontal s_16) +
 *     hitSlop; gap s_8 entre tabs. Altura total 34 (FEED_SECTION_TABS_HEIGHT).
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

/** Alto de la pill (padding 6+6 + línea 22) — para posicionar lo que cuelga debajo y centrar el botón de filtros. */
export const FEED_SECTION_TABS_HEIGHT = 34;

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
            style={[styles.tab, is_active && styles.tab_active]}
            accessibilityRole="tab"
            accessibilityState={{ selected: is_active }}
            accessibilityLabel={`Sección ${tab.label}`}
            testID={`feed-section-${tab.value}`}
          >
            <Text style={[styles.label, is_active ? styles.label_active : styles.label_inactive]}>
              {tab.label}
            </Text>
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
    gap: spacing.s_8,
    height: FEED_SECTION_TABS_HEIGHT,
    zIndex: 10,
  },
  tab: {
    paddingVertical: 6, // ponytail: 34 de alto total; no hay token s_6 y no vale crearlo por un solo uso
    paddingHorizontal: spacing.s_16,
    borderRadius: FEED_SECTION_TABS_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tab_active: {
    backgroundColor: colors.primary,
  },
  label: {
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: 0.2,
    // Legible sobre cualquier fotograma (cielo claro, pared blanca).
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  label_active: {
    color: colors.on_primary,
    fontFamily: fonts.sans_bold,
    textShadowColor: 'transparent', // sobre la pill sólida no hace falta sombra
  },
  label_inactive: {
    color: 'rgba(255,255,255,0.72)',
    fontFamily: fonts.sans_semibold,
  },
});
