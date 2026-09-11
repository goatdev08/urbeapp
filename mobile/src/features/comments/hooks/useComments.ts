/**
 * useComments — STUB fase RED (subtarea 289.7, tarea #289). Lanza a propósito;
 * el contrato completo (SEAM, decisiones, 21 edge cases) vive en
 * mobile/src/features/comments/__tests__/useComments.test.tsx. El GREEN
 * implementa este archivo.
 */

import type { CommentItem } from '../types';

export interface UseCommentsOptions {
  /** Tamaño de página — default 20 (GREEN). */
  page_size?: number;
  /** Cliente Supabase inyectado (tests); default: el singleton real. */
  supabase?: unknown;
}

export interface UseCommentsReturn {
  items: CommentItem[];
  loading: boolean;
  error: string | null;
  has_more: boolean;
  load_more(): Promise<void>;
  refetch(): Promise<void>;
  remove(id: string): void;
  update(id: string, patch: Partial<CommentItem>): void;
  prepend(item: CommentItem): void;
}

export function useComments(
  property_id: string,
  opts?: UseCommentsOptions,
): UseCommentsReturn {
  void property_id;
  void opts;
  throw new Error('not_implemented');
}
