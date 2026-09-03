/**
 * feedSection.ts — la sección del feed (Venta · Renta) como invariante del
 * FilterState (#241.1).
 *
 * Decisión de producto (2026-09-02): el feed se divide en dos secciones y cada
 * una lleva fijo su filtro de operación. NO hay estado nuevo: la sección ES
 * `filters.operation_types` con exactamente un valor ('sale' | 'rent'), en el
 * FilterState que feed y mapa ya comparten (una sola verdad — el mapa sigue la
 * sección). El FilterSheet dejó de exponer «Operación».
 *
 * Compatibilidad: un FilterState persistido antes de #241 puede traer
 * operation_types = [] (sin filtro), ['rent','sale'] (ambas marcadas en el
 * sheet viejo) o cualquier otra cosa. Todo lo que no sea exactamente ['rent'] o
 * ['sale'] cae en la sección default — el FilterProvider normaliza al hidratar.
 *
 * 'both' sigue siendo valor de DATO (una propiedad que acepta ambas
 * modalidades): build_filter_query lo agrega solo al .in(...), así una
 * propiedad 'both' aparece en las dos secciones.
 *
 * ponytail: dos funciones puras y dos constantes; sin enum ni clase.
 */
import type { FilterState } from '../types';

export type FeedSection = 'sale' | 'rent';

/** Venta abre por defecto (decisión Abraham 2026-09-02). */
export const DEFAULT_FEED_SECTION: FeedSection = 'sale';

/** Orden de los tabs sobre el feed: Venta, Renta. */
export const FEED_SECTIONS: { value: FeedSection; label: string }[] = [
  { value: 'sale', label: 'Venta' },
  { value: 'rent', label: 'Renta' },
];

/** Sección que representa `filters`; cualquier forma no canónica → default. */
export function section_from_filters(filters: FilterState): FeedSection {
  const ops = filters.operation_types;
  if (ops.length === 1 && (ops[0] === 'sale' || ops[0] === 'rent')) return ops[0];
  return DEFAULT_FEED_SECTION;
}

/** Copia de `filters` con la sección fijada (operation_types exacto). Puro. */
export function with_section(filters: FilterState, section: FeedSection): FilterState {
  return { ...filters, operation_types: [section] };
}
