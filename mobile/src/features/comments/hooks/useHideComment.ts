/**
 * useHideComment — STUB fase RED (subtarea 289.7, tarea #289). Lanza a
 * propósito; el contrato completo (SEAM, decisiones, edge cases) vive en
 * mobile/src/features/comments/__tests__/useHideComment.test.tsx. El GREEN
 * implementa este archivo.
 */

export interface UseHideCommentOptions {
  /** Cliente Supabase inyectado (tests); default: el singleton real. */
  supabase?: unknown;
}

/**
 * status-only UPDATE sobre comments (comments_update, 20260910100001 §5): el
 * gestor alterna 'hidden'/'visible' libremente; el autor SOLO puede pasar su
 * propio comentario a 'deleted' (mismo hook cubre el borrado propio, ver
 * contrato de la subtarea, punto 5).
 */
export interface UseHideCommentReturn {
  set_status(comment_id: string, status: 'hidden' | 'visible' | 'deleted'): Promise<boolean>;
  busy: boolean;
  error: string | null;
}

export function useHideComment(opts?: UseHideCommentOptions): UseHideCommentReturn {
  void opts;
  throw new Error('not_implemented');
}
