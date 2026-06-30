/**
 * mapProperties.ts — capa de datos del mapa global (#11.2).
 *
 * fetchMapProperties(deps?):
 *   - Consulta properties activas (status='active', deleted_at IS NULL).
 *   - Convierte geography PostGIS → { lat, lng } via parse_location.
 *   - Fail-closed: filas con location null o no parseable se OMITEN.
 *   - Sin paginación — el mapa muestra todas las propiedades activas.
 *
 * ponytail: DI opcional via deps.supabase; prod usa lazy-require del singleton.
 *
 * STUB: implementación pendiente (subtarea 11.2 GREEN).
 */

import type { MapProperty } from '../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface MapPropertiesDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}

export async function fetchMapProperties(deps?: MapPropertiesDeps): Promise<MapProperty[]> {
  throw new Error('not_implemented');
}
