/**
 * useVideoEngagementEvents — telemetría de engagement de video en el feed.
 *
 * Subtarea Taskmaster: 112.2 — captura de video_view / video_completed con
 * dedupe por sesión (fase RED)
 *
 * STUB fase RED — sin lógica de negocio. Lanza `not_implemented` para que los
 * tests fallen por aserción/excepción, no por import. Contrato completo (a
 * implementar en GREEN): ver
 * mobile/src/features/feed/__tests__/useVideoEngagementEvents.test.tsx
 *
 * API pública (seam bajo test):
 *   useVideoEngagementEvents({ property_id, property_video_id, session_id, supabase?, store? })
 *     → { report_view: () => Promise<void>, report_time_update: (current_time, duration) => Promise<void> }
 *
 * Reglas de negocio (subtarea 112, contexto verificado):
 *   - Escritura DIRECTA a public.events_raw con RLS (mismo patrón que
 *     useLikeProperty/useSaveProperty), NUNCA vía Edge Function.
 *   - user_id SIEMPRE de useAuth(), nunca de parámetros externos.
 *   - report_view(): una sola fila `video_view` por (session_id, property_id).
 *   - report_time_update(current_time, duration): cuando is_video_completed(...)
 *     es true, una sola fila `video_completed` por (session_id, property_id) —
 *     el feed reproduce en LOOP, así que timeUpdate dispara continuamente y
 *     SIN este dedupe se generarían cientos de filas.
 *   - session_id distinto (nueva sesión de app) → sí vuelve a contar (insumo
 *     de "veces que volvió a ver").
 *   - Fire-and-forget: un error de INSERT (offline, RLS) se loggea pero NUNCA
 *     propaga — la reproducción del video no debe romperse.
 *   - Sin user autenticado → no intenta escribir.
 *
 * INYECCIÓN DE DEPS (tests): supabase y store son inyectables, igual que
 * useLikeProperty({ ..., supabase: mock }). `store` por defecto debe vivir a
 * nivel de módulo (sobrevive remounts de VideoFeedItem por reciclaje de
 * FlashList dentro de la MISMA sesión); un store inyectado permite a los
 * tests compartir estado de dedupe entre dos `renderHook()` (simulando un
 * remount) o aislarlo (simulando sesiones distintas).
 */

import { useAuth } from '@/features/auth/context';
import {
  create_video_engagement_store,
  is_video_completed,
  type VideoEngagementEventType,
  type VideoEngagementStore,
} from '../lib/videoEngagementDedupe';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

export interface UseVideoEngagementEventsOpts {
  property_id: string;
  property_video_id: string;
  session_id: string;

  supabase?: any;
  store?: VideoEngagementStore;
}

export interface UseVideoEngagementEventsReturn {
  /** Llamar cuando la propiedad se activa en el feed (isActive → true). */
  report_view: () => Promise<void>;
  /** Llamar en cada tick de `timeUpdate` del player de expo-video. */
  report_time_update: (current_time: number, duration: number) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store por defecto — singleton de módulo (sobrevive remounts de VideoFeedItem
// por reciclaje de FlashList dentro de la MISMA sesión de la app). Los tests
// inyectan su propio `store` para compartirlo entre renderHook() o aislarlo.
// ─────────────────────────────────────────────────────────────────────────────

const default_store = create_video_engagement_store();

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useVideoEngagementEvents(
  opts: UseVideoEngagementEventsOpts
): UseVideoEngagementEventsReturn {
  const {
    property_id,
    property_video_id,
    session_id,
    supabase: supabase_prop,
    store = default_store,
  } = opts;
  const { user } = useAuth();

  // Resolución lazy del cliente — idéntico a useLikeProperty.ts. Evita que el
  // module-level eval de client.ts (que lanza sin env vars) rompa los tests.

  const get_client = (): any => {
    if (supabase_prop !== undefined) return supabase_prop;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  // Fire-and-forget real: nunca lanza ni rechaza. Un error de INSERT (offline,
  // RLS) se loggea con console.error — NO se traga en silencio, pero tampoco
  // debe romper la reproducción del video que lo dispara.
  const insert_event = async (
    event_type: VideoEngagementEventType,
    user_id: string
  ): Promise<void> => {
    try {
      const { error } = await get_client()
        .from('events_raw')
        .insert({ event_type, user_id, property_id, property_video_id, session_id });

      if (error) {
        console.error(`[useVideoEngagementEvents] fallo al insertar ${event_type}`, error);
      }
    } catch (err) {
      console.error(`[useVideoEngagementEvents] excepción al insertar ${event_type}`, err);
    }
  };

  /** Llamar cuando la propiedad se activa en el feed (isActive → true). */
  const report_view = async (): Promise<void> => {
    if (!user) return;
    if (store.has_seen(session_id, 'video_view', property_id)) return;
    // Marca ANTES de insertar (no tras resolver): report_view() se llama
    // fire-and-forget sin await, así que dos activaciones seguidas del mismo
    // ítem podrían solaparse mientras el primer INSERT sigue en vuelo.
    store.mark_seen(session_id, 'video_view', property_id);
    await insert_event('video_view', user.id);
  };

  /** Llamar en cada tick de `timeUpdate` del player de expo-video. */
  const report_time_update = async (
    current_time: number,
    duration: number
  ): Promise<void> => {
    if (!user) return;
    if (!is_video_completed(current_time, duration)) return;
    if (store.has_seen(session_id, 'video_completed', property_id)) return;
    store.mark_seen(session_id, 'video_completed', property_id);
    await insert_event('video_completed', user.id);
  };

  return { report_view, report_time_update };
}
