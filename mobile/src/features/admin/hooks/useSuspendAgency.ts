/**
 * useSuspendAgency — suspender/reactivar una organización desde el detalle de
 * admin (tarea #211, subtarea 211.2). Contrato completo y los 24 edge cases
 * están en el docblock de
 * mobile/src/features/admin/__tests__/useSuspendAgency.test.tsx.
 *
 * Calca useSetOrgAdvertising (209.3) / useModerateAd (208.2/210.3):
 * is_working_ref + force_update síncrono ANTES del primer await, DI del
 * cliente, run_action, getters en el objeto retornado.
 *
 * 🔴 EL MENSAJE NUNCA SALE DE error.message (#200). extract_error_code lee el
 * código del CUERPO; map_agency_status_error lo traduce.
 *
 * 🔴 NO SE DESPRENDE `client.functions.invoke` (#205). `const { invoke } =
 * client.functions` pierde el `this` y falla MUDO en producción — con la
 * suite en verde si el mock es un objeto plano. La llamada va siempre como
 * `client.functions.invoke(...)`.
 *
 * 🔴 SIN LÓGICA DE ESTADO EN EL HOOK. `reactivate` sobre una organización
 * `pending_approval` dispara una APROBACIÓN completa vía el trigger — es
 * correcto y NO es cosa de este hook decidir ni bloquear (obs. 1 del guardian
 * de 211.1). El hook manda la acción que se le pide; la PANTALLA (211.2,
 * ligera) es quien decide cuándo ofrecer cada botón según `status`.
 *
 * 🔴 NO DOBLE-SUBMIT. `suspend`/`reactivate` comparten un único "en vuelo":
 * mientras `is_working` es true, una segunda llamada (a cualquiera de las
 * dos) NO dispara una segunda invocación de red — se coalesce sobre la
 * MISMA promesa en curso y resuelve al mismo resultado (EC-22/23). `finish`
 * (onSuccess) vive DENTRO de `run_action`, no en un `.then` externo por
 * llamador, para que una llamada coalescida no dispare onSuccess dos veces.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { extract_error_code } from '@/lib/supabase/edge-errors';

import { map_agency_status_error } from '../agency_status_error_messages';

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

export function useSuspendAgency(deps?: UseSuspendAgencyDeps): UseSuspendAgencyReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  /** Promesa en vuelo actual — coalesce una segunda llamada mientras dura. */
  const in_flight_ref = useRef<Promise<SuspendAgencyResult> | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Lazy para que jest.mock intercepte.
  const get_client = (): any => {
    if (deps?.supabase) return deps.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  /** Invoca la EF y mapea el resultado a SuspendAgencyResult. No gestiona is_working. */
  const invoke_suspend = (body: Record<string, unknown>): Promise<SuspendAgencyResult> => {
    const client = get_client();
    return (
      client.functions.invoke('suspend-agency', { body }) as Promise<{
        data: unknown;
        error: unknown | null;
      }>
    ).then(async ({ data, error }) => {
      if (error) {
        const code = await extract_error_code(error);
        return { ok: false as const, status: null, error: map_agency_status_error(code) };
      }
      const status = (data as { status?: 'active' | 'suspended' } | null)?.status ?? null;
      return { ok: true as const, status, error: null };
    });
  };

  /**
   * Wrapper SÍNCRONO que fija is_working=true antes del primer await y
   * coalesce llamadas concurrentes sobre la misma promesa en vuelo. No es
   * async — devuelve la Promise de action() (o la en vuelo) sin añadir una
   * suspensión extra, para que la lectura del mismo tick vea `true`.
   */
  const run_action = (action: () => Promise<SuspendAgencyResult>): Promise<SuspendAgencyResult> => {
    if (is_working_ref.current && in_flight_ref.current) {
      return in_flight_ref.current;
    }

    is_working_ref.current = true;
    error_ref.current = null;
    force_update();

    const promise = action().then(
      (result) => {
        is_working_ref.current = false;
        error_ref.current = result.error;
        force_update();
        if (result.ok && deps?.onSuccess) deps.onSuccess();
        in_flight_ref.current = null;
        return result;
      },
      // Red/timeout (invoke rechazado): mensaje neutro en español, jamás
      // err.message — map_agency_status_error(undefined) es exactamente ese
      // mensaje, el mismo camino que un código no parseable.
      (err: unknown) => {
        void err;
        const msg = map_agency_status_error(undefined);
        is_working_ref.current = false;
        error_ref.current = msg;
        force_update();
        in_flight_ref.current = null;
        return { ok: false as const, status: null, error: msg };
      },
    );

    in_flight_ref.current = promise;
    return promise;
  };

  const suspend = useCallback(
    (agency_id: string): Promise<SuspendAgencyResult> =>
      run_action(() => invoke_suspend({ agency_id, action: 'suspend' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  const reactivate = useCallback(
    (agency_id: string): Promise<SuspendAgencyResult> =>
      run_action(() => invoke_suspend({ agency_id, action: 'reactivate' })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  // Getters: is_working y error son siempre el valor actual de la ref,
  // incluso sin re-render previo (lectura síncrona del mismo tick).
  return useMemo(() => {
    const r: UseSuspendAgencyReturn = {
      suspend,
      reactivate,
      get is_working() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;

  }, [suspend, reactivate]);
}
