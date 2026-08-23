/**
 * useSetOrgAdvertising — encender/apagar el modo comercial de una organización
 * desde el detalle de admin (tarea #209, subtarea 209.3). Contrato completo y
 * los 19 edge cases están en el docblock de
 * mobile/src/features/admin/__tests__/useSetOrgAdvertising.test.tsx.
 *
 * Calca useModerateAd (208.2): is_working_ref + force_update síncrono ANTES
 * del primer await, DI del cliente, run_action, getters en el objeto retornado.
 *
 * 🔴 EL MENSAJE NUNCA SALE DE error.message (#200). extract_error_code lee el
 * código del CUERPO; map_org_advertising_error lo traduce.
 *
 * 🔴 NO SE DESPRENDE `client.functions.invoke` (#205). `const { invoke } =
 * client.functions` pierde el `this` y falla MUDO en producción — con la
 * suite en verde si el mock es un objeto plano. La llamada va siempre como
 * `client.functions.invoke(...)`.
 *
 * 🔴 EL BODY LO GOBIERNA LA EF/DB, no este hook: `category` solo se manda
 * cuando enabled=true, y nunca cuando enabled=false (aunque el llamador la
 * pase por error) — el hook no decide cuándo es obligatoria.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { extract_error_code } from '@/lib/supabase/edge-errors';

import { map_org_advertising_error } from '../org_advertising_error_messages';
import type { AdvertiserCategory } from '../components/advertiser-category-select';

export interface SetOrgAdvertisingParams {
  agency_id: string;
  enabled: boolean;
  category?: AdvertiserCategory;
}

export interface SetOrgAdvertisingResult {
  ok: boolean;
  error: string | null;
}

export interface UseSetOrgAdvertisingDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — 209.3 refresca el detalle de organización. */
  onSuccess?: () => void;
}

export interface UseSetOrgAdvertisingReturn {
  setAdvertising(params: SetOrgAdvertisingParams): Promise<SetOrgAdvertisingResult>;
  is_saving: boolean;
  error: string | null;
}

export function useSetOrgAdvertising(deps?: UseSetOrgAdvertisingDeps): UseSetOrgAdvertisingReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Lazy para que jest.mock intercepte.

  const get_client = (): any => {
    if (deps?.supabase) return deps.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  /**
   * Wrapper SÍNCRONO que fija is_saving=true antes del primer await. No es
   * async — devuelve la Promise de action() sin añadir una suspensión extra,
   * para que la lectura del mismo tick vea `true`.
   */
  const run_action = (
    action: () => Promise<SetOrgAdvertisingResult>,
  ): Promise<SetOrgAdvertisingResult> => {
    is_working_ref.current = true;
    error_ref.current = null;
    force_update();

    return action().then(
      (result) => {
        is_working_ref.current = false;
        error_ref.current = result.error;
        force_update();
        return result;
      },
      // Red/timeout (invoke rechazado): mensaje neutro en español, jamás
      // err.message — map_org_advertising_error(undefined) es exactamente ese
      // mensaje, el mismo camino que un código no parseable.
      (err: unknown) => {
        void err;
        const msg = map_org_advertising_error(undefined);
        is_working_ref.current = false;
        error_ref.current = msg;
        force_update();
        return { ok: false as const, error: msg };
      },
    );
  };

  /** Invoca la EF y mapea el resultado a {ok, error}. No gestiona is_saving. */
  const invoke_set_advertising = (
    body: Record<string, unknown>,
  ): Promise<SetOrgAdvertisingResult> => {
    const client = get_client();
    return (
      client.functions.invoke('set-org-advertising', { body }) as Promise<{
        data: unknown;
        error: unknown | null;
      }>
    ).then(async ({ error }) => {
      if (error) {
        const code = await extract_error_code(error);
        return { ok: false as const, error: map_org_advertising_error(code) };
      }
      return { ok: true as const, error: null };
    });
  };

  const finish = (result: SetOrgAdvertisingResult): SetOrgAdvertisingResult => {
    if (result.ok && deps?.onSuccess) deps.onSuccess();
    return result;
  };

  const setAdvertising = useCallback(
    ({ agency_id, enabled, category }: SetOrgAdvertisingParams): Promise<SetOrgAdvertisingResult> => {
      const body: Record<string, unknown> = { agency_id, enabled };
      // Apagar nunca manda category, aunque el llamador la pase por error —
      // este hook no tiene autoridad para decidir cuándo es obligatoria.
      if (enabled && category !== undefined) {
        body.category = category;
      }
      return run_action(() => invoke_set_advertising(body)).then(finish);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  // Getters: is_saving y error son siempre el valor actual de la ref, incluso
  // sin re-render previo (lectura síncrona del mismo tick).
  return useMemo(() => {
    const r: UseSetOrgAdvertisingReturn = {
      setAdvertising,
      get is_saving() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;

  }, [setAdvertising]);
}
