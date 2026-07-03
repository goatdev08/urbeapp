/**
 * useLikeProperty — persistencia optimista de likes en el feed.
 *
 * Subtarea Taskmaster: 9.7 — persistencia like (fase GREEN)
 *
 * API:
 *   useLikeProperty({ property_video_id, property_id, initialLiked?, supabase? })
 *     → { isLiked: boolean, toggleLike: () => Promise<void>, likeOnly: () => Promise<void> }
 *
 * Reglas de negocio (migración 0006):
 *   - tabla likes: UNIQUE INDEX (user_id, property_video_id)
 *   - likeOnly: no-liked → INSERT optimista; ya-liked → NO-OP (idempotente, estilo TikTok).
 *   - toggleLike: no-liked → INSERT; liked → DELETE por (user_id, property_video_id).
 *   - Optimista + rollback: el estado cambia ANTES; error genérico → revierte.
 *   - Unique conflict (23505) → tratado como "ya liked"; mantener isLiked=true, NO revertir.
 *   - user_id SIEMPRE del hook useAuth(), nunca de parámetros externos.
 *   - user null → no-op, sin crash.
 *
 * INYECCIÓN DE DEPS (tests): useLikeProperty({ ..., supabase: mock })
 * Cliente lazy (require) para evitar eval a nivel de módulo en tests sin env vars.
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@/features/auth/context';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface UseLikePropertyOpts {
  property_video_id: string;
  property_id: string;
  initialLiked?: boolean;
   
  supabase?: any;
}

export interface UseLikePropertyReturn {
  isLiked: boolean;
  toggleLike: () => Promise<void>;
  likeOnly: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useLikeProperty({
  property_video_id,
  property_id,
  initialLiked = false,
  supabase: supabase_prop,
}: UseLikePropertyOpts): UseLikePropertyReturn {
  const { user } = useAuth();
  const [is_liked, set_is_liked] = useState(initialLiked);

  // Resolución lazy del cliente — idéntico a usePropertyActions.ts.
  // Evita que el module-level eval de client.ts (que lanza sin env vars) rompa los tests.
   
  const get_client = (): any => {
    if (supabase_prop !== undefined) return supabase_prop;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  /**
   * likeOnly — doble-tap TikTok: solo añade like, nunca lo quita.
   * no-liked → INSERT optimista; ya-liked → NO-OP.
   * 23505 (conflicto único) → ya existe en BD, mantener liked=true (no rollback).
   */
  const likeOnly = useCallback(async () => {
    if (!user) return;
    if (is_liked) return; // ya liked → no-op (idempotente)

    // Optimista: marcar liked ANTES de la llamada a BD
    set_is_liked(true);

    const { error } = await get_client()
      .from('likes')
      .insert({ user_id: user.id, property_video_id, property_id });

    if (error) {
      if ((error as { code?: string }).code === '23505') {
        // Conflicto único → ya existe en BD, mantener liked=true (no error visible)
        return;
      }
      // Error genérico → rollback al estado previo (false)
      set_is_liked(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, is_liked, property_video_id, property_id, supabase_prop]);

  /**
   * toggleLike — alterna like/unlike.
   * no-liked → INSERT optimista; liked → DELETE optimista por (user_id, property_video_id).
   * Error → rollback al estado previo.
   */
  const toggleLike = useCallback(async () => {
    if (!user) return;

    const prev = is_liked;
    // Optimista: invertir estado ANTES
    set_is_liked(!prev);

    if (!prev) {
      // no era liked → INSERT
      const { error } = await get_client()
        .from('likes')
        .insert({ user_id: user.id, property_video_id, property_id });

      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return; // Ya existe → mantener liked=true
        }
        set_is_liked(prev); // rollback
      }
    } else {
      // era liked → DELETE (filtrado por user_id + property_video_id, sin property_id)
      const { error } = await get_client()
        .from('likes')
        .delete()
        .eq('user_id', user.id)
        .eq('property_video_id', property_video_id);

      if (error) {
        set_is_liked(prev); // rollback
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, is_liked, property_video_id, property_id, supabase_prop]);

  return { isLiked: is_liked, toggleLike, likeOnly };
}
