/**
 * BedroomsSelector.tsx — Selector de mínimo de recámaras (#12.5).
 *
 * Segmented control de pills: Cualquiera / 1+ / 2+ / 3+
 * Semántica "mínimo": null = cualquiera (sin filtro), N = bedrooms >= N.
 * Mapea a la columna `properties.bedrooms` (int nullable, migración 0005).
 *
 * Contrato para 12.6 (FilterContext):
 *   value:    number | null  — null sin filtro; 1|2|3 = mínimo de recámaras
 *   onChange: (v: number | null) => void
 *
 * Visual: mismos pill styles que FilterTabs (color, radius, caption).
 * Se usa View row (no ScrollView) porque 4 opciones siempre caben en el
 * ancho del sheet sin scroll.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Opciones del selector
// ─────────────────────────────────────────────────────────────────────────────

const BEDROOM_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Cualquiera', value: null },
  { label: '1+', value: 1 },
  { label: '2+', value: 2 },
  { label: '3+', value: 3 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface BedroomsSelectorProps {
  /**
   * Valor actual del selector.
   * null    = sin filtro ("Cualquiera")
   * 1|2|3   = mínimo de recámaras (consulta: `properties.bedrooms >= value`)
   *
   * Fuente de verdad en 12.6: FilterContext.filters.bedrooms_min
   */
  value: number | null;
  /**
   * Callback al seleccionar una opción.
   * Recibe null (sin filtro) o el mínimo elegido (1, 2 ó 3).
   */
  onChange: (v: number | null) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function BedroomsSelector({
  value,
  onChange,
}: BedroomsSelectorProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      {BEDROOM_OPTIONS.map((opt) => {
        const is_active = opt.value === value;
        return (
          <Pressable
            key={opt.label}
            onPress={() => onChange(opt.value)}
            style={[styles.pill, is_active ? styles.pill_active : styles.pill_inactive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: is_active }}
            accessibilityLabel={`Recámaras: ${opt.label}`}
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
// Estilos — modo gestión-claro, idénticos a FilterTabs
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /** Fila de pills; flexWrap por si el texto fuera muy largo en locale futuro. */
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
  /** Tipo caption (uppercase semibold 12px) — igual a FilterTabs.label. */
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
