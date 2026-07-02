/**
 * FilterChipGroup.tsx — Multi-select de chips/pills reutilizable (#12.2).
 *
 * Componente controlado que permite selección múltiple independiente.
 * Tocar una pill la agrega al array `selected`; tocarla de nuevo la quita.
 *
 * Estilo idéntico a BedroomsSelector y FilterTabs (gestión-claro):
 *   activo:   fondo primary_tint, texto primary
 *   inactivo: fondo paper_2, texto gray_2
 *
 * Diseñado para ser reutilizado en FilterSheet para las secciones de
 * Operación (rent/sale) y Tipo de propiedad (casa/depto/local/oficina/terreno),
 * y en cualquier filtro de selección múltiple que se agregue en el futuro.
 *
 * Contrato:
 *   options:  { value: string; label: string }[]  — opciones disponibles
 *   selected: string[]                             — valores activos
 *   onChange: (next: string[]) => void             — callback con el nuevo array
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface FilterChipGroupProps {
  /** Lista de opciones en el orden de aparición. */
  options: { value: string; label: string }[];
  /**
   * Valores actualmente seleccionados (subconjunto de options[].value).
   * Array vacío = ninguno seleccionado (sin filtro para este campo).
   */
  selected: string[];
  /**
   * Callback al agregar o quitar una opción.
   * Recibe el nuevo array completo con el toggle aplicado.
   */
  onChange: (next: string[]) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Agrega `value` si no está en `selected`; lo quita si ya está. */
function toggle_chip(selected: string[], value: string): string[] {
  return selected.includes(value)
    ? selected.filter((v) => v !== value)
    : [...selected, value];
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function FilterChipGroup({
  options,
  selected,
  onChange,
}: FilterChipGroupProps): React.JSX.Element {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const is_active = selected.includes(opt.value);
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(toggle_chip(selected, opt.value))}
            style={[styles.chip, is_active ? styles.chip_active : styles.chip_inactive]}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: is_active }}
            accessibilityLabel={opt.label}
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
// Estilos — modo gestión-claro, idénticos a BedroomsSelector / FilterTabs
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /**
   * Fila de chips con wrap para acomodar cualquier cantidad de opciones
   * (5 tipos de propiedad pueden necesitar segunda línea en pantallas angostas).
   */
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s_8,
  },
  chip: {
    borderRadius: radii.r_pill,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_8,
  },
  chip_active: {
    backgroundColor: colors.primary_tint,
  },
  chip_inactive: {
    backgroundColor: colors.paper_2,
  },
  /**
   * Tipo caption (uppercase semibold 12px) — idéntico a BedroomsSelector.label
   * y FilterTabs.label para coherencia visual del sheet de filtros.
   */
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
