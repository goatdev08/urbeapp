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
 *   - rpc('search_places', { p_query: query.trim(), p_limit: 10 }).
 *   - bbox con CUALQUIER campo null → bbox: null (fail-closed — municipio sin
 *     colonias cargadas, decisión D4; nada de NaN llegando al mapa).
 *   - Error de RPC → throw (el hook decide qué mostrar).
 *
 * ponytail: DI opcional vía deps.supabase; prod usa lazy-require del singleton
 * (patrón idéntico a zones.ts / useSavedProperties).
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

type RpcRow = {
  kind: 'neighborhood' | 'municipality';
  id: string;
  name: string;
  context: string;
  min_lat: number | null;
  min_lng: number | null;
  max_lat: number | null;
  max_lng: number | null;
};

function row_to_bbox(row: RpcRow): PlaceBBox | null {
  const { min_lat, min_lng, max_lat, max_lng } = row;
  if (min_lat == null || min_lng == null || max_lat == null || max_lng == null) {
    return null;
  }
  return { min_lat, min_lng, max_lat, max_lng };
}

/** Sugerencias de colonias + municipios para lo tecleado. [] con < 2 chars. */
export async function search_places(
  query: string,
  deps?: PlaceSearchDeps,
): Promise<PlaceSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps inyectado).

  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  const { data, error } = (await client.rpc('search_places', {
    p_query: trimmed,
    p_limit: SUGGESTION_LIMIT,
  })) as { data: RpcRow[] | null; error: { message: string } | null };

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    kind: row.kind,
    id: row.id,
    name: row.name,
    context: row.context,
    bbox: row_to_bbox(row),
  }));
}
