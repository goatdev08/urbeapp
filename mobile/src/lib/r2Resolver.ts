/**
 * r2Resolver.ts — resolver de LECTURA reusable de keys R2 → URLs presigned.
 *
 * Contrato:
 *   resolve_r2_urls(keys, deps?) → (string | null)[], MISMA longitud y
 *   orden que `keys`. keys inválidos (null/undefined/'') → null sin invocar
 *   la EF. Elementos que empiezan con `http://` o `https://` (URLs legacy de
 *   Supabase Storage, pre-migración R2 — 69.6) se devuelven TAL CUAL, sin
 *   incluirse en la llamada a la EF (no son keys R2). Keys R2 válidos se
 *   piden en UN SOLO invoke a `mint-r2-url` (`{kind:'avatar', op:'get',
 *   keys:[...]}`, deduplicados). Fail-soft: error de la EF o excepción de
 *   red → todas las posiciones de key R2 resuelven null, NUNCA lanza. Si no
 *   queda ninguna key R2 real (todo URLs legacy o null), no se invoca la EF.
 *
 * Caché de módulo (#263): la firma presigned cambia en cada invoke, así que
 * expo-image nunca acertaba su caché en disco por URL — cada montaje volvía
 * a pedir la EF (RTT a us-west-2 + auth.getUser) y a descargar la misma
 * foto. Una `Map<key, {url, expires_at_ms}>` a nivel de módulo sirve una key
 * directo si le quedan más de `R2_URL_SAFETY_MS` de vida (el `expires`,
 * segundos, viene de la propia respuesta de la EF); solo las keys sin caché
 * válida entran al batch. Un `Map<key, Promise>` de "en vuelo" deduplica
 * consumidores concurrentes de la misma key (p.ej. 8 items del feed del
 * mismo publicador) en UN solo invoke. Fail-soft intacto: un fallo no
 * cachea nada. `peek_r2_urls`/`clear_r2_url_cache` — lectura síncrona y
 * reset para tests/siembra inicial de hooks.
 *
 * Ver mobile/src/lib/__tests__/r2Resolver.test.ts (contrato base) y
 * r2Resolver.cache.test.ts (caché) para el contrato completo.
 *
 * Implementación GREEN — subtarea 69.3. Passthrough de URLs legacy — 69.6.
 * Caché de módulo + dedupe en vuelo — tarea 263.
 */

export interface R2ResolverDeps {
  /** Cliente Supabase inyectado (en producción: supabase del singleton). */
  supabase?: unknown;
}

/** Forma de cada elemento de la respuesta de mint-r2-url para op:get. */
interface MintGetResponseItem {
  key: string;
  url: string;
  expires: number;
}

interface MintGetResponse {
  urls?: MintGetResponseItem[];
}

interface SupabaseFunctionsClient {
  functions: {
    invoke: (
      name: string,
      opts: { body: Record<string, unknown> },
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
}

/** Carga lazy del cliente Supabase real — solo cuando no se inyecta uno de test. */
function get_default_supabase(): SupabaseFunctionsClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: SupabaseFunctionsClient }).supabase;
}

/** Margen de seguridad (#263): una URL con menos de esta vida restante se
 * vuelve a pedir en vez de servirse de caché (evita usar una firma a punto
 * de vencer durante una descarga larga). 5 minutos. */
export const R2_URL_SAFETY_MS = 300_000;

interface CachedUrl {
  url: string;
  expires_at_ms: number;
}

/** Caché de módulo (#263): sobrevive entre montajes/pantallas — la firma
 * cambia por invoke, pero la KEY de R2 es estable, así que cacheamos por key. */
const url_cache = new Map<string, CachedUrl>();

/** Llamadas en vuelo por key — dedupe de consumidores concurrentes de la
 * MISMA key (p.ej. 8 items del feed del mismo publicador) en UN invoke. */
const in_flight = new Map<string, Promise<Map<string, string>>>();

function is_cache_fresh(key: string, now: number): boolean {
  const cached = url_cache.get(key);
  return !!cached && cached.expires_at_ms - now > R2_URL_SAFETY_MS;
}

/** Invoca la EF para un lote de keys nuevas y puebla la caché con lo que
 * responda. Fail-soft: un error o excepción no cachea nada. */
