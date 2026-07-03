/**
 * zones.ts — autocomplete de zona/colonia para el FilterSheet (#12.4).
 *
 * DECISIÓN DE DISEÑO (vault 🔒 — no ILIKE '%texto%' sin índice, properties.zone
 * no tiene índice y no se creará migración para esto):
 *   1. fetch_distinct_zones() trae UNA vez las zonas distintas de propiedades
 *      activas (status='active', deleted_at IS NULL) — sin filtro de texto en DB.
 *   2. filter_zones() es PURA y filtra esa lista ya cargada en el cliente,
 *      según lo que el usuario va tecleando. Nunca toca la DB.
 *   3. El valor final seleccionado por el usuario es una zona EXACTA de la
 *      lista; el filtro de query en 12.6 usa match exacto (.in()/.eq('zone', …)).
 *
 * Política de filter_zones (documentada, no negociable sin actualizar tests):
 *   - Substring case-insensitive (NO solo prefijo): "santa" matchea
 *     "Nueva Santa María". Mejor UX para colonias con nombres compuestos.
 *   - query vacío o solo espacios → devuelve la lista completa (sin filtrar).
 *   - El query se trimea antes de comparar.
 *   - Acentos: SE NORMALIZAN (se remueven diacríticos antes de comparar), para
 *     que "alvaro" matchee "Álvaro Obregón" — mejor UX en teclados sin acentos.
 *   - Nunca lanza; entrada inválida (query no-string, zones vacío) se maneja
 *     con normalidad (arrays vacíos, no excepciones).
 *
 * ponytail: DI opcional via deps.supabase; prod usa lazy-require del singleton
 * para evitar que el top-level de client.ts (que lanza sin env vars) rompa los tests.
 */

 
export interface ZonesDeps {
   
  supabase: any;
}

type QueryRow = {
  zone: string | null;
};

/**
 * Trae las zonas distintas de propiedades activas, dedupeadas y ordenadas
 * alfabéticamente. Descarta null/vacío/whitespace.
 */
export async function fetch_distinct_zones(deps?: ZonesDeps): Promise<string[]> {
  // ponytail: lazy-require del cliente real; nunca se evalúa en tests (deps siempre inyectado)
   
  const client: any = deps?.supabase ?? (require('@/lib/supabase/client') as any).supabase;

  const { data: rows, error } = (await client
    .from('properties')
    .select('zone')
    .eq('status', 'active')
    .is('deleted_at', null)) as {
    data: QueryRow[] | null;
    error: { message: string } | null;
  };

  if (error) throw new Error(error.message);
  if (!rows || rows.length === 0) return [];

  const zones = new Set<string>();
  for (const row of rows) {
    const zone = row.zone?.trim();
    if (zone) zones.add(zone);
  }

  return Array.from(zones).sort((a, b) => a.localeCompare(b));
}

/** Remueve diacríticos y normaliza a minúsculas para comparación case/accent-insensitive. */
function normalize_for_match(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Filtra `zones` por coincidencia case-insensitive (substring, con acentos
 * normalizados) contra `query`. Función PURA: no muta `zones`, nunca lanza.
 */
export function filter_zones(zones: string[], query: string): string[] {
  if (!Array.isArray(zones)) return [];

  const trimmed_query = typeof query === 'string' ? query.trim() : '';
  if (trimmed_query === '') return [...zones];

  const normalized_query = normalize_for_match(trimmed_query);
  return zones.filter((zone) => normalize_for_match(zone).includes(normalized_query));
}
