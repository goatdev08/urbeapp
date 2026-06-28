/**
 * FilterTabs — tabs de filtro horizontal para "Mis publicaciones".
 *
 * Tabs: Todas / Activas / Pausadas / Cerradas (es-MX).
 * Filtrado client-side: el padre mantiene el estado y pasa `value` + `on_change`.
 *
 * Decisión sobre `draft`:
 *   `draft`, `pending_review`, `needs_changes` y `suspended` no tienen tab propio.
 *   Caen bajo "Todas" únicamente. El mockup (pantalla 9) no muestra tab Draft,
 *   y el plan lo confirma. Si en el futuro se necesita, se añade aquí.
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
// Tipos públicos
// ---------------------------------------------------------------------------

/** Valores de filtro de esta pantalla. */
export type FilterValue = 'all' | 'active' | 'paused' | 'closed';

interface TabDef {
  value: FilterValue;
  label: string;
}

/** Definición fija de los tabs en orden de aparición. */
const TABS: TabDef[] = [
  { value: 'all',    label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'paused', label: 'Pausadas' },
  { value: 'closed', label: 'Cerradas' },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface FilterTabsProps {
  /** Valor seleccionado actualmente. */
  value: FilterValue;
  /** Callback al cambiar de tab. */
  on_change: (next: FilterValue) => void;
  /**
   * Conteos por tab, calculados por el padre desde el array completo
   * (no del array ya filtrado, para mostrar totales reales).
   */
  counts: Record<FilterValue, number>;
}

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FilterTabs({ value, on_change, counts }: FilterTabsProps) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.container}
    >
      {TABS.map((tab) => {
        const is_active = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => on_change(tab.value)}
            style={[styles.tab, is_active ? styles.tab_active : styles.tab_inactive]}
            accessibilityRole="tab"
            accessibilityState={{ selected: is_active }}
            accessibilityLabel={`${tab.label}, ${counts[tab.value]} propiedades`}
          >
            <Text style={[styles.label, is_active ? styles.label_active : styles.label_inactive]}>
              {tab.label} ({counts[tab.value]})
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
