/**
 * useModerateAd — aprobar/rechazar un anuncio en revisión (tarea #208,
 * subtarea 208.2). Contrato completo y los 20 edge cases están en el docblock
 * de mobile/src/features/ads/__tests__/useModerateAd.test.tsx.
 *
 * Calca useUpdateLeadStatus (75.6): is_working_ref + force_update síncrono ANTES
 * del primer await, DI del cliente, run_action, getters en el objeto retornado.
 *
 * 🔴 EL MENSAJE NUNCA SALE DE error.message (#200). extract_error_code lee el
 * código del CUERPO; map_ad_moderation_error lo traduce. Ver el docblock de
 * ad_moderation_error_messages.ts.
 *
 * 🔴 NO SE DESPRENDE `client.functions.invoke` (#205). `const { invoke } =
 * client.functions` pierde el `this` y falla MUDO en producción — con la suite
 * en verde si el mock es un objeto plano (nota supabase_js_metodo_desprendido).
 * La llamada va siempre como `client.functions.invoke(...)`.
 *
 * 🔴 EL PAYLOAD LO GOBIERNA EL CHECK BIDIRECCIONAL DE LA BASE.
 * `ads_rejection_reason_matches_status` exige `(status='rejected') ===
 * (rejection_reason is not null)`: aprobar NO manda `rejection_reason` (ni
 * siquiera como null explícito) y rechazar SIEMPRE lo manda.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { extract_error_code } from '@/lib/supabase/edge-errors';

import { map_ad_moderation_error } from '../ad_moderation_error_messages';

export interface ModerateResult {
  ok: boolean;
  error: string | null;
}

export interface UseModerateAdDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — 208.3 le pasa el refetch de usePendingAds. */
  onSuccess?: () => void;
}

export interface UseModerateAdReturn {
  approve(ad_id: string): Promise<ModerateResult>;
  reject(ad_id: string, rejection_reason: string): Promise<ModerateResult>;
  is_moderating: boolean;
  error: string | null;
}

export function useModerateAd(deps?: UseModerateAdDeps): UseModerateAdReturn {
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
   * Wrapper SÍNCRONO que fija is_moderating=true antes del primer await. No es
   * async — devuelve la Promise de action() sin añadir una suspensión extra,
   * para que la lectura del mismo tick vea `true`.
   */
  const run_action = (action: () => Promise<ModerateResult>): Promise<ModerateResult> => {
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
      // err.message — map_ad_moderation_error(undefined) es exactamente ese
      // mensaje, el mismo camino que un código no parseable.
      (err: unknown) => {
        void err;
        const msg = map_ad_moderation_error(undefined);
        is_working_ref.current = false;
        error_ref.current = msg;
        force_update();
        return { ok: false as const, error: msg };
      },
    );
  };

  /** Invoca la EF y mapea el resultado a {ok, error}. No gestiona is_moderating. */
  const invoke_moderate = (body: Record<string, unknown>): Promise<ModerateResult> => {
    const client = get_client();
    return (
      client.functions.invoke('moderate-ad', { body }) as Promise<{
        data: unknown;
        error: unknown | null;
      }>
    ).then(async ({ error }) => {
      if (error) {
        const code = await extract_error_code(error);
        return { ok: false as const, error: map_ad_moderation_error(code) };
      }
      return { ok: true as const, error: null };
    });
  };

  const finish = (result: ModerateResult): ModerateResult => {
    if (result.ok && deps?.onSuccess) deps.onSuccess();
    return result;
  };

  const approve = useCallback(
    (ad_id: string): Promise<ModerateResult> =>
      run_action(() => invoke_moderate({ ad_id, action: 'approve' })).then(finish),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  const reject = useCallback(
    (ad_id: string, rejection_reason: string): Promise<ModerateResult> => {
      // Guard local: un motivo vacío terminaría en 400 REJECTION_REASON_REQUIRED.
      // Duplicar el guard de la EF en el lado barato le ahorra al admin el viaje
      // y le da el aviso inmediato. NO sustituye al de la EF ni al CHECK.
      const trimmed = (rejection_reason ?? '').trim();
      if (trimmed.length === 0) {
        const msg = map_ad_moderation_error('REJECTION_REASON_REQUIRED');
        is_working_ref.current = false;
        error_ref.current = msg;
        force_update();
        return Promise.resolve({ ok: false, error: msg });
      }

      return run_action(() =>
        invoke_moderate({ ad_id, action: 'reject', rejection_reason: trimmed }),
      ).then(finish);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  // Getters: is_moderating y error son siempre el valor actual de la ref,
  // incluso sin re-render previo (lectura síncrona del mismo tick).
  return useMemo(() => {
    const r: UseModerateAdReturn = {
      approve,
      reject,
      get is_moderating() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;
     
  }, [approve, reject]);
}
