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
  /**
   * Radio de búsqueda en metros para la RPC `properties_within_radius` (#42, approach A1).
   * STUB fase RED (#42.1): opcional aquí para no romper construcciones existentes de
   * FilterState en otros tests (p.ej. filterStorage.test.ts). El GREEN de #42.1 lo
   * vuelve requerido (`radius_m: number`) con default 5000 en EMPTY_FILTERS.
   *
   * 🔒 Invariante A1 (#42): radius_m es SOLO parámetro de la RPC de proximidad;
   * NUNCA debe viajar por `build_filter_query` (ver EC-26 en filterQuery.test.ts).
   */
  radius_m?: number;
}
