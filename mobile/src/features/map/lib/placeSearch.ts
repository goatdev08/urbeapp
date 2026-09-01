/**
 * placeSearch.ts — autocomplete server-side de lugares para el mapa (#157.5).
 *
 * Llama la RPC `public.search_places` (migración 20260813000002): colonias del
 * catálogo DCAH/INEGI (mx_neighborhoods) + municipios (mx_municipalities),
 * match por prefijo o similitud trgm sobre nombres normalizados EN EL SERVER
 * (a diferencia de zones.ts, que filtra client-side una lista precargada — aquí
 * el catálogo es nacional, ~75k colonias, imposible precargarlo).
 *
 * Contrato (ver __tests__/placeSearch.test.ts):
 *   - Guard: query con < 2 caracteres útiles → [] SIN round-trip.
 *   - rpc('search_places', { p_query: query.trim(), p_limit: 10, ...coords }).
 *   - `coords` (#232, opcional, 3er parámetro): { lat, lng } del usuario
 *     (useLocation) → activa ranking por cercanía en el server. Se agregan
 *     SOLO cuando el caller los pasa — sin coords, el objeto de la RPC es
 *     byte-idéntico al de antes (p_query/p_limit), sin romper EC-PS3.
 *   - bbox con CUALQUIER campo null → bbox: null (fail-closed — municipio sin
 *     colonias cargadas, decisión D4; nada de NaN llegando al mapa).
 *   - Error de RPC → throw (el hook decide qué mostrar).
 *
 * ponytail: DI opcional vía deps.supabase; prod usa lazy-require del singleton
 * (patrón idéntico a zones.ts / useSavedProperties).
 *
 * row_to_bbox/PlaceRpcRow se EXPORTAN para reuso en lib/placeAtPoint.ts (#232)
 * — la RPC place_at_point devuelve el MISMO shape de fila (kind/id/name/
 * context/bbox_*), así que el mapeo fila→PlaceSuggestion no se duplica.
 */

export interface PlaceBBox {
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
}

export interface PlaceSuggestion {
  kind: 'neighborhood' | 'municipality';
  id: string;
  name: string;
  context: string;
  bbox: PlaceBBox | null;
}

export interface PlaceSearchDeps {

  supabase: any;
}

const SUGGESTION_LIMIT = 10;

export type PlaceRpcRow = {
  kind: 'neighborhood' | 'municipality';
  id: string;
  name: string;
  context: string;
  min_lat: number | null;
  min_lng: number | null;
  max_lat: number | null;
  max_lng: number | null;
};

export function row_to_bbox(row: PlaceRpcRow): PlaceBBox | null {
  const { min_lat, min_lng, max_lat, max_lng } = row;
  if (min_lat == null || min_lng == null || max_lat == null || max_lng == null) {
    return null;
  }
  return { min_lat, min_lng, max_lat, max_lng };
}

/** Fila cruda → PlaceSuggestion. Compartido con lib/placeAtPoint.ts (mismo shape). */
export function row_to_suggestion(row: PlaceRpcRow): PlaceSuggestion {
  return {
    kind: row.kind,
    id: row.id,
    name: row.name,
    context: row.context,
    bbox: row_to_bbox(row),
  };
}

/** Sugerencias de colonias + municipios para lo tecleado. [] con < 2 chars. */
export async function search_places(
  query: string,
  deps?: PlaceSearchDeps,
  coords?: { lat: number; lng: number },
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps inyectado).

  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  const { data, error } = (await client.rpc('search_places', {
    p_query: trimmed,
    p_limit: SUGGESTION_LIMIT,
    ...(coords ? { p_lat: coords.lat, p_lng: coords.lng } : {}),
  })) as { data: PlaceRpcRow[] | null; error: { message: string } | null };

  if (error) throw new Error(error.message);

  return (data ?? []).map(row_to_suggestion);
}
