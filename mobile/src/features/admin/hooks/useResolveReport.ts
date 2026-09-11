/**
 * useResolveReport — resolver una propiedad reportada (restore|
 * request_changes|keep_suspended|delete, las 4 acciones NUEVAS de 220.3)
 * desde la cola de reportes del panel admin (módulo 041-M2, tarea #220,
 * subtarea 220.4). Contrato completo y los 22 edge cases están en el
 * docblock de mobile/src/features/admin/__tests__/useResolveReport.test.tsx.
 *
 * Calca useModerateProperty.ts (218.1): is_working_ref + force_update
 * síncrono ANTES del primer await, DI del cliente, run_action,
 * client.functions.invoke SIN desprender, MISMA EF `moderate-property`.
 * extract_error_code + map_revision_error se REUSAN sin cambios (ya GREEN de
 * 218.1) — el mapa sigue conociendo NOTHING_TO_MODERATE aunque esta rama
 * nunca lo emita.
 *
 * 🔴 EL MENSAJE NUNCA SALE DE error.message (#200). extract_error_code lee el
 * código del CUERPO; map_revision_error lo traduce.
 *
 * 🔴 NO SE DESPRENDE `client.functions.invoke` (#205). La llamada va siempre
 * como `client.functions.invoke(...)`.
 *
 * 🔴 NO VALIDA `reason` — solo lo reenvía si vino (nunca manda la clave si
 * está ausente).
 *
 * 🔴 NO DOBLE-SUBMIT, semántica IGNORAR: mientras `is_submitting` es true,
 * una segunda llamada resuelve de inmediato a `{ ok: false, status: null }`
 * SIN invocar la EF ni esperar a la primera — la primera sigue intacta.
 *
 * 🔴 289.6: `resolve()` gana una rama `kind:'comment'` (unión discriminada,
 * `kind` opcional para property → default, backward-compat con los 22 tests
 * vigentes de useResolveReport.test.tsx, que llaman resolve() SIN kind y no
 * se tocan). La rama comment invoca la EF NUEVA `moderate-comment` (nunca
 * `moderate-property`) con body `{comment_id, action, reason?}`. Como esa EF
 * responde `{ok, comment_id, action}` SIN `status` (a diferencia de
 * moderate-property), el `status` de éxito se DERIVA client-side del
 * `action` enviado (mapa `COMMENT_ACTION_STATUS`, valores reales del enum
 * `comment_status`, 20260910100001_comments.sql:49) para conservar
 * `ResolveReportResult` sin cambiarlo. Mismo `extract_error_code` +
 * `map_revision_error` (mapa reusado, se le agregan 3 códigos nuevos en
 * revision_error_messages.ts sin tocar los 7 existentes).
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { extract_error_code } from '@/lib/supabase/edge-errors';

import { map_revision_error } from '../revision_error_messages';

export type ResolveReportAction =
  | 'restore'
  | 'request_changes'
  | 'keep_suspended'
  | 'delete';

export type CommentResolveAction = 'restore' | 'keep_hidden' | 'delete_comment';

export interface ResolvePropertyReportParams {
  kind?: 'property';
  property_id: string;
  action: ResolveReportAction;
  reason?: string;
}

export interface ResolveCommentReportParams {
  kind: 'comment';
  comment_id: string;
  action: CommentResolveAction;
  reason?: string;
}

export type ResolveReportParams = ResolvePropertyReportParams | ResolveCommentReportParams;

/** Status derivado client-side para la rama comment (la EF no lo devuelve). */
const COMMENT_ACTION_STATUS: Record<CommentResolveAction, string> = {
  restore: 'visible',
  keep_hidden: 'hidden',
  delete_comment: 'deleted',
};

export type ResolveReportResult =
  | { ok: true; status: string }
  | { ok: false; status: null };

export interface UseResolveReportDeps {
  /** Cliente Supabase inyectado (en producción: el singleton). */
  supabase?: unknown;
  /** Callback tras éxito — refresca la cola de reportes. */
  onSuccess?: () => void;
}

export interface UseResolveReportReturn {
  resolve(params: ResolveReportParams): Promise<ResolveReportResult>;
  is_submitting: boolean;
  error_message: string | null;
}

/**
 * Resultado interno con el mensaje de error — nunca se expone tal cual;
 * `resolve` lo reduce a `ResolveReportResult` (sin `error`) antes de
 * devolverlo al llamador. El texto vive únicamente en `error_message`.
 */
type InternalResult =
  | { ok: true; status: string }
  | { ok: false; status: null; error_msg: string };

export function useResolveReport(
  deps?: UseResolveReportDeps,
): UseResolveReportReturn {
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
  const invoke_resolve = (body: Record<string, unknown>): Promise<InternalResult> => {
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
   * Invoca `moderate-comment` (rama comment, 289.6) y mapea el resultado.
   * La EF no devuelve `status` — se deriva del `action` enviado.
   */
  const invoke_comment_resolve = (
    body: Record<string, unknown>,
    action: CommentResolveAction,
  ): Promise<InternalResult> => {
    const client = get_client();
    return (
      client.functions.invoke('moderate-comment', { body }) as Promise<{
        data: unknown;
        error: unknown | null;
      }>
    ).then(async ({ data, error }) => {
      if (error) {
        const code = await extract_error_code(error);
        return { ok: false as const, status: null, error_msg: map_revision_error(code) };
      }
      void data;
      return { ok: true as const, status: COMMENT_ACTION_STATUS[action] };
    });
  };

  /**
   * Wrapper SÍNCRONO que fija is_submitting=true antes del primer await. No
   * es async — devuelve la Promise de action() sin añadir una suspensión
   * extra, para que la lectura del mismo tick vea `true`.
   */
  const run_action = (
    action: () => Promise<InternalResult>,
  ): Promise<ResolveReportResult> => {
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

  const resolve = useCallback(
    (params: ResolveReportParams): Promise<ResolveReportResult> => {
      // No doble-submit, semántica IGNORAR: mientras la primera sigue en
      // vuelo, una segunda llamada resuelve de inmediato sin invocar la EF
      // ni tocar el estado de la primera.
      if (is_working_ref.current) {
        return Promise.resolve({ ok: false, status: null });
      }

      // Rama comment (289.6): kind es el discriminante explícito, nunca se
      // infiere de qué campos vinieron — sin kind (o kind:'property') sigue
      // exactamente el camino de siempre, moderate-property.
      if (params.kind === 'comment') {
        const comment_body: Record<string, unknown> = {
          comment_id: params.comment_id,
          action: params.action,
        };
        if (params.reason !== undefined) {
          comment_body.reason = params.reason;
        }

        return run_action(() => invoke_comment_resolve(comment_body, params.action)).then(
          (result) => {
            if (result.ok && deps?.onSuccess) deps.onSuccess();
            return result;
          },
        );
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

      return run_action(() => invoke_resolve(body)).then((result) => {
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
    const r: UseResolveReportReturn = {
      resolve,
      get is_submitting() {
        return is_working_ref.current;
      },
      get error_message() {
        return error_ref.current;
      },
    };
    return r;

  }, [resolve]);
}
