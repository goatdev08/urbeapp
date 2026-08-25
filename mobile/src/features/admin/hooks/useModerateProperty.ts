/**
 * useModerateProperty — moderar una revisión de edición o una publicación
 * inicial (approve|needs_changes|reject) desde la cola de revisiones del
 * panel admin (módulo 041-M1, tarea #218, subtarea 218.1). Fase RED. Contrato
 * completo y los 19 edge cases están en el docblock de
 * mobile/src/features/admin/__tests__/useModerateProperty.test.tsx.
 *
 * Calca useSetOrgAdvertising (209.3) / useSuspendAgency (211.2):
 * is_working_ref + force_update síncrono ANTES del primer await, DI del
 * cliente, run_action, getters en el objeto retornado.
 *
 * 🔴 EL MENSAJE NUNCA SALE DE error.message (#200). extract_error_code lee el
 * código del CUERPO; map_revision_error lo traduce.
 *
 * 🔴 NO SE DESPRENDE `client.functions.invoke` (#205). `const { invoke } =
 * client.functions` pierde el `this` y falla MUDO en producción — con la
 * suite en verde si el mock es un objeto plano. La llamada va siempre como
 * `client.functions.invoke(...)`.
 *
 * 🔴 NO VALIDA `reason` — la UI lo exige para needs_changes/reject; el hook
 * solo lo reenvía si vino (nunca manda la clave si está ausente).
 *
 * 🔴 NO DOBLE-SUBMIT, semántica IGNORAR (distinta de useSuspendAgency, que
 * COALESCE): mientras `is_submitting` es true, una segunda llamada resuelve
 * de inmediato a `{ ok: false, status: null }` SIN invocar la EF ni esperar a
 * la primera — la primera sigue intacta.
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { extract_error_code } from '@/lib/supabase/edge-errors';

import { map_revision_error } from '../revision_error_messages';

export type ModeratePropertyAction = 'approve' | 'needs_changes' | 'reject';

export interface ModeratePropertyParams {
  property_id: string;
  action: ModeratePropertyAction;
  reason?: string;
}

export type ModeratePropertyResult =
  | { ok: true; status: string }
  | { ok: false; status: null };

export interface UseModeratePropertyDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — refresca la cola de revisiones. */
  onSuccess?: () => void;
}

export interface UseModeratePropertyReturn {
  moderate(params: ModeratePropertyParams): Promise<ModeratePropertyResult>;
  is_submitting: boolean;
  error_message: string | null;
}

/**
 * Resultado interno con el mensaje de error — nunca se expone tal cual;
 * `moderate` lo reduce a `ModeratePropertyResult` (sin `error`) antes de
 * devolverlo al llamador. El texto vive únicamente en `error_message`.
 */
type InternalResult =
  | { ok: true; status: string }
  | { ok: false; status: null; error_msg: string };

export function useModerateProperty(
  deps?: UseModeratePropertyDeps,
): UseModeratePropertyReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Lazy para que jest.mock intercepte.
  const get_client = (): any => {
    if (deps?.supabase) return deps.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  /** Invoca la EF y mapea el resultado. No gestiona is_submitting. */
  const invoke_moderate = (body: Record<string, unknown>): Promise<InternalResult> => {
    const client = get_client();
    return (
      client.functions.invoke('moderate-property', { body }) as Promise<{
        data: unknown;
        error: unknown | null;
      }>
    ).then(async ({ data, error }) => {
      if (error) {
        const code = await extract_error_code(error);
        return { ok: false as const, status: null, error_msg: map_revision_error(code) };
      }
      const status = (data as { status?: string } | null)?.status ?? '';
      return { ok: true as const, status };
    });
  };

  /**
   * Wrapper SÍNCRONO que fija is_submitting=true antes del primer await. No
   * es async — devuelve la Promise de action() sin añadir una suspensión
   * extra, para que la lectura del mismo tick vea `true`.
   */
  const run_action = (
    action: () => Promise<InternalResult>,
  ): Promise<ModeratePropertyResult> => {
    is_working_ref.current = true;
    error_ref.current = null;
    force_update();

    return action().then(
      (result) => {
        is_working_ref.current = false;
        if (result.ok) {
          error_ref.current = null;
          force_update();
          return { ok: true as const, status: result.status };
        }
        error_ref.current = result.error_msg;
        force_update();
        return { ok: false as const, status: null };
      },
      // Red/timeout (invoke rechazado): mensaje neutro en español, jamás
      // err.message — map_revision_error(undefined) es exactamente ese
      // mensaje, el mismo camino que un código no parseable.
      (err: unknown) => {
        void err;
        const msg = map_revision_error(undefined);
        is_working_ref.current = false;
        error_ref.current = msg;
        force_update();
        return { ok: false as const, status: null };
      },
    );
  };

  const moderate = useCallback(
    (params: ModeratePropertyParams): Promise<ModeratePropertyResult> => {
      // No doble-submit, semántica IGNORAR (distinta de useSuspendAgency, que
      // coalesce): mientras la primera sigue en vuelo, una segunda llamada
      // resuelve de inmediato sin invocar la EF ni tocar el estado de la
      // primera.
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, status: null });
      }

      const body: Record<string, unknown> = {
        property_id: params.property_id,
        action: params.action,
      };
      // El hook no valida `reason`; solo lo reenvía si vino — nunca manda la
      // clave si está ausente (la UI decide cuándo es obligatorio).
      if (params.reason !== undefined) {
        body.reason = params.reason;
      }

      return run_action(() => invoke_moderate(body)).then((result) => {
        if (result.ok && deps?.onSuccess) deps.onSuccess();
        return result;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  // Getters: is_submitting y error_message son siempre el valor actual de la
  // ref, incluso sin re-render previo (lectura síncrona del mismo tick).
  return useMemo(() => {
    const r: UseModeratePropertyReturn = {
      moderate,
      get is_submitting() {
        return is_working_ref.current;
      },
      get error_message() {
        return error_ref.current;
      },
    };
    return r;

  }, [moderate]);
}
