/**
 * Tipos compartidos de mobile/src/features/comments/** (subtarea 289.7, tarea #289).
 * Fase RED — fijados por los tests de __tests__/*.test.tsx; el GREEN implementa.
 *
 * CommentStatus calca el enum public.comment_status de la migración
 * 20260910100001 (289.2): 'visible' | 'held_for_review' | 'hidden' | 'deleted'.
 * CommentReportReason reusa public.property_report_reason (289.3 NO agrega un enum
 * propio — comment_reports.reason referencia el mismo tipo, ver 20260910200001 §1).
 */

export type CommentStatus = 'visible' | 'held_for_review' | 'hidden' | 'deleted';

export type CommentReportReason =
  | 'not_exist_fraud'
  | 'misleading'
  | 'false_price'
  | 'wrong_address'
  | 'inappropriate'
  | 'duplicate'
  | 'other';

/**
 * Identidad pública del autor, resuelta vía la vista agent_public_profiles
 * (mismas columnas que usePropertyDetail.ts — full_name/profile_photo_url, NO
 * display_name/avatar_url: esos nombres no existen en la vista real, ver
 * supabase/types/database.types.ts:2133-2149). `null` cuando el autor no tiene
 * fila en la vista (usuario eliminado/anonimizado, PRD §26 "Usuario eliminado")
 * — el texto de fallback lo pinta la UI, no este hook.
 */
export interface CommentAuthor {
  full_name: string | null;
  profile_photo_url: string | null;
}

export interface CommentItem {
  id: string;
  property_id: string;
  user_id: string;
  body: string;
  status: CommentStatus;
  created_at: string;
  /** null => "Usuario eliminado" (la UI decide el copy, no este hook). */
  author: CommentAuthor | null;
}
