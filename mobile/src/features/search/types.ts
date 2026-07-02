/**
 * types.ts — Tipos compartidos de filtros de búsqueda (#12.6).
 *
 * FilterState: forma del estado de filtros del feed/mapa (Context, GREEN futuro).
 * Consumido por build_filter_query / get_active_filter_count (lib/filterQuery.ts).
 *
 * ponytail: arrays vacíos ([]) y null representan "sin filtro"; NUNCA se usa
 * undefined para eso (evita `?? []` repetido en el builder).
 */

export interface FilterState {
  /** Subconjunto de ['rent','sale']; [] = sin filtro de operación. */
  operation_types: string[];
  /** Subconjunto del enum property_type; [] = sin filtro. */
  property_types: string[];
  price_min: number | null;
  price_max: number | null;
  /** Zona EXACTA seleccionada; null = sin filtro. */
  zone: string | null;
  /** Mínimo de recámaras; null = sin filtro. */
  bedrooms_min: number | null;
  /** true = exigir pet-friendly; false = no filtrar. */
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
}
