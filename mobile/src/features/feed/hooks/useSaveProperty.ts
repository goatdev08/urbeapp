/**
 * useSaveProperty — persistencia optimista de guardados en el feed.
 *
 * Subtarea Taskmaster: 9.7 — persistencia save (fase GREEN)
 *
 * API:
 *   useSaveProperty({ property_id, initialSaved?, supabase? })
 *     → { isSaved: boolean, toggleSave: () => Promise<void> }
 *
 * Reglas de negocio (migración 0006):
 *   - tabla saves: (id, user_id, property_id, created_at) — SIN property_video_id.
 *     UNIQUE INDEX (user_id, property_id)
 *   - toggleSave: no-saved → INSERT {user_id, property_id}; saved → DELETE por (user_id, property_id).
 *   - Optimista + rollback: el estado cambia ANTES; error genérico → revierte.
 *   - Unique conflict (23505) → tratado como "ya saved"; mantener isSaved=true, NO revertir.
 *   - user_id SIEMPRE del hook useAuth(), nunca de parámetros externos.
 *   - user null → no-op, sin crash.
 *
 * INYECCIÓN DE DEPS (tests): useSaveProperty({ ..., supabase: mock })
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@/features/auth/context';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface UseSavePropertyOpts {
  property_id: string;
  initialSaved?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

export interface UseSavePropertyReturn {
  isSaved: boolean;
  toggleSave: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useSaveProperty({
  property_id,
  initialSaved = false,
  supabase: supabase_prop,
}: UseSavePropertyOpts): UseSavePropertyReturn {
  const { user } = useAuth();
  const [is_saved, set_is_saved] = useState(initialSaved);

  // Resolución lazy del cliente — evita module-level eval en tests sin env vars.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const get_client = (): any => {
    if (supabase_prop !== undefined) return supabase_prop;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  /**
   * toggleSave — alterna guardado/quitado.
   * no-saved → INSERT {user_id, property_id} (SIN property_video_id — schema saves).
   * saved → DELETE filtrado por (user_id, property_id).
   * Error → rollback al estado previo.
   * 23505 → ya existe → mantener isSaved=true (no rollback).
   */
  const toggleSave = useCallback(async () => {
    if (!user) return;

    const prev = is_saved;
    // Optimista: invertir estado ANTES
    set_is_saved(!prev);

    if (!prev) {
      // no era saved → INSERT
      // ponytail: saves NO lleva property_video_id (schema migración 0006)
      const { error } = await get_client()
        .from('saves')
        .insert({ user_id: user.id, property_id });

      if (error) {
        if ((error as { code?: string }).code === '23505') {
          return; // Ya existe → mantener saved=true
        }
        set_is_saved(prev); // rollback
      }
    } else {
      // era saved → DELETE
      const { error } = await get_client()
        .from('saves')
        .delete()
        .eq('user_id', user.id)
        .eq('property_id', property_id);

      if (error) {
        set_is_saved(prev); // rollback
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, is_saved, property_id, supabase_prop]);

  return { isSaved: is_saved, toggleSave };
}
