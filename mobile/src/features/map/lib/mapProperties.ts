/**
 * mapProperties.ts — capa de datos del mapa global (#11.2).
 *
 * fetchMapProperties(deps?):
 *   - Consulta properties activas (status='active', deleted_at IS NULL).
 *   - Convierte geography PostGIS → { lat, lng } via parse_location.
 *   - Fail-closed: filas con location null o no parseable se OMITEN.
 *   - Sin paginación — el mapa muestra todas las propiedades activas.
 *
 * ponytail: DI opcional via deps.supabase; prod usa lazy-require del singleton
 * para evitar que el top-level de client.ts (que lanza sin env vars) rompa los tests.
 */

import { parse_location } from '@/features/property-detail/utils/parseLocation';

import type { MapProperty } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface MapPropertiesDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export async function fetchMapProperties(deps?: MapPropertiesDeps): Promise<MapProperty[]> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps siempre inyectado)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  const { data: rows, error } = (await client
    .from('properties')
    .select('id, price, address, property_type, operation_type, bedrooms, bathrooms, location')
    .eq('status', 'active')
    .is('deleted_at', null)) as {
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
