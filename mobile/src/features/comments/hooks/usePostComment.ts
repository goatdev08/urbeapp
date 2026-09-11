/**
 * usePostComment — publica un comentario vía la EF post-comment (subtarea
 * 289.7, tarea #289). Fase GREEN — contrato completo y 17 edge cases en
 * mobile/src/features/comments/__tests__/usePostComment.test.tsx.
 *
 * 🔴 SIN prepend optimista (decisión de la subtarea): post() resuelve con el
 * comment tal como lo manda el servidor; el llamador hace
 * useComments().prepend(comment) después. Calca is_working_ref +
 * force_update + getters de useUpdateLeadNote.ts/useModerateAd.ts.
 *
 * 🔴 NO SE DESPRENDE `client.functions.invoke` del cliente (#205).
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { extract_error_code } from '@/lib/supabase/edge-errors';

import type { CommentStatus } from '../types';

export interface PostedComment {
  id: string;
  property_id: string;
  user_id: string;
  body: string;
  /** Solo 'visible' | 'held_for_review' — la EF nunca crea hidden/deleted. */
  status: CommentStatus;
  created_at: string;
}

export interface UsePostCommentOptions {
  /** Llamado tras un 201 exitoso, con el comentario devuelto por la EF. */
  on_posted?: (comment: PostedComment) => void;
  /** Cliente Supabase inyectado (tests); default: el singleton real. */
  supabase?: unknown;
}

export interface UsePostCommentReturn {
  post(body: string): Promise<PostedComment | null>;
  posting: boolean;
  error: string | null;
}

// Copys ancla — coordinados 1:1 con las constantes del RED
// (usePostComment.test.tsx). Cambiar el texto aquí sin cambiarlo allá rompe
// el contrato.
const INVALID_INPUT_MESSAGE = 'Tu comentario no puede estar vacío ni superar 500 caracteres.';
const PROPERTY_NOT_FOUND_MESSAGE = 'Esta propiedad ya no existe.';
const PROPERTY_NOT_ACTIVE_MESSAGE = 'Esta propiedad ya no admite comentarios.';
const UNAUTHENTICATED_MESSAGE = 'Debes iniciar sesión de nuevo para continuar.';
const GENERIC_UNKNOWN_MESSAGE = 'Ocurrió un error. Intenta de nuevo.';
const NETWORK_MESSAGE = 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';

function map_post_comment_error(code: string | undefined): string {
  switch (code) {
    case 'INVALID_INPUT':
      return INVALID_INPUT_MESSAGE;
    case 'PROPERTY_NOT_FOUND':
      return PROPERTY_NOT_FOUND_MESSAGE;
    case 'PROPERTY_NOT_ACTIVE':
      return PROPERTY_NOT_ACTIVE_MESSAGE;
    case 'UNAUTHENTICATED':
      return UNAUTHENTICATED_MESSAGE;
    default:
      return GENERIC_UNKNOWN_MESSAGE;
  }
}

export function usePostComment(property_id: string, opts?: UsePostCommentOptions): UsePostCommentReturn {
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Lazy para que jest.mock intercepte / evita eval a nivel de módulo.
  const get_client = (): any => {
    if (opts?.supabase !== undefined) return opts.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as typeof import('@/lib/supabase/client')).supabase;
  };

  const post = useCallback(
    (body: string): Promise<PostedComment | null> => {
      // Doble envío: una 2ª llamada mientras la 1ª está en vuelo no invoca la EF de nuevo.
      if (is_working_ref.current) {
        return Promise.resolve(null);
      }

      is_working_ref.current = true;
      error_ref.current = null;
      force_update();

      const client = get_client();
      return (
        client.functions.invoke('post-comment', { body: { property_id, body } }) as Promise<{
          data: { comment: PostedComment } | null;
          error: unknown;
        }>
      ).then(
        async ({ data, error }) => {
          is_working_ref.current = false;
          if (error) {
            const code = await extract_error_code(error);
            error_ref.current = map_post_comment_error(code);
            force_update();
            return null;
          }
          error_ref.current = null;
          force_update();
          const comment = data?.comment as PostedComment;
          opts?.on_posted?.(comment);
          return comment;
        },
        // Red/timeout (invoke rechazado): mensaje neutro, nunca el texto crudo en inglés.
        () => {
          is_working_ref.current = false;
          error_ref.current = NETWORK_MESSAGE;
          force_update();
          return null;
        },
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [property_id, opts?.supabase, opts?.on_posted],
  );

  // Getters: posting/error son siempre el valor actual de la ref, incluso sin
  // re-render previo (lectura síncrona del mismo tick — EC-12).
  return useMemo(() => {
    const r: UsePostCommentReturn = {
      post,
      get posting() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;
  }, [post]);
}
