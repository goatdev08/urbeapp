/**
 * placeAtPoint.ts — geocode inverso: lat/lng → zona de catálogo (#232).
 *
 * Llama la RPC `public.place_at_point(p_lat, p_lng)` (pinneada por el backend
 * en paralelo, migración de la subtarea 232.1): ST_Contains sobre
 * mx_neighborhoods, con fallback a municipio por bbox precalculado — MISMO
 * shape de fila que `search_places` (kind/id/name/context/bbox_*), por eso
 * el mapeo fila→PlaceSuggestion se REUSA de lib/placeSearch.ts
 * (row_to_suggestion) en vez de duplicarlo.
 *
 * Contrato (ver __tests__/placeAtPoint.test.ts):
 *   - rpc('place_at_point', { p_lat, p_lng }).
 *   - 0 filas (o data null) → null — fuera de cobertura del catálogo. El
 *     caller NUNCA inventa una zona con este resultado (contrato pinneado
 *     del carril de búsqueda unificada, #232).
 *   - 1 fila → PlaceSuggestion.
 *   - Error de RPC → throw (el caller decide qué mostrar).
 *
 * ponytail: DI opcional vía deps.supabase; prod usa lazy-require del cliente
 * singleton (patrón idéntico a placeSearch.ts / neighborhoodPolygon.ts).
 */

import { row_to_suggestion, type PlaceRpcRow, type PlaceSearchDeps, type PlaceSuggestion } from './placeSearch';

export type { PlaceSearchDeps };

/** Zona de catálogo que contiene el punto. null = fuera de cobertura. */
export async function resolve_place_at_point(
  lat: number,
  lng: number,
  deps?: PlaceSearchDeps,
): Promise<PlaceSuggestion | null> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps inyectado).

  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  const { data, error } = (await client.rpc('place_at_point', {
    p_lat: lat,
    p_lng: lng,
  })) as { data: PlaceRpcRow[] | null; error: { message: string } | null };

  if (error) throw new Error(error.message);

  const row = data?.[0];
  return row ? row_to_suggestion(row) : null;
}
