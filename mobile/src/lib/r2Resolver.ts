/**
 * r2Resolver.ts — resolver de LECTURA reusable de keys R2 → URLs presigned.
 *
 * STUB RED — subtarea 69.3. Ver mobile/src/lib/__tests__/r2Resolver.test.ts
 * para el contrato completo (batch, dedup, fail-soft, alineación 1:1).
 *
 * Contrato objetivo:
 *   resolve_r2_urls(keys, deps?) → (string | null)[], MISMA longitud y
 *   orden que `keys`. keys inválidos (null/undefined/'') → null sin invocar
 *   la EF. Keys válidos se piden en UN SOLO invoke a `mint-r2-url`
 *   (`{kind:'avatar', op:'get', keys:[...]}`, deduplicados). Fail-soft: error
 *   de la EF o excepción de red → todas las posiciones válidas resuelven
 *   null, NUNCA lanza.
 *
 * Implementación GREEN pendiente — subtarea 69.3.
 */

export interface R2ResolverDeps {
  /** Cliente Supabase inyectado (en producción: supabase del singleton). */
  supabase?: unknown;
}

/**
 * Resuelve un lote de R2 keys de avatar a URLs presigned de lectura.
 * STUB — lanza siempre (RED, 69.3).
 */
export async function resolve_r2_urls(
  _keys: (string | null | undefined)[],
  _deps?: R2ResolverDeps,
): Promise<(string | null)[]> {
  throw new Error('not_implemented: resolve_r2_urls (subtarea 69.3)');
}
