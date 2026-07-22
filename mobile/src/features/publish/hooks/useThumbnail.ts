/**
 * useThumbnail — DI de supabase para el thumbnail picker de Cloudflare Stream
 * (fetch_source vía mint-thumbnail-url, save_pct vía property_videos.thumbnail_pct).
 *
 * GREEN — subtarea 68.7 (Taskmaster). Mismo patrón que useVideoUpload: DI de
 * supabase, lazy-require del cliente real, mapeo de error_code vía
 * extract_error_code (edge-errors.ts), mensajes fijos en español (sin
 * exponer detalle técnico), refs + getters para evitar "unresolved act
 * work" en RNTL (sync act()).
 */
import { useCallback, useMemo, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { extract_error_code } from '@/lib/supabase/edge-errors';

const PERMISSION_ERROR_MESSAGE = 'No tienes permiso para ver este video.';
const NOT_FOUND_ERROR_MESSAGE = 'El video no está listo. Intenta de nuevo en unos segundos.';
const NEUTRAL_ERROR_MESSAGE = 'No se pudo cargar la portada. Verifica tu conexión e intenta de nuevo.';
const SAVE_ERROR_MESSAGE = 'No se pudo guardar la portada. Intenta de nuevo.';

// ponytail: import lazy — el cliente real solo se carga cuando no se inyecta
// uno externo (los tests siempre inyectan su propio mock), mismo patrón que
// useVideoUpload.
function get_default_supabase(): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: SupabaseClient }).supabase;
}

/** Mapea el error_code de mint-thumbnail-url a un mensaje en español. */
function map_thumbnail_error_code(code: string | undefined): string {
  if (code === 'FORBIDDEN_NOT_OWNER') return PERMISSION_ERROR_MESSAGE;
  if (code === 'VIDEO_NOT_FOUND') return NOT_FOUND_ERROR_MESSAGE;
  return NEUTRAL_ERROR_MESSAGE;
}

export interface UseThumbnailDeps {
  /** Cliente Supabase — inyectable para tests. Por defecto el singleton del módulo. */
  supabase?: SupabaseClient;
}

export interface ThumbnailSource {
  baseUrl: string;
  token: string;
  durationSeconds: number | null;
}

export interface UseThumbnailResult {
  fetch_source: (cloudflare_uid: string) => Promise<ThumbnailSource | null>;
  save_pct: (cloudflare_uid: string, pct: number) => Promise<boolean>;
  error: string | null;
}

export function useThumbnail(deps?: UseThumbnailDeps): UseThumbnailResult {
  const supabase_client = deps?.supabase ?? get_default_supabase();
  const error_ref = useRef<string | null>(null);

  const fetch_source = useCallback(
    async (cloudflare_uid: string): Promise<ThumbnailSource | null> => {
      try {
        const { data, error: invoke_error } = await supabase_client.functions.invoke<{
          baseUrl: string | null;
          token: string | null;
          durationSeconds: number | null;
        }>('mint-thumbnail-url', { body: { cloudflare_uid } });

        if (invoke_error) {
          const code = await extract_error_code(invoke_error);
          error_ref.current = map_thumbnail_error_code(code);
          return null;
        }

        if (!data?.baseUrl || !data?.token) {
          error_ref.current = NEUTRAL_ERROR_MESSAGE;
          return null;
        }

        error_ref.current = null;
        return { baseUrl: data.baseUrl, token: data.token, durationSeconds: data.durationSeconds ?? null };
      } catch {
        error_ref.current = NEUTRAL_ERROR_MESSAGE;
        return null;
      }
    },

    [supabase_client],
  );

  const save_pct = useCallback(
    async (cloudflare_uid: string, pct: number): Promise<boolean> => {
      const clamped_pct = Math.min(100, Math.max(0, pct));

      try {
        const { error: update_error } = await supabase_client
          .from('property_videos')
          .update({ thumbnail_pct: clamped_pct })
          .eq('cloudflare_uid', cloudflare_uid);

        if (update_error) {
          error_ref.current = SAVE_ERROR_MESSAGE;
          return false;
        }

        error_ref.current = null;
        return true;
      } catch {
        error_ref.current = SAVE_ERROR_MESSAGE;
        return false;
      }
    },

    [supabase_client],
  );

  return useMemo(
    () => ({
      fetch_source,
      save_pct,
      get error(): string | null {
        return error_ref.current;
      },
    }),

    [fetch_source, save_pct],
  );
}
