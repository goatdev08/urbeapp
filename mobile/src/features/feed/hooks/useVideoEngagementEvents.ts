/**
 * useVideoEngagementEvents — telemetría de engagement de video en el feed.
 *
 * Subtarea Taskmaster: 112.2 — captura de video_view / video_completed con
 * dedupe por sesión. Implementación completa (GREEN + re-arbitraje del
 * guardian); contrato verificado en
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
 *   - session_id falsy (guarda fail-closed, ver report_view/report_time_update
 *     abajo) → NO escribe, pero SÍ loggea con console.error (re-arbitraje V3:
 *     antes salía en silencio; si randomUUID() fallara en producción, la
 *     telemetría entera desaparecería sin ningún síntoma).
 *   - Fire-and-forget: un error de INSERT (offline, RLS) se loggea pero NUNCA
 *     propaga — la reproducción del video no debe romperse.
 *   - Sin user autenticado → no intenta escribir.
 *
 * INYECCIÓN DE DEPS (tests): supabase y store son inyectables, igual que
 * useLikeProperty({ ..., supabase: mock }). Sin `store` explícito, el hook usa
 * uno propio (useRef, memoizado una vez por instancia) — suficiente para las
 * varias llamadas de UNA instancia (p.ej. reactivaciones rápidas de isActive),
 * pero NO sobrevive un remount (nueva instancia = nuevo store). La
 * persistencia real entre remounts de VideoFeedItem por reciclaje de FlashList
 * es responsabilidad del LLAMADOR: debe inyectar un store creado a nivel de
 * módulo (mismo patrón que el session_id — ver VideoFeedItem.tsx). Un store
 * inyectado también permite a los tests compartirlo entre dos `renderHook()`
 * (simulando un remount) o aislarlo (simulando sesiones distintas).
 */

import { useRef } from 'react';
import { useAuth } from '@/features/auth/context';
import {
  compute_progress_percent,
  create_video_engagement_store,
  is_video_completed,
  VIDEO_COMPLETED_EVENT_TYPE,
  VIDEO_PROGRESS_EVENT_TYPE,
  VIDEO_VIEW_EVENT_TYPE,
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
  /** Llamar al desactivarse el ítem o al reciclarse hacia otra property (268.1). */
  report_progress: () => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useVideoEngagementEvents(
  opts: UseVideoEngagementEventsOpts
): UseVideoEngagementEventsReturn {
  const { property_id, property_video_id, session_id, supabase: supabase_prop, store: store_prop } = opts;
  const { user } = useAuth();

  // Store por defecto: uno por instancia del hook (lazy-init en el ref, nunca
  // se recrea entre re-renders). Si el llamador inyecta `store`, ese SIEMPRE
  // gana — permite compartir dedupe entre instancias (remounts) o aislarlo.
  const own_store_ref = useRef<VideoEngagementStore | null>(null);
  if (own_store_ref.current === null) {
    own_store_ref.current = create_video_engagement_store();
  }
  const store = store_prop ?? own_store_ref.current;

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
    user_id: string,
    payload?: { progress: number }
  ): Promise<void> => {
    try {
      const row: Record<string, unknown> = { event_type, user_id, property_id, property_video_id, session_id };
      // video_view/video_completed NO llevan `payload` (contrato de no-regresión,
      // EC-22) — solo se agrega la clave cuando el llamador la pasa (video_progress).
      if (payload !== undefined) row.payload = payload;
      const { error } = await get_client().from('events_raw').insert(row);

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
    // Guardian 112.2: sin session_id válido (p.ej. Crypto.randomUUID() del
    // módulo nativo expo-crypto fallara y devolviera algo falsy) NO se
    // escribe — events_raw.session_id es nullable, así que sin esta guarda
    // se insertarían filas con session_id NULL en silencio (todo aquí es
    // fire-and-forget) y corromperían el conteo de "veces que volvió a ver".
    // Re-arbitraje V3: además de fail-closed, ahora es DIAGNOSTICABLE — sin
    // el console.error, esta salida es tan silenciosa como el bug que evita.
    if (!session_id) {
      console.error(
        '[useVideoEngagementEvents] session_id vacío/inválido — se descarta video_view sin escribir (fail-closed)'
      );
      return;
    }
    if (store.has_seen(session_id, VIDEO_VIEW_EVENT_TYPE, property_id)) return;
    // Marca ANTES de insertar (no tras resolver): report_view() se llama
    // fire-and-forget sin await, así que dos activaciones seguidas del mismo
    // ítem podrían solaparse mientras el primer INSERT sigue en vuelo.
    store.mark_seen(session_id, VIDEO_VIEW_EVENT_TYPE, property_id);
    await insert_event(VIDEO_VIEW_EVENT_TYPE, user.id);
  };

  /** Llamar en cada tick de `timeUpdate` del player de expo-video. */
  const report_time_update = async (
    current_time: number,
    duration: number
  ): Promise<void> => {
    if (!user) return;
    // ver razón (fail-closed) en report_view arriba.
    if (!session_id) {
      console.error(
        '[useVideoEngagementEvents] session_id vacío/inválido — se descarta video_completed sin escribir (fail-closed)'
      );
      return;
    }
    // 268.1: además del umbral de compleción (video_completed), cada tick
    // actualiza el máximo de avance del store — independiente de si completa
    // o no. report_progress() (abajo) lee ese máximo al desactivarse/reciclar.
    const progress = compute_progress_percent(current_time, duration);
    if (progress !== null) {
      store.bump_max_progress(session_id, property_id, progress);
    }
    if (!is_video_completed(current_time, duration)) return;
    if (store.has_seen(session_id, VIDEO_COMPLETED_EVENT_TYPE, property_id)) return;
    store.mark_seen(session_id, VIDEO_COMPLETED_EVENT_TYPE, property_id);
    await insert_event(VIDEO_COMPLETED_EVENT_TYPE, user.id);
  };

  /** Llamar al desactivarse el ítem en el feed o al reciclarse hacia otra property. */
  const report_progress = async (): Promise<void> => {
    if (!user) return;
    // ver razón (fail-closed, sin PII) en report_view arriba.
    if (!session_id) {
      console.error(
        '[useVideoEngagementEvents] session_id vacío/inválido — se descarta video_progress sin escribir (fail-closed)'
      );
      return;
    }
    const max = store.get_max_progress(session_id, property_id);
    // Sin ningún report_time_update previo (nunca hubo máximo) → nada que
    // reportar; NO es un error, es el estado inicial.
    if (max === null) return;
    if (store.has_seen(session_id, VIDEO_PROGRESS_EVENT_TYPE, property_id)) return;
    // Marca ANTES de insertar — mismo motivo que report_view (fire-and-forget
    // sin await entre llamadas concurrentes).
    store.mark_seen(session_id, VIDEO_PROGRESS_EVENT_TYPE, property_id);
    await insert_event(VIDEO_PROGRESS_EVENT_TYPE, user.id, { progress: max });
  };

  return { report_view, report_time_update, report_progress };
}
