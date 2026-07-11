/**
 * ZoneActiveChip.tsx — chip persistente "Zona activa · Quitar" (#56.5).
 *
 * Mini-spec de diseño (CLAUDE.md §8 — UI nueva, ausente del mockup canónico
 * `urbea-identidad-visual.html`; techo = tokens existentes de theme.ts, cero
 * tokens nuevos). Se renderiza en FeedScreen Y MapScreen mientras
 * `filters.area != null` (zona activa desde "Buscar en esta zona", #56.4):
 *   - Forma: pill (radii.r_pill), un solo `TouchableOpacity` presionable —
 *     todo el chip dispara `on_press`, sin sub-botón separado para "Quitar".
 *   - Contenido: ícono `MapPin` (Phosphor, mismo ícono que property-detail /
 *     location) + "Zona activa" + "· Quitar" en semibold para distinguir la
 *     acción. type_scale.body reducido a 14/18 (mismo ajuste que AreaSearchPill).
 *   - Padding: vertical spacing.s_12, horizontal spacing.s_16. Sombra: shadows.sm.
 *   - Layout propio: position 'absolute' + alignSelf 'center' (mismo patrón
 *     que AreaSearchPill.tsx) — el padre solo inyecta `top` vía prop `style`.
 *   - Variante `dark` (feed oscuro, #17140F): fondo rgba(23,20,15,0.60)
 *     (idéntico a `filter_btn` de FeedScreen), texto colors.gray_1, "Quitar"
 *     en colors.primary_soft.
 *   - Variante clara (mapa, default): fondo colors.surface + borde
 *     rgba(227,220,207,0.60) (igual MapSearchBar), texto colors.ink, "Quitar"
 *     en colors.primary.
 *
 * ponytail: un solo componente con prop `dark` en vez de duplicar el chip por
 *   pantalla — el chip es idéntico salvo la paleta clara/oscura.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { MapPin } from 'phosphor-react-native';

import { colors, fonts, radii, shadows, spacing, type_scale } from '@/theme/theme';

interface ZoneActiveChipProps {
  on_press: () => void;
  /** Variante para fondos oscuros (feed inmersivo). Default: false (mapa claro). */
  dark?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function ZoneActiveChip({ on_press, dark = false, style }: ZoneActiveChipProps) {
  return (
    <TouchableOpacity
      style={[styles.container, dark ? styles.container_dark : styles.container_light, style]}
      onPress={on_press}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Zona activa. Quitar filtro de zona"
    >
      <MapPin size={16} weight="fill" color={dark ? colors.primary_soft : colors.primary} />
      <Text style={[styles.label, dark && styles.label_dark]}>
        Zona activa{' '}
        <Text style={[styles.action, dark && styles.action_dark]}>· Quitar</Text>
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_8,
    borderRadius: radii.r_pill,
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    ...shadows.sm,
  },
  container_dark: {
    backgroundColor: 'rgba(23,20,15,0.60)',
  },
  container_light: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(227, 220, 207, 0.60)',
  },
  label: {
    ...type_scale.body,
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.ink,
  },
  label_dark: {
    color: colors.gray_1,
  },
  action: {
    fontFamily: fonts.sans_bold,
    color: colors.primary,
  },
  action_dark: {
    color: colors.primary_soft,
  },
});
