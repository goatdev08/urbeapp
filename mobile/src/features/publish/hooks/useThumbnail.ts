// useThumbnail — DI de supabase para el thumbnail picker de Cloudflare Stream
// (fetch_source vía mint-thumbnail-url, save_pct vía property_videos.thumbnail_pct).
//
// STUB — subtarea 68.7 (Taskmaster). Fase RED: solo signatures, sin lógica.
import type { SupabaseClient } from '@supabase/supabase-js';

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

export function useThumbnail(_deps?: UseThumbnailDeps): UseThumbnailResult {
  return {
    fetch_source: async (): Promise<ThumbnailSource | null> => {
      throw new Error('not_implemented');
    },
    save_pct: async (): Promise<boolean> => {
      throw new Error('not_implemented');
    },
    error: null,
  };
}