async function fetch_and_cache_keys(
  keys_to_fetch: string[],
  client: SupabaseFunctionsClient,
): Promise<Map<string, string>> {
  const url_by_key = new Map<string, string>();
  try {
    const { data, error } = await client.functions.invoke('mint-r2-url', {
      body: { kind: 'avatar', op: 'get', keys: keys_to_fetch },
    });

    if (!error && data) {
      const items = (data as MintGetResponse).urls ?? [];
      const now = Date.now();
      items.forEach((item) => {
        url_by_key.set(item.key, item.url);
        url_cache.set(item.key, { url: item.url, expires_at_ms: now + item.expires * 1000 });
      });
    }
    // error !== null → fail-soft: no se cachea nada.
  } catch {
    // Excepción de red — fail-soft, NUNCA se propaga.
  }
  return url_by_key;
}

/**
 * Resuelve un lote de R2 keys de avatar a URLs presigned de lectura.
 * Bucket PRIVADO: la lectura siempre pasa por aquí (no hay URL pública).
 * Sirve desde la caché de módulo cuando la key tiene vida suficiente (#263).
 */
export async function resolve_r2_urls(
  keys: (string | null | undefined)[],
  deps?: R2ResolverDeps,
): Promise<(string | null)[]> {
  const result: (string | null)[] = keys.map(() => null);

  // Índices y valores de las keys R2 REALES (no null/undefined/'', y sin
  // prefijo http(s) — esas son URLs legacy que se devuelven tal cual más
  // abajo sin pasar por la EF), en el orden en que aparecen — preserva
  // alineación 1:1 con la entrada.
  const valid_indices: number[] = [];
  const valid_keys: string[] = [];
  keys.forEach((key, index) => {
    if (!key) return;
    if (key.startsWith('http://') || key.startsWith('https://')) {
      // URL legacy (Supabase Storage, pre-migración R2) — ya es utilizable,
      // se devuelve tal cual sin pedirla a mint-r2-url.
      result[index] = key;
      return;
    }
    valid_indices.push(index);
    valid_keys.push(key);
  });

  if (valid_keys.length === 0) {
    return result;
  }

  const now = Date.now();

  // Solo las keys SIN caché válida entran al batch — de-dup preservando
  // orden de aparición (nunca una invocación por key).
  const keys_needing_fetch: string[] = [];
  const seen = new Set<string>();
  valid_keys.forEach((key) => {
    if (seen.has(key) || is_cache_fresh(key, now)) return;
    seen.add(key);
    keys_needing_fetch.push(key);
  });

  if (keys_needing_fetch.length > 0) {
    const client = (deps?.supabase as SupabaseFunctionsClient | undefined) ?? get_default_supabase();

    // Solo las keys que NO tienen ya una llamada en vuelo disparan un
    // invoke nuevo; las demás esperan la promesa existente.
    const new_keys = keys_needing_fetch.filter((key) => !in_flight.has(key));

    if (new_keys.length > 0) {
      const batch_promise = fetch_and_cache_keys(new_keys, client);
      new_keys.forEach((key) => in_flight.set(key, batch_promise));
      void batch_promise.finally(() => {
        new_keys.forEach((key) => {
          if (in_flight.get(key) === batch_promise) {
            in_flight.delete(key);
          }
        });
      });
    }

    const pending = new Set(
      keys_needing_fetch.map((key) => in_flight.get(key)).filter((p): p is Promise<Map<string, string>> => !!p),
    );
    await Promise.all(pending);
  }

  valid_indices.forEach((index, i) => {
    result[index] = url_cache.get(valid_keys[i]!)?.url ?? null;
  });

  return result;
}

/**
 * Lectura SÍNCRONA de la caché de módulo — nunca invoca la EF. Devuelve la
 * URL cacheada (con vida suficiente) o el passthrough http(s), `null` en lo
 * demás. Usado por useR2Urls para sembrar el estado inicial sin flash.
 */
export function peek_r2_urls(keys: (string | null | undefined)[]): (string | null)[] {
  const now = Date.now();
  return keys.map((key) => {
    if (!key) return null;
    if (key.startsWith('http://') || key.startsWith('https://')) return key;
    return is_cache_fresh(key, now) ? url_cache.get(key)!.url : null;
  });
}

/** Vacía la caché de módulo y las llamadas en vuelo — uso en tests. */
export function clear_r2_url_cache(): void {
  url_cache.clear();
  in_flight.clear();
}
