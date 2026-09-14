/**
 * useFollow — follow/unfollow optimista de una cuenta (tarea #78 «follow de cuentas F1»).
 *
 * Subtarea Taskmaster: 78.3 — fase GREEN (ver useFollow.test.tsx para el detalle EC-n).
 *
 * API:
 *   useFollow({ followed_user_id, supabase? })
 *     → { is_following: boolean, loading: boolean, toggle_follow: () => Promise<void>, is_own: boolean }
 *
 * Reglas de negocio (migración 20260914100001_follows.sql), calcado de
 * useLikeProperty.ts (feed/hooks/useLikeProperty.ts) para el flujo optimista:
 *   - tabla follows: PK (follower_user_id, followed_user_id).
 *   - Precarga al montar: from('follows').select('followed_user_id')
 *       .eq('follower_user_id', user.id).eq('followed_user_id', followed_user_id)
 *       .maybeSingle() — el eq('follower_user_id', ...) es EXPLÍCITO aunque RLS
 *       ya filtre (memoria flatlist_numcolumns_row_keys).
 *   - toggle_follow: no sigue → INSERT optimista; 23505 → ya sigue, mantener
 *     true (no rollback); otro error → rollback a false.
 *     Sigue → DELETE optimista .eq(follower_user_id).eq(followed_user_id);
 *     error → rollback a true.
 *   - Idempotencia: doble toggle_follow() en vuelo → una sola llamada a insert/delete
 *     (is_working_ref).
 *   - user null → is_following=false, loading=false, toggle_follow no-op sin llamar a `from`.
 *   - is_own (followed_user_id === user.id): SIN precarga (0 llamadas a from),
 *     toggle_follow no-op. Decisión: es la propia cuenta, seguirse a sí mismo no aplica.
 *   - user_id SIEMPRE de useAuth(), nunca de props externas.
 *   - Nunca desprender métodos del cliente (#205): encadenable
 *     from().select().eq().eq().maybeSingle() / from().insert() / from().delete().eq().eq().
 *
 * ESTADO EN REFS + GETTERS (molde useReportProperty.ts / useModerateProperty.ts),
 * NO useState: React 18+ batchea (y difiere a un tick) los `set_state` que no
 * ocurren dentro de un evento reconocido, así que un `act(() => { toggle_follow() })`
 * sin `await` (EC-4/EC-9 del RED: la lectura optimista debe verse en el MISMO
 * tick, antes de que el insert/delete resuelva) leería el estado viejo. Los refs
 * se mutan de forma síncrona siempre; el objeto devuelto se memoiza con
 * `useMemo` y expone `is_following`/`loading` como getters sobre esos refs —
 * `result.current` sigue siendo el MISMO objeto entre renders (mismos deps),
 * así que el getter lee el valor fresco sin depender de que ya haya corrido
 * un re-render. `force_update()` sigue disparándose tras cada mutación para
 * que los consumidores reales (UI) sí re-rendericen.
 *
 * INYECCIÓN DE DEPS (tests): useFollow({ ..., supabase: mock }).
 * Cliente lazy (require) para evitar eval a nivel de módulo en tests sin env vars.
 */

import { useEffect, useMemo, useReducer, useRef } from 'react';
import { useAuth } from '@/features/auth/context';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface UseFollowOpts {
  followed_user_id: string;

  supabase?: any;
}

export interface UseFollowReturn {
  is_following: boolean;
  loading: boolean;
  toggle_follow: () => Promise<void>;
  is_own: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useFollow({ followed_user_id, supabase: supabase_prop }: UseFollowOpts): UseFollowReturn {
  const { user } = useAuth();
  const is_own = user !== null && user.id === followed_user_id;

  const is_following_ref = useRef(false);
  const loading_ref = useRef(!is_own && user !== null);
  const is_working_ref = useRef(false);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Resolución lazy del cliente — idéntico a useLikeProperty.ts.
  // Evita que el module-level eval de client.ts (que lanza sin env vars) rompa los tests.

  const get_client = (): any => {
    if (supabase_prop !== undefined) return supabase_prop;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  // ── Precarga del estado inicial ──────────────────────────────────────────
  useEffect(() => {
    if (is_own || !user) {
      loading_ref.current = false;
      force_update();
      return;
    }

    let ignore = false;
    loading_ref.current = true;
    force_update();

    (async () => {
      const { data, error } = await get_client()
        .from('follows')
        .select('followed_user_id')
        .eq('follower_user_id', user.id)
        .eq('followed_user_id', followed_user_id)
        .maybeSingle();

      if (ignore) return;

      is_following_ref.current = !error && !!data;
      loading_ref.current = false;
      force_update();
    })();

    return () => {
      ignore = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [is_own, user, followed_user_id, supabase_prop]);

  // ── Toggle optimista + rollback ──────────────────────────────────────────
  // Wrapper SÍNCRONO (no `async`): fija is_following_ref/is_working_ref ANTES
  // del primer await, para que una lectura del mismo tick (EC-4/EC-9) vea el
  // valor optimista sin depender de que el insert/delete ya haya resuelto.
  const toggle_follow = (): Promise<void> => {
    if (!user || is_own) return Promise.resolve();
    if (is_working_ref.current) return Promise.resolve();

    is_working_ref.current = true;
    const prev = is_following_ref.current;
    is_following_ref.current = !prev;
    force_update();

    const release = () => {
      is_working_ref.current = false;
    };

    if (!prev) {
      // no seguía → INSERT
      return get_client()
        .from('follows')
        .insert({ follower_user_id: user.id, followed_user_id })
        .then(({ error }: { error: { code?: string } | null }) => {
          if (error && (error.code ?? '') !== '23505') {
            is_following_ref.current = prev; // rollback a false
            force_update();
          }
          release();
        });
    }

    // seguía → DELETE
    return get_client()
      .from('follows')
      .delete()
      .eq('follower_user_id', user.id)
      .eq('followed_user_id', followed_user_id)
      .then(({ error }: { error: { code?: string } | null }) => {
        if (error) {
          is_following_ref.current = prev; // rollback a true
          force_update();
        }
        release();
      });
  };

  return useMemo(() => {
    const r: UseFollowReturn = {
      is_own,
      toggle_follow,
      get is_following() {
        return is_following_ref.current;
      },
      get loading() {
        return loading_ref.current;
      },
    };
    return r;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followed_user_id, is_own, user, supabase_prop]);
}
