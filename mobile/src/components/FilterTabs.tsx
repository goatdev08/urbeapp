/**
 * FilterTabs — tabs de filtro horizontal genéricos.
 *
 * API:
 *   tabs: { value: T; label: string }[] — lista de opciones en orden
 *   value: T                             — tab activo
 *   onChange: (v: T) => void             — callback al cambiar
 *
 * Visual: pills en ScrollView horizontal, paleta gestión-claro.
 * Estilo extraído del FilterTabs de profile/components (tarea 15.7).
 *
 * ponytail: ScrollView horizontal + Pressable pill — sin librería extra.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';

import { colors, radii, spacing, type_scale } from '@/theme/theme';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilterTabsProps<T extends string> {
  /** Definición de los tabs en el orden de aparición. */
  tabs: { value: T; label: string }[];
  /** Valor del tab seleccionado actualmente. */
  value: T;
  /** Callback al cambiar de tab. */
  onChange: (v: T) => void;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FilterTabs<T extends string>({
  tabs,
  value,
  onChange,
}: FilterTabsProps<T>): React.JSX.Element {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {tabs.map((tab) => {
        const is_active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            style={[styles.tab, is_active ? styles.tab_active : styles.tab_inactive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: is_active }}
            accessibilityLabel={tab.label}
          >
            <Text
              style={[
                styles.label,
                is_active ? styles.label_active : styles.label_inactive,
              ]}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Estilos — modo gestión-claro
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    gap: spacing.s_8,
    paddingVertical: spacing.s_4,
  },
  tab: {
    borderRadius: radii.r_pill,
    paddingHorizontal: spacing.s_16,
    paddingVertical: spacing.s_8,
  },
  tab_active: {
    backgroundColor: colors.primary_tint,
  },
  tab_inactive: {
    backgroundColor: colors.paper_2,
  },
  label: {
    ...type_scale.caption,
  },
  label_active: {
    color: colors.primary,
  },
  label_inactive: {
    color: colors.gray_2,
  },
});
