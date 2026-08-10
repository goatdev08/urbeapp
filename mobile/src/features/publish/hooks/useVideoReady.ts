/**
 * useVideoReady (#126, fix 73.4) — espera el 'ready' REAL de property_videos.
 *
 * El bug que resuelve: step5 habilitaba "Publicar" con el estado de UI
 * 'processing' (binario subido), pero la fila en DB sigue 'uploading' hasta
 * que el webhook de Stream la pasa a 'ready' — el gate del server rechazaba
 * con 409 VIDEO_NOT_READY justo al final del wizard, sin espera ni reintento.
 *
 * Este hook pollea el status real (misma query que ya usa useVideoUpload,
 * default_check_video_status) hasta 'ready' o 'failed':
 *   - cloudflare_uid null → 'idle' (nada que esperar; edit mode o sin video).
 *   - 'ready'  → deja de pollear; step5 habilita Publicar.
 *   - 'failed' → deja de pollear; step5 muestra error de procesamiento.
 *   - 'uploading' | 'processing' | 'missing' | error transitorio de red →
 *     sigue esperando (el webhook puede tardar unos segundos).
 *
 * Sin techo de intentos a propósito (ponytail): la transcodificación de un
 * video de 60–120 s tarda segundos; si el webhook se pierde, el agente puede
 * salir del wizard (el borrador persiste) — techo conocido, sin código extra.
 */

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import { default_check_video_status, type VideoCheckStatus } from './useVideoUpload';

export type VideoReadyStatus = 'idle' | 'waiting' | 'ready' | 'failed';

export interface UseVideoReadyDeps {
  /** Consulta el estado real del video — inyectable para tests. */
  check_video_status?: (cloudflare_uid: string) => Promise<VideoCheckStatus>;
  /** Espera entre polls, en ms. Default 3000. */
  interval_ms?: number;
}

const DEFAULT_INTERVAL_MS = 3000;

// ponytail: import lazy del singleton — solo cuando no se inyecta checker
// (los tests siempre inyectan el suyo). Mismo patrón que useVideoUpload.
function default_checker(cloudflare_uid: string): Promise<VideoCheckStatus> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { supabase } = require('@/lib/supabase/client') as { supabase: SupabaseClient };
  return default_check_video_status(supabase, cloudflare_uid);
}

export function useVideoReady(
  cloudflare_uid: string | null,
  deps?: UseVideoReadyDeps,
): { status: VideoReadyStatus } {
  const [status, set_status] = useState<VideoReadyStatus>('idle');
  const interval_ms = deps?.interval_ms ?? DEFAULT_INTERVAL_MS;
  const injected_checker = deps?.check_video_status;

  useEffect(() => {
    if (!cloudflare_uid) {
      set_status('idle');
      return;
    }

    const checker = injected_checker ?? default_checker;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    set_status('waiting');

    const poll = async () => {
      try {
        const real_status = await checker(cloudflare_uid);
        if (cancelled) return;
        if (real_status === 'ready') {
          set_status('ready');
          return; // estado final — no re-agenda
        }
        if (real_status === 'failed') {
          set_status('failed');
          return; // estado final — no re-agenda
        }
        // 'uploading' | 'processing' | 'missing' → seguir esperando.
      } catch {
        // Error transitorio (red) → seguir esperando; el siguiente poll decide.
      }
      if (!cancelled) {
        timer = setTimeout(() => void poll(), interval_ms);
      }
    };
    void poll();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cloudflare_uid, injected_checker, interval_ms]);

  return { status };
}
