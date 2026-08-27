/**
 * Tipos del centro de notificaciones in-app (módulo 041-M2, tarea #219,
 * subtarea 219.3). El contrato completo (firma exacta, edge cases) vive en
 * mobile/src/features/notifications/__tests__/useNotifications.test.tsx —
 * este archivo NO renegocia esa firma, solo la declara.
 *
 * Columnas de `public.notifications`, migración
 * supabase/migrations/20260604000007_analytics_moderation_audit.sql:56-69.
 */

/** Fila de `public.notifications` tal como la expone el hook al consumidor. */
export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  deep_link: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
}

export interface UseNotificationsResult {
  /** null mientras carga o tras un error — nunca `[]` fabricado (todo-o-nada). */
  notifications: NotificationItem[] | null;
  /** Derivado de `notifications` (filas con `read_at === null`); 0 si `notifications` es null. */
  unread_count: number;
  is_loading: boolean;
  /** Mensaje neutro es-MX; null si no hay error. */
  error_message: string | null;
  /** Vuelve a disparar la query de lista (patrón ignore/generación). */
  refetch: () => void;
  /** Marca una notificación como leída (optimista + revert en fallo — ver docblock del test). */
  mark_read: (id: string) => Promise<void>;
  /** Marca todas las no-leídas como leídas (optimista + revert en fallo). */
  mark_all_read: () => Promise<void>;
}
