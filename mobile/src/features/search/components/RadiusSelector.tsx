/**
 * RadiusSelector.tsx — Selector de radio de búsqueda (#42.1, approach A1).
 *
 * Segmented control de pills: 5 km / 10 km / 20 km / 50 km (metros).
 * Single-select — siempre hay un valor activo (no existe "sin filtro" acá;
 * default 5000 m viene de EMPTY_FILTERS).
 *
 * Mapea a `FilterState.radius_m`, parámetro exclusivo de la RPC
 * `properties_within_radius`; NUNCA viaja por build_filter_query (invariante A1).
 *
 * Visual: mismo patrón que BedroomsSelector (pill row, tokens de theme.ts) —
 * ponytail: presets fijos en vez de slider/input custom; radio arbitrario
 * queda para una tarea futura si el producto lo pide.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Opciones del selector (metros)
// ─────────────────────────────────────────────────────────────────────────────

const RADIUS_OPTIONS: { label: string; value: number }[] = [
  { label: '5 km', value: 5000 },
  { label: '10 km', value: 10000 },
  { label: '20 km', value: 20000 },
  { label: '50 km', value: 50000 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface RadiusSelectorProps {
  /** Valor actual en metros (FilterContext.filters.radius_m). */
  value: number;
  /** Callback al seleccionar un preset (siempre en metros). */
  onChange: (v: number) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function RadiusSelector({ value, onChange }: RadiusSelectorProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      {RADIUS_OPTIONS.map((opt) => {
        const is_active = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[styles.pill, is_active ? styles.pill_active : styles.pill_inactive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: is_active }}
            accessibilityLabel={`Radio de búsqueda: ${opt.label}`}
          >
            <Text
              style={[
                styles.label,
                is_active ? styles.label_active : styles.label_inactive,
              ]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos — modo gestión-claro, idénticos a BedroomsSelector
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s_8,
  },
  pill: {
    borderRadius: radii.r_pill,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_8,
  },
  pill_active: {
    backgroundColor: colors.primary_tint,
  },
  pill_inactive: {
    backgroundColor: colors.paper_2,
  },
  label: {
    fontFamily: fonts.sans_semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.6,
    textTransform: 'uppercase' as const,
  },
  label_active: {
    color: colors.primary,
  },
  label_inactive: {
    color: colors.gray_2,
  },
});
