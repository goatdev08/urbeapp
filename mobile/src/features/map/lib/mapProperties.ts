/**
 * mapProperties.ts — capa de datos del mapa global (#11.2).
 *
 * fetchMapProperties(deps?, filters?):
 *   - Consulta properties activas (status='active', deleted_at IS NULL).
 *   - Aplica FilterState (#12.7) ADEMÁS de los filtros base.
 *   - Convierte geography PostGIS → { lat, lng } via parse_location.
 *   - Fail-closed: filas con location null o no parseable se OMITEN.
 *   - Sin paginación — el mapa muestra todas las propiedades activas.
 *
 * ponytail: DI opcional via deps.supabase; prod usa lazy-require del singleton
 * para evitar que el top-level de client.ts (que lanza sin env vars) rompa los tests.
 * `filters` es el ÚLTIMO parámetro opcional (default EMPTY_FILTERS) para no
 * romper las 10 llamadas existentes con 0-1 args.
 */

import { build_filter_query, EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import { parse_location } from '@/features/property-detail/utils/parseLocation';

import type { MapProperty } from '../types';

 
export interface MapPropertiesDeps {
   
  supabase: any;
}

type QueryRow = {
  id: string;
  price: number;
  address: string;
  property_type: string;
  operation_type: 'rent' | 'sale' | 'both';
  bedrooms: number | null;
  bathrooms: number | null;
  location: string | null;
};

export async function fetchMapProperties(
  deps?: MapPropertiesDeps,
  filters?: FilterState,
): Promise<MapProperty[]> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps siempre inyectado)
   
  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  let query = client
    .from('properties')
    .select('id, price, address, property_type, operation_type, bedrooms, bathrooms, location')
    .eq('status', 'active')
    .is('deleted_at', null);

  // Filtros de usuario (#12.7) — ADEMÁS de los filtros base, nunca en su lugar.
  query = build_filter_query(query, filters ?? EMPTY_FILTERS);

  const { data: rows, error } = (await query) as {
    data: QueryRow[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return [];

  // Fail-closed: omit rows with null or non-parseable location
  const result: MapProperty[] = [];
  for (const row of rows) {
    const coords = parse_location(row.location);
    if (!coords) continue;

    result.push({
      id: row.id,
      price: row.price,
      lat: coords.lat,
      lng: coords.lng,
      operation_type: row.operation_type,
      property_type: row.property_type,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      address: row.address,
    });
  }

  return result;
}
