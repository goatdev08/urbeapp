/**
 * useNotifications — centro de notificaciones in-app (módulo 041-M2, tarea
 * #219, subtarea 219.3; badge real + mark_all_read/deleted_at en 223.3). El
 * contrato completo (firma exacta, cadenas de query, semántica de
 * mark_read/mark_all_read, 36+ edge cases) vive en
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
 * QUERY DE CABECERA (223.3 — `unread_count` YA NO se deriva del arreglo de
 * lista, capado por `.limit(50)`: con más de 50 no-leídas el badge mentía y
 * `mark_all_read` solo cubría la primera página). Va SIEMPRE junto a la
 * query de lista, en paralelo, dentro del mismo efecto — `notifications_
 * unread_idx` existe exactamente para esta query:
 *
 *   supabase
 *     .from('notifications')
 *     .select('id', { count: 'exact', head: true })
 *     .eq('user_id', user.id)          // 🔴 mismo invariante que la lista
 *     .is('deleted_at', null)
 *     .is('read_at', null)
 *
 * 🔴 Mismo invariante en mark_read/mark_all_read: `notifications_update`
 * lleva la misma cláusula `OR is_admin()`, así que ambos UPDATE también
 * llevan `.eq('user_id', user.id)` explícito (precedente #155 Guardados,
 * useMyAds.ts, memoria flatlist_numcolumns_row_keys). El UPDATE de
 * mark_all_read además lleva `.is('deleted_at', null)` — igual que el
 * SELECT — para no estampar `read_at` sobre notificaciones borradas
 * (defecto (b), code review PR #106).
 *
 * mark_read/mark_all_read: OPTIMISTA con revert exacto en fallo, no-op sin
 * llamada de red cuando no hay nada que cambiar. El optimismo opera sobre el
 * conteo de CABECERA (`unread_count`, estado propio) — nunca sobre una
 * recomputación desde el arreglo capado — con revert al valor previo EXACTO
 * en fallo. Si SOLO la query de cabecera falla (la lista carga bien), el
 * conteo CAE A 0 (valor seguro, nunca sobreestima el badge) sin tocar
 * `error_message` — ver docblock del test (223.3, EC-35) para la decisión
 * completa.
 *
 * Patrón ignore/generación calcado de useAdminRevisions.ts (218.1): el
 * `refetch_tick` en las deps del efecto re-arranca ambas cargas (lista y
 * cabecera) y cancela las anteriores sin pisar el estado con una respuesta
 * tardía.
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
  const [unread_count, set_unread_count] = useState(0);
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

  // Mismo patrón de espejo (223.3) para el conteo de cabecera: mark_read y
  // mark_all_read necesitan el valor previo EXACTO para revertir en fallo,
  // sin depender de `unread_count` en su deps array.
  const unread_count_ref = useRef(0);
  useEffect(() => {
    unread_count_ref.current = unread_count;
  }, [unread_count]);

  useEffect(() => {
    let ignore = false;

    function run_fetch_list(user_id: string): void {
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

    // Query de CABECERA (223.3) — independiente de `.limit(50)`, nunca
    // miente con más de 50 no-leídas. Fallo aislado (lista bien, cabecera
    // mal) cae a 0 sin tocar `error_message` (EC-35).
    function run_fetch_count(user_id: string): void {
      supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user_id)
        .is('deleted_at', null)
        .is('read_at', null)
        .then(
          (res: { count: number | null; error: unknown }) => {
            if (ignore) return;
            set_unread_count(res.error || res.count === null ? 0 : res.count);
          },
          () => {
            if (ignore) return;
            set_unread_count(0);
          },
        );
    }

    function start(): void {
      set_notifications(null);
      set_error_message(null);
      set_is_loading(true);
      set_unread_count(0);
      const user_id = user?.id;
      if (!user_id) {
        set_is_loading(false);
        return;
      }
      run_fetch_list(user_id);
      run_fetch_count(user_id);
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
      // Valor previo EXACTO del conteo de cabecera — el revert en fallo
      // vuelve aquí, nunca a una recomputación desde el arreglo capado
      // (223.3, EC-31).
      const previous_unread_count = unread_count_ref.current;

      // Local, de inmediato — antes de que la red resuelva (EC-11). El
      // conteo de cabecera baja en exactamente uno (EC-30).
      set_notifications((prev) =>
        prev ? prev.map((n) => (n.id === id ? { ...n, read_at: now_iso } : n)) : prev,
      );
      set_unread_count(previous_unread_count - 1);

      const { error } = await supabase
        .from('notifications')
        .update({ read_at: now_iso })
        .eq('id', id)
        .eq('user_id', user_id);

      if (error) {
        // Estado veraz: revierte esta notificación a como estaba (EC-15) y
        // el conteo de cabecera al valor previo exacto (EC-31).
        set_notifications((prev) =>
          prev ? prev.map((n) => (n.id === id ? { ...n, read_at: null } : n)) : prev,
        );
        set_unread_count(previous_unread_count);
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
    // Valor previo EXACTO del conteo de cabecera para el revert (EC-33) —
    // no el tamaño del snapshot local (podría ser menor si hay más de 50
    // no-leídas fuera de la página visible).
    const previous_unread_count = unread_count_ref.current;

    // Local, de inmediato, todo el snapshot de no-leídas (EC-16). El
    // conteo de cabecera se pone en cero (EC-32).
    set_notifications((prev) =>
      prev ? prev.map((n) => (unread_id_set.has(n.id) ? { ...n, read_at: now_iso } : n)) : prev,
    );
    set_unread_count(0);

    const { error } = await supabase
      .from('notifications')
      .update({ read_at: now_iso })
      .is('read_at', null)
      // 🔴 Defecto (b), code review PR #106: el UPDATE masivo no llevaba
      // este filtro (el SELECT sí) y estampaba `read_at` sobre
      // notificaciones borradas (EC-36).
      .is('deleted_at', null)
      .eq('user_id', user_id);

    if (error) {
      // Estado veraz: revierte SOLO los ids del snapshot (EC-19) y el
      // conteo de cabecera al valor previo exacto (EC-33).
      set_notifications((prev) =>
        prev ? prev.map((n) => (unread_id_set.has(n.id) ? { ...n, read_at: null } : n)) : prev,
      );
      set_unread_count(previous_unread_count);
    }
  }, [user?.id]);

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
