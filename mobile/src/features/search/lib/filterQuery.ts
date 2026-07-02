/**
 * filterQuery.ts — builder puro del WHERE de filtros del feed/mapa (#12.6).
 *
 * STUB fase RED — sin lógica de negocio. Lanza `not_implemented` para que
 * los tests fallen por aserción/excepción, no por import.
 *
 * Contrato completo (a implementar en GREEN): ver
 * mobile/src/features/search/__tests__/filterQuery.test.ts
 */

import type { FilterState } from '../types';

/** Estado inicial: todos los filtros vacíos/null/false (sin filtro alguno). */
export const EMPTY_FILTERS: FilterState = {
  operation_types: [],
  property_types: [],
  price_min: null,
  price_max: null,
  zone: null,
  bedrooms_min: null,
  pet_friendly: false,
  allows_no_guarantor: false,
  student_friendly: false,
};

/**
 * Aplica los filtros activos de `filters` al query builder de supabase-js
 * y devuelve el mismo builder (encadenable).
 *
 * ponytail: stub RED — sin lógica; ver test-author para el contrato exacto.
 */
export function build_filter_query<Q>(_query: Q, _filters: FilterState): Q {
  throw new Error('not_implemented');
}

/**
 * Cuenta cuántos "grupos" de filtro están activos (para el badge del FilterSheet).
 *
 * ponytail: stub RED — sin lógica; ver test-author para el contrato exacto.
 */
export function get_active_filter_count(_filters: FilterState): number {
  throw new Error('not_implemented');
}
