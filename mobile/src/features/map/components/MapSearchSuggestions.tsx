/**
 * MapSearchSuggestions.tsx — dropdown de sugerencias bajo MapSearchBar (#157.8).
 *
 * Mini-spec (CLAUDE.md §8 — UI nueva sin mockup canónico; techo = tokens de
 * theme.ts, cero tokens nuevos): card clara anclada bajo la barra de búsqueda
 * (el padre inyecta `top`), patrón visual de ZoneAutocomplete (filas con borde
 * hairline) sobre colors.surface + borde rgba(227,220,207,0.60) — el mismo
 * borde glass de MapSearchBar/ZoneActiveChip.
 *
 * Cada fila: ícono por tipo (MapPin = colonia · Buildings = municipio) +
 * nombre + contexto ("Guadalajara, Jal." / "Jalisco") en gray_2.
 *
 * keyboardShouldPersistTaps="handled": el tap en una sugerencia selecciona a
 * la PRIMERA (sin ese prop, el primer tap solo cierra el teclado).
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Buildings, MapPin } from 'phosphor-react-native';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import type { PlaceSuggestion } from '../lib/placeSearch';

interface MapSearchSuggestionsProps {
  suggestions: PlaceSuggestion[];
  on_select: (suggestion: PlaceSuggestion) => void;
  /** Offset superior (bajo MapSearchBar) — lo calcula MapScreen. */
  top: number;
}

export function MapSearchSuggestions({
  suggestions,
  on_select,
  top,
}: MapSearchSuggestionsProps): React.JSX.Element | null {
  if (suggestions.length === 0) return null;

  return (
    <View style={[styles.container, { top }]} pointerEvents="box-none">
      <ScrollView
        style={styles.dropdown}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {suggestions.map((s, index) => (
          <TouchableOpacity
            key={`${s.kind}-${s.id}`}
            style={[styles.row, index !== suggestions.length - 1 && styles.row_border]}
            onPress={() => on_select(s)}
            accessibilityRole="button"
            accessibilityLabel={`Buscar ${s.name}, ${s.context}`}
          >
            {s.kind === 'neighborhood' ? (
              <MapPin size={18} weight="fill" color={colors.primary} />
            ) : (
              <Buildings size={18} weight="fill" color={colors.accent} />
            )}
            <View style={styles.texts}>
              <Text style={styles.name} numberOfLines={1}>
                {s.name}
              </Text>
              <Text style={styles.context} numberOfLines={1}>
                {s.context}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.s_16,
    right: spacing.s_16,
  },
  dropdown: {
    maxHeight: 320,
    borderRadius: radii.r_16,
    borderWidth: 1,
    borderColor: 'rgba(227, 220, 207, 0.60)',
    backgroundColor: colors.surface,
    ...shadows.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_12,
  },
  row_border: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.paper_3,
  },
  texts: {
    flex: 1,
  },
  name: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  context: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.gray_2,
  },
});
