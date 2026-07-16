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
 * Ver mobile/src/lib/__tests__/r2Resolver.test.ts para el contrato completo
 * (batch, dedup, fail-soft, alineación 1:1, passthrough legacy).
 *
 * Implementación GREEN — subtarea 69.3. Passthrough de URLs legacy — 69.6.
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

/**
 * Resuelve un lote de R2 keys de avatar a URLs presigned de lectura.
 * Bucket PRIVADO: la lectura siempre pasa por aquí (no hay URL pública).
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

  // De-dup — nunca una invocación por key, un solo batch con keys únicas.
  const unique_keys = Array.from(new Set(valid_keys));

  const client = (deps?.supabase as SupabaseFunctionsClient | undefined) ?? get_default_supabase();

  let url_by_key = new Map<string, string>();

  try {
    const { data, error } = await client.functions.invoke('mint-r2-url', {
      body: { kind: 'avatar', op: 'get', keys: unique_keys },
    });

    if (!error && data) {
      const items = (data as MintGetResponse).urls ?? [];
      url_by_key = new Map(items.map((item) => [item.key, item.url]));
    }
    // error !== null → fail-soft: url_by_key queda vacío, todas las posiciones
    // válidas resuelven null más abajo.
  } catch {
    // Excepción de red — fail-soft, NUNCA se propaga.
  }

  valid_indices.forEach((index, i) => {
    result[index] = url_by_key.get(valid_keys[i]!) ?? null;
  });

  return result;
}
