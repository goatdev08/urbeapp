/**
 * useReportUser — INSERT directo del cliente a user_reports desde el botón
 * «Reportar» de AgentCard (módulo 041-M3, tarea #220, subtarea 220.6 "Reporte
 * de perfil de publicador, alcance mínimo"). Fase GREEN. Contrato completo y
 * los 18 edge cases están en el docblock de
 * mobile/src/features/property-detail/__tests__/useReportUser.test.tsx.
 *
 * Sibling hook de useReportProperty (220.5) — decisión ponytail (subtarea
 * 220.6): NO se generalizó el hook existente a `target: property|user` porque
 * useReportProperty ya está GREEN y mergeado (ActionButtons lo consume en
 * producción); enhebrar una unión discriminada ahí habría tocado código ya
 * probado/desplegado y sus call sites, para ahorrar ~30 líneas de
 * ramificación — MÁS código movido y MÁS riesgo que este archivo sibling, que
 * es aditivo puro y no toca nada existente. El SHEET (ReportPropertySheet) SÍ
 * se reusa sin bifurcar — solo gana un prop `title` opcional.
 *
 * Calca el patrón is_working_ref + force_update + getters de
 * useReportProperty (220.5): is_submitting/error_message se leen SIEMPRE
 * frescos desde la ref (getter sobre el objeto memoizado), sin depender de
 * que haya corrido un re-render — necesario para la lectura SÍNCRONA de EC-13
 * (`act(() => { void submit_report(...) })` sin await).
 *
 * 🔴 DECISIÓN 2026-08-28 (Abraham): NO hay Edge Function — la vía de creación
 * es INSERT DIRECTO del cliente a public.user_reports.
 * reported_by_user_id SIEMPRE sale de la sesión (useAuth), nunca de un
 * parámetro externo (mismo invariante que useReportProperty).
 *
 * 🔴 GUARD DE AUTO-REPORTE (2ª capa — la 1ª es que AgentCard oculta el botón
 * cuando is_self=true): si reported_user_id === user.id de la sesión,
 * submit_report NO llama a la red — resuelve {ok:false} de inmediato con
 * SELF_REPORT_MESSAGE. La 3ª capa es el CHECK SQL user_reports_no_self_report.
 *
 * 🔴 «other» sin texto real se bloquea EN EL CLIENTE antes de la red — mirror
 * boundary del CHECK user_reports_other_requires_text
 * (supabase/tests/76_user_reports_test.sql). El `.trim()` nativo de JS ya
 * recorta whitespace Unicode completo, igual que el CHECK. reason distinto de
 * 'other' nulifica reason_text defensivamente (el sheet solo muestra el campo
 * para 'other').
 *
 * 🔴 NO SE DESPRENDE `client.from` DEL CLIENTE (#205): la llamada va siempre
 * encadenada `client.from('user_reports').insert(...)`, nunca
 * `const { insert } = client.from(...)`.
 */

import { useMemo, useReducer, useRef } from 'react';

import { useAuth } from '@/features/auth/context';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type UserReportReason =
  | 'not_exist_fraud'
  | 'misleading'
  | 'false_price'
  | 'wrong_address'
  | 'inappropriate'
  | 'duplicate'
  | 'other';

export interface UseReportUserParams {
  reported_user_id: string;

  supabase?: any;
}

export interface SubmitUserReportInput {
  reason: UserReportReason;
  reason_text?: string;
}

export type SubmitUserReportResult = { ok: true } | { ok: false };

export interface UseReportUserReturn {
  submit_report(input: SubmitUserReportInput): Promise<SubmitUserReportResult>;
  is_submitting: boolean;
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// Copys ancla — coordinados 1:1 con las constantes del RED
// (useReportUser.test.tsx: DUPLICATE_MESSAGE / SELF_REPORT_MESSAGE /
// OTHER_TEXT_REQUIRED_MESSAGE). Cambiar el texto aquí SIN cambiarlo allá
// rompe el contrato — son la misma decisión de producto en dos archivos.
// ---------------------------------------------------------------------------

const DUPLICATE_MESSAGE = 'Ya reportaste a este usuario.';
const SELF_REPORT_MESSAGE = 'No puedes reportarte a ti mismo.';
const OTHER_TEXT_REQUIRED_MESSAGE = 'Escribe el motivo del reporte.';
const GENERIC_ERROR_MESSAGE = 'No se pudo enviar el reporte. Intenta de nuevo.';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReportUser(params: UseReportUserParams): UseReportUserReturn {
  const { user } = useAuth();
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Lazy para que jest.mock intercepte / evita module-level eval en tests.
  const get_client = (): any => {
    if (params.supabase !== undefined) return params.supabase;
    // `typeof import(...)` y NO `as { supabase: unknown }`: el cast a mano
    // anulaba la verificación de tsc — renombrar el export a uno inexistente
    // dejaba la suite verde Y tsc en 0 (hallazgo del guardian, 220.5).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as typeof import('@/lib/supabase/client')).supabase;
  };

  /** Bloqueo EN CLIENTE (self-report / "other" sin texto) — nunca toca la red. */
  const block = (message: string): Promise<SubmitUserReportResult> => {
    error_ref.current = message;
    force_update();
    return Promise.resolve({ ok: false });
  };

  const submit_report = (input: SubmitUserReportInput): Promise<SubmitUserReportResult> => {
    // Guard de auto-reporte — la 1ª capa ya oculta el botón; esta es la 2ª.
    if (user?.id === params.reported_user_id) {
      return block(SELF_REPORT_MESSAGE);
    }

    // reason_text solo aplica a 'other' (el sheet no muestra el campo para el
    // resto) — se nulifica defensivamente aunque el caller lo mande (EC-12).
    const reason_text = input.reason === 'other' ? (input.reason_text ?? null) : null;

    // "other" exige texto real — mismo trim().length>0 que el CHECK SQL.
    if (input.reason === 'other' && (reason_text === null || reason_text.trim().length === 0)) {
      return block(OTHER_TEXT_REQUIRED_MESSAGE);
    }

    is_working_ref.current = true;
    error_ref.current = null;
    force_update();

    const client = get_client();
    return (
      client.from('user_reports').insert({
        reported_user_id: params.reported_user_id,
        reported_by_user_id: user?.id ?? '',
        reason: input.reason,
        reason_text,
      }) as Promise<{ error: { code?: string; message?: string } | null }>
    ).then(
      ({ error }) => {
        is_working_ref.current = false;
        if (error) {
          error_ref.current = error.code === '23505' ? DUPLICATE_MESSAGE : GENERIC_ERROR_MESSAGE;
          force_update();
          return { ok: false as const };
        }
        error_ref.current = null;
        force_update();
        return { ok: true as const };
      },
      // Red/timeout (insert rechazado): nunca se propaga — mensaje propio,
      // ok:false, is_submitting liberado.
      () => {
        is_working_ref.current = false;
        error_ref.current = GENERIC_ERROR_MESSAGE;
        force_update();
        return { ok: false as const };
      },
    );
  };

  // Getters: is_submitting y error_message son siempre el valor actual de la
  // ref, incluso sin re-render previo (lectura síncrona del mismo tick).
  return useMemo(() => {
    const r: UseReportUserReturn = {
      submit_report,
      get is_submitting() {
        return is_working_ref.current;
      },
      get error_message() {
        return error_ref.current;
      },
    };
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.reported_user_id, params.supabase, user?.id]);
}
