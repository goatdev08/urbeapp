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
   * null = "Sin límite" (default en EMPTY_FILTERS, #58): quita el TOPE de
   * distancia pero la carga contextual (orden por cercanía) sigue aplicando
   * (#62) — el feed llama la RPC con UNLIMITED_RADIUS_M (cubre el planeta);
   * el mapa con null muestra todo (query plana, los pins no tienen orden).
   *
   * 🔒 Invariante A1 (#42): radius_m es SOLO parámetro de la RPC de proximidad
   * (o la señal de radio ilimitado); NUNCA debe viajar por `build_filter_query`
   * (ver EC-26 en filterQuery.test.ts).
   */
  radius_m: number | null;
  /**
   * Zona "buscar en esta zona" (#56, viewport del mapa → círculo). null = sin
   * zona activa (modo normal: cercanía GPS de #42). Efímera — NO se persiste
   * en AsyncStorage (excluida de save_filters/load_filters, decisión 8 de la
   * exploración 030-buscar-en-esta-zona).
   *
   * 🔒 Invariante A1 (igual que radius_m): area es SOLO parámetro de la RPC
   * `properties_within_radius` (center/radius_m ya calculados por
   * `map/lib/viewportToArea.ts`); NUNCA debe viajar por `build_filter_query`
   * (ver EC en filterQuery.test.ts, bloque "area").
   */
  area: { center: { lat: number; lng: number }; radius_m: number } | null;
}
