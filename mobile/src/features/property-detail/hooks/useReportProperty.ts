/**
 * useReportProperty — INSERT directo del cliente a property_reports desde el
 * botón «Reportar» del detalle (módulo 041-M2, tarea #220, subtarea 220.5).
 * Fase GREEN. Contrato completo y los 20 edge cases están en el docblock de
 * mobile/src/features/property-detail/__tests__/useReportProperty.test.tsx.
 *
 * Calca el patrón is_working_ref + force_update + getters de
 * useModerateProperty (218.1): is_submitting/error_message se leen SIEMPRE
 * frescos desde la ref (getter sobre el objeto memoizado), sin depender de
 * que haya corrido un re-render — necesario para la lectura SÍNCRONA de EC-16
 * (`act(() => { void submit_report(...) })` sin await).
 *
 * 🔴 DECISIÓN 2026-08-28 (Abraham): NO hay Edge Function — la vía de creación
 * es INSERT DIRECTO del cliente a public.property_reports.
 * reported_by_user_id SIEMPRE sale de la sesión (useAuth), nunca de un
 * parámetro externo (mismo invariante que useSaveProperty/useLikeProperty).
 *
 * 🔴 GUARD DE OWNER (2ª capa, la 1ª es que la UI oculta el botón): si
 * owner_user_id === user.id de la sesión, submit_report NO llama a la red —
 * resuelve {ok:false} de inmediato con OWNER_GUARD_MESSAGE.
 *
 * 🔴 «other» sin texto real se bloquea EN EL CLIENTE antes de la red — mirror
 * boundary del CHECK property_reports_other_requires_text
 * (supabase/tests/73_property_reports_create_test.sql, OTHER1..OTHER6). El
 * `.trim()` nativo de JS ya recorta whitespace Unicode completo, igual que el
 * CHECK. reason distinto de 'other' nulifica reason_text defensivamente
 * (el mockup solo muestra el campo para 'other').
 *
 * 🔴 NO SE DESPRENDE `client.from` DEL CLIENTE (#205): la llamada va siempre
 * encadenada `client.from('property_reports').insert(...)`, nunca
 * `const { insert } = client.from(...)`.
 */

import { useMemo, useReducer, useRef } from 'react';

import { useAuth } from '@/features/auth/context';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type PropertyReportReason =
  | 'not_exist_fraud'
  | 'misleading'
  | 'false_price'
  | 'wrong_address'
  | 'inappropriate'
  | 'duplicate'
  | 'other';

export interface UseReportPropertyParams {
  property_id: string;
  owner_user_id: string;

  supabase?: any;
}

export interface SubmitReportInput {
  reason: PropertyReportReason;
  reason_text?: string;
}

export type SubmitReportResult = { ok: true } | { ok: false };

export interface UseReportPropertyReturn {
  submit_report(input: SubmitReportInput): Promise<SubmitReportResult>;
  is_submitting: boolean;
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// Copys ancla — coordinados 1:1 con las constantes del RED
// (useReportProperty.test.tsx: DUPLICATE_MESSAGE / OWNER_GUARD_MESSAGE /
// OTHER_TEXT_REQUIRED_MESSAGE). Cambiar el texto aquí SIN cambiarlo allá
// rompe el contrato — son la misma decisión de producto en dos archivos.
// ---------------------------------------------------------------------------

const DUPLICATE_MESSAGE = 'Ya reportaste esta publicación.';
const OWNER_GUARD_MESSAGE = 'No puedes reportar tu propia publicación.';
const OTHER_TEXT_REQUIRED_MESSAGE = 'Escribe el motivo del reporte.';
const GENERIC_ERROR_MESSAGE = 'No se pudo enviar el reporte. Intenta de nuevo.';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useReportProperty(
  params: UseReportPropertyParams,
): UseReportPropertyReturn {
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

  /** Bloqueo EN CLIENTE (owner / "other" sin texto) — nunca toca la red. */
  const block = (message: string): Promise<SubmitReportResult> => {
    error_ref.current = message;
    force_update();
    return Promise.resolve({ ok: false });
  };

  const submit_report = (input: SubmitReportInput): Promise<SubmitReportResult> => {
    // Guard de owner — el rail ya oculta el botón; esta es la 2ª capa.
    if (user?.id === params.owner_user_id) {
      return block(OWNER_GUARD_MESSAGE);
    }

    // reason_text solo aplica a 'other' (mockup no muestra el campo para el
    // resto) — se nulifica defensivamente aunque el caller lo mande (EC-13).
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
      client.from('property_reports').insert({
        property_id: params.property_id,
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
    const r: UseReportPropertyReturn = {
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
  }, [params.property_id, params.owner_user_id, params.supabase, user?.id]);
}
