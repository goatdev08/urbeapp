/**
 * FeedSectionTabs — fila de tabs deslizable horizontal sobre el feed oscuro
 * (#241.2, 5-tabs en #296.2).
 *
 * Mini-spec de diseño (CLAUDE.md §8). Preview aprobado por Abraham 2026-09-14
 * (exploración 050, `preview/chrome.html`, variante B = pill).
 *   - Layout: ScrollView horizontal (NO FlatList — pocas tabs, sin necesidad
 *     de virtualización; render inline, precedente dead zone Android #231
 *     [[android_overlay_scrollview_dead_zone]]), position 'absolute' desde
 *     `left: s_16 + 40(botón filtros) + s_8` hasta `right: 0` — ya NO
 *     centrada: arranca justo después del botón de filtros (ahora a la
 *     izquierda) y usa el ancho restante. Solo tap; sin swipe de páginas, sin
 *     indicador animado. El padre inyecta `top` (safe area) vía `style`.
 *   - Sin fade con máscara en el borde derecho: no hay librería de mask
 *     instalada para RN (MaskedView no forma parte del árbol de dependencias
 *     actual) — techo conocido, ver comentario `ponytail` en `content` más
 *     abajo. `paddingRight: s_24` en su lugar, para que la última tab no
 *     quede pegada al borde.
 *   - Genérico: recibe `tabs`/`value`/`on_change` tipados contra cualquier
 *     union de string (hoy `FeedSection` de 2 valores; 296.3 conecta las 5
 *     tabs del store nuevo sin tocar este componente).
 *   - Activa: PILL Salvia (colors.primary, el verde Urbea) con texto
 *     on_primary sans_bold — pedido de Abraham en el smoke iOS 2026-09-03 (el
 *     subrayado de 3px no se distinguía; reconfirmado en el preview 050,
 *     variante A descartada por el mismo motivo). Inactiva: blanco al 72 %
 *     (como TikTok — el gray_1 cálido se ensuciaba sobre el video),
 *     sans_semibold, sin fondo. Sombra de texto + scrim del padre para
 *     leerse sobre cielo/pared clara.
 *   - Área táctil: la pill (paddingVertical 5 / paddingHorizontal s_12) +
 *     hitSlop 8 → 46 pt de alto tocable. Gap s_8 entre tabs. Altura total 30
 *     (FEED_SECTION_TABS_HEIGHT).
 *   - #248: la pill se encogió un punto de escala (17/22 → 15/20, padding
 *     horizontal s_16 → s_12) porque el badge legal «Patrocinado» de
 *     AdFeedItem, entonces anclado arriba-izquierda, rozaba la tab de la
 *     izquierda en un anuncio. Desde 296.2 el badge vive a la derecha, una
 *     fila abajo (banda de RefreshingChip/ZoneActiveChip) — ya no colisiona
 *     con las tabs, pero se conserva el tamaño: encogerlo resolvió el
 *     problema sin costo de contraste ni área táctil (≥ 44 pt), y no hay
 *     motivo para revertirlo.
 *   - Altura total conocida (FEED_SECTION_TABS_HEIGHT) para que lo que cuelga
 *     debajo (RefreshingChip, ZoneActiveChip, y desde 296.2 también el badge
 *     legal) se posicione sin medir. `feed_top_row_y` centraliza la fórmula
 *     de `top` de toda la banda superior (antes solo vivía en FeedScreen.tsx)
 *     para que AdFeedItem la reuse al posicionar el badge.
 *
 * Presentacional puro: recibe la lista de tabs, el valor activo y el
 * callback; la verdad vive en el store del dominio que la use (feedSection.ts
 * hoy, el store de 296.3 después).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { colors, fonts, spacing } from '@/theme/theme';

/** Alto de la pill (padding 5+5 + línea 20) — para posicionar lo que cuelga debajo y centrar el botón de filtros. */
export const FEED_SECTION_TABS_HEIGHT = 30;

/**
 * Coordenada `top` compartida por toda la banda superior del feed (tabs,
 * botón de filtros, y desde 296.2 el badge legal de AdFeedItem un renglón
 * abajo). #242.1: pegado al borde superior. En iOS con notch/Dynamic Island
 * el inset (44–62) trae ~10 pt de aire extra debajo del hardware → restamos 6
 * y la pill queda a ~5 pt de la isla sin tocarla (smoke iPhone 17,
 * 2026-09-03). Con status bar clásica (iOS sin notch = 20, Android
 * edge-to-edge = alto exacto de la barra) NO hay aire: la hora/wifi viven
 * dentro del inset, así que ahí sumamos s_4.
 */
export function feed_top_row_y(top_inset: number): number {
  return top_inset > 40 ? top_inset - 6 : top_inset + spacing.s_4;
}

/** Ancho del botón de filtros (FeedScreen.tsx `filter_btn`) — fija el `left` de la fila. */
const FILTER_BTN_WIDTH = 40;

/**
 * hitSlop de cada tab. Con la pill de 30, 8 pt arriba y abajo dan 46 pt de área
 * táctil — por encima del mínimo de 44 pt aunque la pill encoja (#248).
 */
const TAB_HIT_SLOP = 8;

export interface FeedSectionTab<T extends string> {
  value: T;
  label: string;
}

interface FeedSectionTabsProps<T extends string> {
  tabs: readonly FeedSectionTab<T>[];
  value: T;
  on_change: (value: T) => void;
  /** El padre inyecta `top` (safe area). */
  style?: StyleProp<ViewStyle>;
}

export function FeedSectionTabs<T extends string>({ tabs, value, on_change, style }: FeedSectionTabsProps<T>) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      nestedScrollEnabled
      style={[styles.row, style]}
      contentContainerStyle={styles.content}
      accessibilityRole="tablist"
      testID="feed-section-tabs-scroll"
    >
      {tabs.map((tab) => {
        const is_active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => on_change(tab.value)}
            hitSlop={TAB_HIT_SLOP}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    left: spacing.s_16 + FILTER_BTN_WIDTH + spacing.s_8,
    right: 0,
    height: FEED_SECTION_TABS_HEIGHT,
    zIndex: 10,
  },
  // ponytail: sin mask-image de desvanecido en el borde derecho (el preview
  // 050 lo sugiere, pero no hay librería de mask instalada en RN) — solo aire
  // extra tras la última tab. Techo conocido; si se pide el fade, entra
  // @react-native-masked-view/masked-view.
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    paddingRight: spacing.s_24,
  },
  tab: {
    paddingVertical: 5, // ponytail: 30 de alto total; no hay token s_5 y no vale crearlo por un solo uso
    paddingHorizontal: spacing.s_12,
    borderRadius: FEED_SECTION_TABS_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tab_active: {
    backgroundColor: colors.primary,
  },
  label: {
    fontSize: 15,
    lineHeight: 20,
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
