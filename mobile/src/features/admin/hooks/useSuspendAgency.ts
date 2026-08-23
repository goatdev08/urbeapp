/**
 * useSuspendAgency — STUB fase RED (subtarea 211.2).
 *
 * Stub mínimo para que los tests de la fase RED fallen por ASERCIÓN, no por
 * import roto. No contiene lógica de negocio:
 *   - suspend/reactivate: NO invocan functions.invoke, NO llaman onSuccess,
 *     devuelven siempre {ok:false, status:null, error:'not_implemented'}.
 *   - is_working: siempre false (los EC de estado que exigen la transición
 *     true→false fallan).
 *   - error: null estático (los EC que exigen error expuesto tras fallo fallan).
 *
 * La implementación GREEN calcará useSetOrgAdvertising.ts (209.3) /
 * useModerateAd.ts (208.2/210.3): is_working_ref + force_update síncrono ANTES
 * del primer await, DI del cliente vía get_client() lazy, run_action que
 * coalesce una segunda llamada mientras la primera sigue en vuelo (sin
 * disparar una segunda invocación), invoke_suspend() que llama
 * client.functions.invoke('suspend-agency', {body}) y mapea con
 * map_agency_status_error, onSuccess llamado solo en éxito.
 */

export interface SuspendAgencyResult {
  ok: boolean;
  /** Estado resultante que devuelve la EF en éxito; null si no hubo éxito. */
  status: 'active' | 'suspended' | null;
  error: string | null;
}

export interface UseSuspendAgencyDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito (p.ej. refetch del detalle de organización). */
  onSuccess?: () => void;
}

export interface UseSuspendAgencyReturn {
  /** Invoca la EF suspend-agency con action='suspend'. */
  suspend(agency_id: string): Promise<SuspendAgencyResult>;
  /** Invoca la EF suspend-agency con action='reactivate'. */
  reactivate(agency_id: string): Promise<SuspendAgencyResult>;
  /** true mientras una invocación está en vuelo, false en reposo. */
  is_working: boolean;
  /** null tras éxito; string en español tras fallo. */
  error: string | null;
}

export function useSuspendAgency(_deps?: UseSuspendAgencyDeps): UseSuspendAgencyReturn {
  // STUB: valores deliberadamente incorrectos — ver docblock.
  const not_implemented = async (_agency_id: string): Promise<SuspendAgencyResult> => {
    // ponytail: stub — sin lógica, solo para forzar fallo por aserción.
    return { ok: false, status: null, error: 'not_implemented' };
  };

  return {
    suspend: not_implemented,
    reactivate: not_implemented,
    is_working: false,
    error: null,
  };
}
