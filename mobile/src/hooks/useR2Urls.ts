/**
 * useR2Urls.ts - hook FINO sobre resolve_r2_urls (mobile/src/lib/r2Resolver.ts).
 *
 * Contrato:
 *   useR2Urls(keys, deps?) -> { urls, loading }
 *   - urls: (string | null)[] alineado 1:1 con keys (mismo orden/longitud).
 *   - loading: true mientras la resolucion esta en vuelo; false al terminar
 *     (incluso si todas las keys son invalidas o la EF falla - fail-soft).
 *   - Delega TODA la logica de batch/dedup/fail-soft en resolve_r2_urls; este
 *     hook solo administra el ciclo de vida (estado + re-fetch al cambiar keys).
 *   - Siembra (#263): el estado inicial se calcula con peek_r2_urls(keys) —
 *     si CUBRE todas las keys reales (ninguna null pese a haber key/http
 *     válidos), el primer render ya trae `urls` listas y `loading=false` sin
 *     disparar el efecto de red; si falta alguna, arranca en loading=true
 *     como antes y resolve_r2_urls solo vuelve a pedir las que faltan (la
 *     caché de módulo ya filtra eso internamente).
 *
 * Ver mobile/src/hooks/__tests__/useR2Urls.test.tsx para el contrato completo.
 *
 * Implementacion GREEN - subtarea 69.3. Siembra síncrona desde caché - #263.
 */

import { useEffect, useState } from 'react';

import { resolve_r2_urls, peek_r2_urls } from '@/lib/r2Resolver';
import type { R2ResolverDeps } from '@/lib/r2Resolver';

export interface UseR2UrlsResult {
  urls: (string | null)[];
  loading: boolean;
}

/** true si peek cubre TODAS las keys reales (una key real que resuelve null
 * en peek significa "sin caché válida" — sí hace falta el efecto de red). */
function is_fully_cached(keys: (string | null | undefined)[], peeked: (string | null)[]): boolean {
  return keys.every((key, index) => !key || peeked[index] !== null);
}

function compute_initial_state(keys: (string | null | undefined)[]): UseR2UrlsResult {
  const peeked = peek_r2_urls(keys);
  if (is_fully_cached(keys, peeked)) {
    return { urls: peeked, loading: false };
  }
  return { urls: keys.map(() => null), loading: true };
}

/**
 * Resuelve un lote de R2 keys de avatar a URLs presigned de lectura,
 * re-disparando la resolucion cuando cambia el lote de keys.
 */
export function useR2Urls(
  keys: (string | null | undefined)[],
  deps?: R2ResolverDeps,
): UseR2UrlsResult {
  const [state, set_state] = useState<UseR2UrlsResult>(() => compute_initial_state(keys));

  // Firma estable del lote de keys (separador '|', no aparece en R2 keys reales
  // con forma avatars/<uid>/<uuid>) - un array literal nuevo en cada render del
  // llamador no debe disparar un re-fetch; solo un cambio de CONTENIDO si.
  const keys_signature = keys.map((key) => key ?? '').join('|');

  useEffect(() => {
    let ignore = false;

    resolve_r2_urls(keys, deps).then((urls) => {
      if (ignore) return;
      set_state({ urls, loading: false });
    });

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys_signature, deps?.supabase]);

  return state;
}
