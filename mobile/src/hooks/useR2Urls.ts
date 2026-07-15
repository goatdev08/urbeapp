/**
 * useR2Urls.ts — hook FINO sobre resolve_r2_urls (mobile/src/lib/r2Resolver.ts).
 *
 * STUB RED — subtarea 69.3. Ver mobile/src/hooks/__tests__/useR2Urls.test.tsx
 * para el contrato completo.
 *
 * Contrato objetivo:
 *   useR2Urls(keys, deps?) → { urls, loading }
 *   - urls: (string | null)[] alineado 1:1 con `keys` (mismo orden/longitud).
 *   - loading: true mientras la resolución está en vuelo; false al terminar
 *     (incluso si todas las keys son inválidas o la EF falla — fail-soft).
 *   - Delega TODA la lógica de batch/dedup/fail-soft en resolve_r2_urls; este
 *     hook solo administra el ciclo de vida (estado + re-fetch al cambiar keys).
 *
 * Implementación GREEN pendiente — subtarea 69.3.
 */

import type { R2ResolverDeps } from '@/lib/r2Resolver';

export interface UseR2UrlsResult {
  urls: (string | null)[];
  loading: boolean;
}

/**
 * Resuelve un lote de R2 keys de avatar a URLs presigned de lectura,
 * re-disparando la resolución cuando cambia el lote de keys.
 * STUB — lanza siempre (RED, 69.3).
 */
export function useR2Urls(
  _keys: (string | null | undefined)[],
  _deps?: R2ResolverDeps,
): UseR2UrlsResult {
  throw new Error('not_implemented: useR2Urls (subtarea 69.3)');
}
