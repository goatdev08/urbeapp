/**
 * useReportComment — STUB fase RED (subtarea 289.7, tarea #289). Calco de
 * useReportProperty.ts (property-detail/hooks) adaptado a comment_reports —
 * lanza a propósito; el contrato completo (SEAM, decisiones, edge cases) vive
 * en mobile/src/features/comments/__tests__/useReportComment.test.tsx. El
 * GREEN implementa este archivo.
 */

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

export function useReportComment(opts?: UseReportCommentOptions): UseReportCommentReturn {
  void opts;
  throw new Error('not_implemented');
}
