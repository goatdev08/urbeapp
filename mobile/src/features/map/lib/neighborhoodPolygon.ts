/**
 * neighborhoodPolygon.ts — perímetro de colonia bajo demanda (#157.5).
 *
 * 1. geojson_to_polygons — PURA: GeoJSON (Polygon|MultiPolygon) → anillos
 *    EXTERIORES en formato react-native-maps ({latitude, longitude}[]).
 *    ⚠️ GOTCHA: GeoJSON es [lng, lat] (x, y) — se invierte aquí. Mismo gotcha
 *    documentado en parse_location y en la RPC de radio.
 *    Holes ignorados a propósito: sobre-pintar el relleno translúcido no es un
 *    bug visible; el filtro real de propiedades es la RPC (ST_Intersects).
 *    Fail-closed: JSON inválido / tipo no soportado / coords malformadas → []
 *    (es render, no lógica de negocio — nunca lanza).
 *
 * 2. fetch_neighborhood_polygon — rpc('get_neighborhood_geojson') de la colonia
 *    seleccionada (ST_AsGeoJSON con 5 decimales, típicamente 5-50 KB). 0 filas
 *    → null (not-found); error → throw.
 *
 * ponytail: DI opcional vía deps.supabase + lazy-require (patrón zones.ts).
 */

import type { PlaceBBox } from './placeSearch';

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface NeighborhoodPolygon {
  id: string;
  name: string;
  polygons: LatLng[][];
  bbox: PlaceBBox;
}

export interface NeighborhoodPolygonDeps {

  supabase: any;
}

type Position = [number, number];

function ring_to_latlng(ring: unknown): LatLng[] | null {
  if (!Array.isArray(ring)) return null;
  const result: LatLng[] = [];
  for (const pos of ring) {
    if (!Array.isArray(pos) || typeof pos[0] !== 'number' || typeof pos[1] !== 'number') {
      return null;
    }
    const [lng, lat] = pos as Position;
    result.push({ latitude: lat, longitude: lng });
  }
  return result;
}

/** GeoJSON string → anillos exteriores para <Polygon/>. Inválido → []. */
export function geojson_to_polygons(geojson: string): LatLng[][] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(geojson);
  } catch {
    return [];
  }
  const geom = parsed as { type?: string; coordinates?: unknown };

  // Normaliza: Polygon = [anillos]; MultiPolygon = [[anillos], …]. De cada
  // polígono solo interesa el anillo [0] (exterior); holes fuera.
  let outer_rings: unknown[];
  if (geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    outer_rings = [geom.coordinates[0]];
  } else if (geom.type === 'MultiPolygon' && Array.isArray(geom.coordinates)) {
    outer_rings = geom.coordinates.map((poly) => (Array.isArray(poly) ? poly[0] : null));
  } else {
    return [];
  }

  const result: LatLng[][] = [];
  for (const ring of outer_rings) {
    const converted = ring_to_latlng(ring);
    // Fail-closed por anillo: uno malformado no tira los demás.
    if (converted && converted.length > 0) result.push(converted);
  }
  return result;
}

type RpcRow = {
  id: number;
  name: string;
  geojson: string;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
};

/** Polígono + bbox de UNA colonia. null = not-found. */
export async function fetch_neighborhood_polygon(
  id: string,
  deps?: NeighborhoodPolygonDeps,
): Promise<NeighborhoodPolygon | null> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps inyectado).

  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  const { data, error } = (await client.rpc('get_neighborhood_geojson', {
    // La RPC recibe bigint; en PlaceSuggestion el id viaja como string.
    p_neighborhood_id: Number(id),
  })) as { data: RpcRow[] | null; error: { message: string } | null };

  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;

  return {
    id: String(row.id),
    name: row.name,
    polygons: geojson_to_polygons(row.geojson),
    bbox: {
      min_lat: row.min_lat,
      min_lng: row.min_lng,
      max_lat: row.max_lat,
      max_lng: row.max_lng,
    },
  };
}
