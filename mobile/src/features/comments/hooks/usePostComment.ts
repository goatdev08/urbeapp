/**
 * usePostComment — STUB fase RED (subtarea 289.7, tarea #289). Lanza a
 * propósito; el contrato completo (SEAM, decisiones, edge cases) vive en
 * mobile/src/features/comments/__tests__/usePostComment.test.tsx. El GREEN
 * implementa este archivo.
 */

import type { CommentStatus } from '../types';

export interface PostedComment {
  id: string;
  property_id: string;
  user_id: string;
  body: string;
  /** Solo 'visible' | 'held_for_review' — post-comment/types.ts CommentStatus. */
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

export function usePostComment(
  property_id: string,
  opts?: UsePostCommentOptions,
): UsePostCommentReturn {
  void property_id;
  void opts;
  throw new Error('not_implemented');
}
