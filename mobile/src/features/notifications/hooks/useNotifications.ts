/**
 * useNotifications — centro de notificaciones in-app (módulo 041-M2, tarea
 * #219, subtarea 219.3). El contrato completo (firma exacta, cadenas de
 * query, semántica de mark_read/mark_all_read, 27 edge cases) vive en
 * mobile/src/features/notifications/__tests__/useNotifications.test.tsx — es
 * el archivo que fija el comportamiento; este archivo lo implementa sin
 * renegociarlo.
 *
 * QUERY DE LISTA (sin RPC nueva — notifications_select ya autoriza el SELECT
 * vía `user_id = auth.uid() or public.is_admin()`,
 * supabase/migrations/20260604000008_rls_helpers_and_policies.sql:371-374):
 *
 *   supabase
 *     .from('notifications')
 *     .select(<columnas del contrato>)
 *     .eq('user_id', user.id)          // 🔴 EXPLÍCITO — la policy tiene OR is_admin()
 *     .is('deleted_at', null)
 *     .order('created_at', { ascending: false })
 *     .limit(50)
 *
 * 🔴 Mismo invariante en mark_read/mark_all_read: `notifications_update`
 * lleva la misma cláusula `OR is_admin()`, así que ambos UPDATE también
 * llevan `.eq('user_id', user.id)` explícito (precedente #155 Guardados,
 * useMyAds.ts, memoria flatlist_numcolumns_row_keys).
 *
 * mark_read/mark_all_read: OPTIMISTA con revert exacto en fallo, no-op sin
 * llamada de red cuando no hay nada que cambiar — ver docblock del test para
 * la semántica completa.
 *
 * Patrón ignore/generación calcado de useAdminRevisions.ts (218.1): el
 * `refetch_tick` en las deps del efecto re-arranca la carga y cancela la
 * anterior sin pisar el estado con una respuesta tardía.
 *
 * `client.from(...)` se llama DIRECTO, encadenado, nunca desprendido
 * (memoria supabase_js_metodo_desprendido).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/context';
import { supabase } from '@/lib/supabase/client';

import type { NotificationItem, UseNotificationsResult } from '../types';

const NEUTRAL_ERROR_MESSAGE = 'No se pudieron cargar tus notificaciones. Intenta de nuevo.';

/** Columnas EXACTAS del contrato — ni una de más ni de menos (EC-10). */
const SELECT_COLUMNS =
  'id, type, title, body, deep_link, related_entity_type, related_entity_id, data, read_at, created_at';

export function useNotifications(): UseNotificationsResult {
  const { user } = useAuth();
  const [notifications, set_notifications] = useState<NotificationItem[] | null>(null);
  const [is_loading, set_is_loading] = useState(true);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  // Espejo por ref del estado `notifications`, leído (nunca escrito fuera de
  // este efecto) por mark_read/mark_all_read — evita que esas callbacks
  // dependan del valor de `notifications` en su deps array (el React
  // Compiler no logra preservar esa memoización manual; ver bitácora 219.3)
  // y de paso las mantiene siempre con el dato más reciente sin recrearse en
  // cada fetch. Escribir un ref durante el render está prohibido
  // (react-hooks/refs); por eso la escritura vive en su propio efecto.
  const notifications_ref = useRef<NotificationItem[] | null>(null);
  useEffect(() => {
    notifications_ref.current = notifications;
  }, [notifications]);

  useEffect(() => {
    let ignore = false;

    function run_fetch(user_id: string): void {
      supabase
        .from('notifications')
        .select(SELECT_COLUMNS)
        .eq('user_id', user_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(50)
        .then(
          (res) => {
            if (ignore) return;
            set_is_loading(false);
            // Todo-o-nada: error de PostgREST o `data: null` sin error nunca
            // se traducen en una lista vacía fabricada (EC-21, EC-22).
            if (res.error || res.data === null) {
              set_notifications(null);
              set_error_message(NEUTRAL_ERROR_MESSAGE);
              return;
            }
            set_notifications(res.data as unknown as NotificationItem[]);
            set_error_message(null);
          },
          () => {
            if (ignore) return;
            set_is_loading(false);
            set_notifications(null);
            set_error_message(NEUTRAL_ERROR_MESSAGE);
          },
        );
    }

    function start(): void {
      set_notifications(null);
      set_error_message(null);
      set_is_loading(true);
      const user_id = user?.id;
      if (!user_id) {
        set_is_loading(false);
        return;
      }
      run_fetch(user_id);
    }

    start();

    return () => {
      ignore = true;
    };
  }, [user?.id, refetch_tick]);

  const refetch = useCallback(() => {
    set_refetch_tick((n) => n + 1);
  }, []);

  const mark_read = useCallback(
    async (id: string): Promise<void> => {
      const user_id = user?.id;
      const current = notifications_ref.current;
      if (!current || !user_id) return;
      const target = current.find((n) => n.id === id);
      if (!target || target.read_at !== null) return;

      const now_iso = new Date().toISOString();

      // Local, de inmediato — antes de que la red resuelva (EC-11).
      set_notifications((prev) =>
        prev ? prev.map((n) => (n.id === id ? { ...n, read_at: now_iso } : n)) : prev,
      );

      const { error } = await supabase
        .from('notifications')
        .update({ read_at: now_iso })
        .eq('id', id)
        .eq('user_id', user_id);

      if (error) {
        // Estado veraz: revierte esta notificación a como estaba (EC-15).
        set_notifications((prev) =>
          prev ? prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)) : prev,
        );
      }
    },
    [user?.id],
  );

  const mark_all_read = useCallback(async (): Promise<void> => {
    const user_id = user?.id;
    const current = notifications_ref.current;
    if (!current || !user_id) return;
    const unread_ids = current.filter((n) => n.read_at === null).map((n) => n.id);
    if (unread_ids.length === 0) return;

    const now_iso = new Date().toISOString();
    const unread_id_set = new Set(unread_ids);

    // Local, de inmediato, todo el snapshot de no-leídas (EC-16).
    set_notifications((prev) =>
      prev ? prev.map((n) => (unread_id_set.has(n.id) ? { ...n, read_at: now_iso } : n)) : prev,
    );

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now_iso })
      .is('read_at', null)
      .eq('user_id', user_id);

    if (error) {
      // Estado veraz: revierte SOLO los ids del snapshot (EC-19).
      set_notifications((prev) =>
        prev ? prev.map((n) => (unread_id_set.has(n.id) ? { ...n, read_at: null } : n)) : prev,
      );
    }
  }, [user?.id]);

  const unread_count = notifications ? notifications.filter((n) => n.read_at === null).length : 0;

  return {
    notifications,
    unread_count,
    is_loading,
    error_message,
    refetch,
    mark_read,
    mark_all_read,
  };
}
