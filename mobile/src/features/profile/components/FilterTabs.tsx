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
 * Refactorizado en 15.7: delega el renderizado al FilterTabs genérico de
 * src/components/. Mantiene la misma API pública (value, on_change, counts)
 * para retrocompatibilidad con my-listings.tsx — los conteos se embeben en
 * el label del tab ("Todas (5)").
 *
 * ponytail: wrapper fino — sin estilos propios (los gestiona el genérico).
 */

import React from 'react';

import { FilterTabs as GenericFilterTabs } from '@/components/FilterTabs';

// ---------------------------------------------------------------------------
// Tipos públicos — mantenemos la misma API que antes de la refactorización
// ---------------------------------------------------------------------------

/** Valores de filtro de esta pantalla. */
export type FilterValue = 'all' | 'active' | 'paused' | 'closed';

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
// Definición de tabs en orden de aparición
// ---------------------------------------------------------------------------

const TABS: { value: FilterValue; base_label: string }[] = [
  { value: 'all',    base_label: 'Todas' },
  { value: 'active', base_label: 'Activas' },
  { value: 'paused', base_label: 'Pausadas' },
  { value: 'closed', base_label: 'Cerradas' },
];

// ---------------------------------------------------------------------------
// Componente
// ---------------------------------------------------------------------------

export function FilterTabs({ value, on_change, counts }: FilterTabsProps): React.JSX.Element {
  // Embebe el conteo en el label para respetar la API genérica
  const tabs = TABS.map((tab) => ({
    value: tab.value,
    label: `${tab.base_label} (${counts[tab.value]})`,
  }));

  return (
    <GenericFilterTabs
      tabs={tabs}
      value={value}
      onChange={on_change}
    />
  );
}
