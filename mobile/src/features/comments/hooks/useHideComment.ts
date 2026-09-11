/**
 * useHideComment — UPDATE status-only sobre comments: ocultar/restaurar por
 * el gestor, borrado propio por el autor (subtarea 289.7, tarea #289). Fase
 * GREEN — contrato completo y 12 edge cases en
 * mobile/src/features/comments/__tests__/useHideComment.test.tsx.
 *
 * `set_status` sirve TANTO ocultar/restaurar (gestor) COMO borrado propio
 * (autor→'deleted') — un solo hook, sin validar la regla en cliente (RLS 2ª
 * capa vía WITH CHECK status-only de comments_update). 0 filas (PGRST116) y
 * 42501 se tratan igual: no lanzan, resuelven false, setean error.
 *
 * 🔴 NO SE DESPRENDE `client.from` del cliente (#205).
 */

import { useMemo, useReducer, useRef } from 'react';

export interface UseHideCommentOptions {
  /** Cliente Supabase inyectado (tests); default: el singleton real. */
  supabase?: unknown;
}

export interface UseHideCommentReturn {
  set_status(comment_id: string, status: 'hidden' | 'visible' | 'deleted'): Promise<boolean>;
  busy: boolean;
  error: string | null;
}

const GENERIC_ERROR_MESSAGE = 'No se pudo actualizar el comentario. Intenta de nuevo.';

export function useHideComment(opts?: UseHideCommentOptions): UseHideCommentReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  const get_client = (): any => {
    if (opts?.supabase !== undefined) return opts.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as typeof import('@/lib/supabase/client')).supabase;
  };

  const set_status = (comment_id: string, status: 'hidden' | 'visible' | 'deleted'): Promise<boolean> => {
    is_working_ref.current = true;
    error_ref.current = null;
    force_update();

    const client = get_client();
    return (
      client
        .from('comments')
        .update({ status })
        .eq('id', comment_id)
        .select('id,status')
        .single() as Promise<{ data: unknown; error: { code?: string; message?: string } | null }>
    ).then(
      ({ error }) => {
        is_working_ref.current = false;
        if (error) {
          // PGRST116 (0 filas, RLS bloqueó el UPDATE) y 42501 (permiso
          // denegado) comparten el mismo camino: no lanzan, error propio.
          error_ref.current = GENERIC_ERROR_MESSAGE;
          force_update();
          return false;
        }
        error_ref.current = null;
        force_update();
        return true;
      },
      // Red/timeout (rechazo): mismo camino, nunca se propaga.
      () => {
        is_working_ref.current = false;
        error_ref.current = GENERIC_ERROR_MESSAGE;
        force_update();
        return false;
      },
    );
  };

  return useMemo(() => {
    const r: UseHideCommentReturn = {
      set_status,
      get busy() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.supabase]);
}
