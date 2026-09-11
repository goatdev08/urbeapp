/**
 * useReportComment — INSERT directo del cliente a comment_reports (subtarea
 * 289.7, tarea #289). Calco de useReportProperty.ts (property-detail/hooks,
 * 220.5) adaptado a comment_reports. Fase GREEN — contrato completo y 17
 * edge cases en mobile/src/features/comments/__tests__/useReportComment.test.tsx.
 *
 * 🔴 SIN guard de "no reportar lo propio" EN EL CLIENTE (a diferencia de
 * useReportProperty): comment_reports no guarda el autor del comentario, así
 * que el INSERT se intenta siempre y el 42501 del WITH CHECK
 * (comment_reports_insert) se mapea a un mensaje propio DESPUÉS de la red.
 *
 * 🔴 NO SE DESPRENDE `client.from` del cliente (#205): la llamada va siempre
 * encadenada `client.from('comment_reports').insert(...)`.
 */

import { useMemo, useReducer, useRef } from 'react';

import { useAuth } from '@/features/auth/context';

import type { CommentReportReason } from '../types';

export interface UseReportCommentOptions {
  /** Cliente Supabase inyectado (tests); default: el singleton real. */
  supabase?: unknown;
}

export interface SubmitCommentReportInput {
  reason: CommentReportReason;
  reason_text?: string;
}

export type SubmitCommentReportResult = { ok: true } | { ok: false };

export interface UseReportCommentReturn {
  report(comment_id: string, reason: CommentReportReason, reason_text?: string): Promise<SubmitCommentReportResult>;
  reporting: boolean;
  error: string | null;
  reported: boolean;
}

// Copys ancla — coordinados 1:1 con las constantes del RED (useReportComment.test.tsx).
const DUPLICATE_MESSAGE = 'Ya reportaste este comentario.';
const SELF_REPORT_MESSAGE = 'No puedes reportar tu propio comentario.';
const OTHER_TEXT_REQUIRED_MESSAGE = 'Escribe el motivo del reporte.';
const GENERIC_ERROR_MESSAGE = 'No se pudo enviar el reporte. Intenta de nuevo.';

export function useReportComment(opts?: UseReportCommentOptions): UseReportCommentReturn {
  const { user } = useAuth();
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const reported_ref = useRef(false);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  const get_client = (): any => {
    if (opts?.supabase !== undefined) return opts.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as typeof import('@/lib/supabase/client')).supabase;
  };

  /** Bloqueo EN CLIENTE ("other" sin texto) — nunca toca la red. */
  const block = (message: string): Promise<SubmitCommentReportResult> => {
    is_working_ref.current = false;
    error_ref.current = message;
    force_update();
    return Promise.resolve({ ok: false });
  };

  const report = (
    comment_id: string,
    reason: CommentReportReason,
    reason_text?: string,
  ): Promise<SubmitCommentReportResult> => {
    is_working_ref.current = true;
    error_ref.current = null;
    reported_ref.current = false;
    force_update();

    // reason_text solo aplica a 'other' — se nulifica defensivamente aunque
    // el caller lo mande (EC-11). Sin trim: viaja tal cual (EC-3).
    const text = reason === 'other' ? (reason_text ?? null) : null;

    if (reason === 'other' && (text === null || text.trim().length === 0)) {
      return block(OTHER_TEXT_REQUIRED_MESSAGE);
    }

    const client = get_client();
    return (
      client.from('comment_reports').insert({
        comment_id,
        reported_by_user_id: user?.id ?? '',
        reason,
        reason_text: text,
      }) as Promise<{ error: { code?: string; message?: string } | null }>
    ).then(
      ({ error }) => {
        is_working_ref.current = false;
        if (error) {
          error_ref.current =
            error.code === '23505'
              ? DUPLICATE_MESSAGE
              : error.code === '42501'
                ? SELF_REPORT_MESSAGE
                : GENERIC_ERROR_MESSAGE;
          force_update();
          return { ok: false as const };
        }
        error_ref.current = null;
        reported_ref.current = true;
        force_update();
        return { ok: true as const };
      },
      // Red/timeout (insert rechazado): nunca se propaga.
      () => {
        is_working_ref.current = false;
        error_ref.current = GENERIC_ERROR_MESSAGE;
        force_update();
        return { ok: false as const };
      },
    );
  };

  return useMemo(() => {
    const r: UseReportCommentReturn = {
      report,
      get reporting() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
      get reported() {
        return reported_ref.current;
      },
    };
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.supabase, user?.id]);
}
