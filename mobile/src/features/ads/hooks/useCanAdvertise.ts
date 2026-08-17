/**
 * useCanAdvertise — STUB mínimo (fase RED, subtarea 169.8).
 *
 * Contrato objetivo (fijado por
 * mobile/src/features/ads/__tests__/useCanAdvertise.test.tsx — ver el
 * docblock de ese archivo para la enumeración completa de casos y el
 * contrato exacto de queries):
 *
 *   useCanAdvertise(): { can_advertise: boolean; loading: boolean }
 *
 * Este archivo NO implementa lógica — es el seam mínimo para que los tests
 * fallen por ASERCIÓN (contrato incumplido) y no por import roto. La
 * implementación real (GREEN) reemplaza este `throw`.
 */

export interface UseCanAdvertiseResult {
  /**
   * true SOLO cuando el caller es owner/admin ACTIVO de una organización con
   * `agencies.can_advertise = true`, `deleted_at is null` y
   * `status = 'active'` — las MISMAS 4 causas que
   * `private.org_can_advertise` (20260815000001), porque RLS NO esconde una
   * agencia suspendida/soft-deleted de su propio manager (policy
   * `agencies_select`, cláusula `manages_agency`): el filtro es
   * responsabilidad de este hook. Fail-closed en cualquier otra condición —
   * incluida la ausencia de schema en el backend (columna o tabla que
   * todavía no existe porque 168–172 no se ha desplegado aún, ver
   * CLAUDE.md §0.5 y la subtarea 169.8).
   */
  can_advertise: boolean;
  /** true mientras se resuelve la capacidad. Nunca deja can_advertise=true mientras loading=true. */
  loading: boolean;
}

export function useCanAdvertise(): UseCanAdvertiseResult {
  throw new Error('not_implemented');
}
