/**
 * mapProperties.ts — capa de datos del mapa global (#11.2).
 *
 * fetchMapProperties(deps?, filters?):
 *   - Llama SIEMPRE la RPC properties_within_radius ANTES de PostgREST (#42.3,
 *     approach A1, espejo de feedProperties #42.2): devuelve {id, distance_m}[].
 *     Radio = filters.radius_m ?? 5000; si la RPC devuelve vacío, expande
 *     ×2 hasta 3 reintentos (5000→10000→20000→40000); agotado → [] sin
 *     tocar PostgREST.
 *   - Query: `.in('id', ids)` con TODOS los ids de la RPC (sin slice — el
 *     mapa no pagina) + status/deleted_at + build_filter_query (#12.7).
 *   - Convierte geography PostGIS → { lat, lng } via parse_location.
 *   - Fail-closed: filas con location null o no parseable se OMITEN.
 *   - Sin paginación ni re-sort — el mapa muestra todas las propiedades
 *     dentro del radio, sin orden por distancia.
 *
 * ponytail: DI opcional via deps.supabase; prod usa lazy-require del singleton
 * para evitar que el top-level de client.ts (que lanza sin env vars) rompa los tests.
 * `filters` es el ÚLTIMO parámetro opcional (default EMPTY_FILTERS) para no
 * romper las llamadas existentes con 0-1 args.
 *
 * ponytail: el loop de expansión de radio se DUPLICA de feedProperties.ts
 * (~15 líneas) en vez de extraerse a un helper compartido — dos consumidores
 * con firmas de retorno distintas (con/sin paginación y re-sort) no justifican
 * la abstracción todavía. Si aparece un 3er consumidor, extraer a
 * `features/proximity/lib/radiusExpansion.ts` (documentado en la subtarea 42.3).
 */

import { GDL_REGION } from '@/features/map/constants';
import { build_filter_query, EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import { parse_location } from '@/features/property-detail/utils/parseLocation';

import type { MapProperty } from '../types';


export interface MapPropertiesDeps {

  supabase: any;
  /**
   * Coords del usuario para la RPC de proximidad (#42.3). Si se omite, usa
   * el centro de Guadalajara como fallback (reusa GDL_REGION del mapa).
   */
  coords?: { latitude: number; longitude: number };
}

const DEFAULT_RADIUS_M = 5000;
const MAX_EXPANSION_ATTEMPTS = 3;
const RADIUS_MULTIPLIER = 2;

/** Fila cruda que devuelve la RPC properties_within_radius (#42.3). */
type RpcRow = { id: string; distance_m: number };

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

  // ponytail: fallback centro de Guadalajara (demo cerrada opera ahí, #11)
  // cuando aún no hay coords reales del usuario.
  const coords = deps?.coords ?? { latitude: GDL_REGION.latitude, longitude: GDL_REGION.longitude };

  const base_radius = filters?.radius_m ?? DEFAULT_RADIUS_M;

  // RPC de proximidad SIEMPRE antes de PostgREST (#42.3, approach A1). Si
  // devuelve vacío, expande el radio ×2 hasta MAX_EXPANSION_ATTEMPTS
  // reintentos (5000→10000→20000→40000). Error de la RPC → lanza sin reintentar.
  let radius = base_radius;
  let rpc_rows: RpcRow[] = [];
  let attempts = 0;

  while (true) {
    const rpc_result = (await client.rpc('properties_within_radius', {
      p_lat: coords.latitude,
      p_lng: coords.longitude,
      p_radius_m: radius,
    })) as { data: RpcRow[] | null; error: { message: string } | null };

    if (rpc_result.error) throw new Error(rpc_result.error.message);

    rpc_rows = rpc_result.data ?? [];

    if (rpc_rows.length > 0 || attempts >= MAX_EXPANSION_ATTEMPTS) break;

    attempts++;
    radius *= RADIUS_MULTIPLIER;
  }

  if (rpc_rows.length === 0) return [];

  const rpc_ids = rpc_rows.map((r) => r.id);

  // Query base: .in('id', ids) con TODOS los ids de la RPC (sin slice — el
  // mapa no pagina) + filtros base.
  let query = client
    .from('properties')
    .select('id, price, address, property_type, operation_type, bedrooms, bathrooms, location')
    .in('id', rpc_ids)
    .eq('status', 'active')
    .is('deleted_at', null);

  // Filtros de usuario (#12.7) — ADEMÁS de los filtros base, nunca en su lugar.
  // radius_m NUNCA llega aquí: es solo parámetro de la RPC (invariante A1).
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
