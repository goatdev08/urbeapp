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
  radius_m: null,
};

/** Forma mínima del query builder de supabase-js que este módulo necesita. */
interface FilterableQueryBuilder {
  in(column: string, values: unknown[]): this;
  gte(column: string, value: unknown): this;
  lte(column: string, value: unknown): this;
  eq(column: string, value: unknown): this;
}

/**
 * Aplica los filtros activos de `filters` al query builder de supabase-js
 * y devuelve el mismo builder (encadenable).
 *
 * Políticas (ver header de filterQuery.test.ts):
 * - operation_types no vacío → SIEMPRE agrega 'both' al .in(...).
 * - zone usa match exacto (.eq), nunca .ilike.
 * - booleanos: true → .eq(col, true); false → sin filtro.
 * - NO reaplica status/deleted_at (ya en las queries base).
 */
export function build_filter_query<Q extends FilterableQueryBuilder>(
  query: Q,
  filters: FilterState,
): Q {
  if (filters.operation_types.length > 0) {
    query.in('operation_type', [...filters.operation_types, 'both']);
  }
  if (filters.property_types.length > 0) {
    query.in('property_type', filters.property_types);
  }
  if (filters.price_min !== null) {
    query.gte('price', filters.price_min);
  }
  if (filters.price_max !== null) {
    query.lte('price', filters.price_max);
  }
  if (filters.zone !== null) {
    query.eq('zone', filters.zone);
  }
  if (filters.bedrooms_min !== null) {
    query.gte('bedrooms', filters.bedrooms_min);
  }
  if (filters.pet_friendly) {
    query.eq('pet_friendly', true);
  }
  if (filters.allows_no_guarantor) {
    query.eq('allows_no_guarantor', true);
  }
  if (filters.student_friendly) {
    query.eq('student_friendly', true);
  }
  return query;
}

/**
 * Cuenta cuántos "grupos" de filtro están activos (para el badge del FilterSheet).
 * Rango de precio (min y/o max) cuenta como UN solo grupo.
 *
 * ponytail: radius_m NO cuenta — es un parámetro de alcance ("qué tan lejos
 * buscar"), no un filtro de contenido ("qué tipo de propiedad buscar"). El
 * badge refleja solo filtros de contenido. (Decisión #58, subtarea 58.5)
 */
export function get_active_filter_count(filters: FilterState): number {
  let count = 0;
  if (filters.operation_types.length > 0) count += 1;
  if (filters.property_types.length > 0) count += 1;
  if (filters.price_min !== null || filters.price_max !== null) count += 1;
  if (filters.zone !== null) count += 1;
  if (filters.bedrooms_min !== null) count += 1;
  if (filters.pet_friendly) count += 1;
  if (filters.allows_no_guarantor) count += 1;
  if (filters.student_friendly) count += 1;
  return count;
}
