/**
 * videoEngagementDedupe.ts — lógica pura de compleción de video y dedupe de
 * eventos de engagement (video_view / video_completed) por (sesión, propiedad).
 *
 * Subtarea Taskmaster: 112.2 — captura en el feed. Implementación completa
 * (GREEN); contrato verificado en
 * mobile/src/features/feed/__tests__/videoEngagementDedupe.test.ts
 *
 * Por qué existe (contexto verificado en la subtarea 112):
 *   - expo-video con `loop=true` (VideoFeedItem.tsx) NUNCA dispara
 *     `playToEnd` → la compleción se detecta comparando `currentTime` contra
 *     `duration` en cada tick de `timeUpdate`.
 *   - El feed reproduce en BUCLE: sin dedupe, `timeUpdate` generaría cientos
 *     de filas en events_raw por un solo video olvidado en pantalla, e
 *     inflaría las estadísticas del agente con actividad falsa.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Umbral de compleción
// ─────────────────────────────────────────────────────────────────────────────

/**
 * currentTime >= duration * este ratio ⇒ se considera "video completo".
 * 0.95 porque el último frame casi nunca se alcanza exacto (expo-video no
 * siempre reporta currentTime === duration antes de reiniciar por loop).
 */
export const VIDEO_COMPLETION_THRESHOLD_RATIO = 0.95;

/**
 * true solo si `duration` es un número finito > 0 y `current_time` es un
 * número finito >= duration * VIDEO_COMPLETION_THRESHOLD_RATIO.
 * duration inválida (0, NaN, undefined, null — típico mientras el video
 * carga) → false, NUNCA throw.
 */
export function is_video_completed(
  current_time: number,
  duration: number | null | undefined
): boolean {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return false;
  }
  if (!Number.isFinite(current_time)) {
    return false;
  }
  return current_time >= duration * VIDEO_COMPLETION_THRESHOLD_RATIO;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store de dedupe (sesión, tipo de evento, propiedad)
// ─────────────────────────────────────────────────────────────────────────────

export type VideoEngagementEventType = 'video_view' | 'video_completed';

// ponytail: única fuente para estos 2 literales — la RPC de estadísticas del
// lead (112.3) filtra events_raw.event_type por estos MISMOS strings; un typo
// en cualquiera de los dos lados daría 0 filas sin ningún síntoma visible.
export const VIDEO_VIEW_EVENT_TYPE: VideoEngagementEventType = 'video_view';
export const VIDEO_COMPLETED_EVENT_TYPE: VideoEngagementEventType = 'video_completed';

export interface VideoEngagementStore {
  /** true si ya se registró este (session_id, event_type, property_id). */
  has_seen: (
    session_id: string,
    event_type: VideoEngagementEventType,
    property_id: string
  ) => boolean;
  /** Marca (session_id, event_type, property_id) como ya registrado. Idempotente. */
  mark_seen: (
    session_id: string,
    event_type: VideoEngagementEventType,
    property_id: string
  ) => void;
}

/**
 * Crea un store de dedupe en memoria. Debe vivir FUERA del ciclo de vida del
 * componente (VideoFeedItem se recicla en FlashList al hacer scroll) — un
 * singleton a nivel de módulo o una instancia inyectada que sobreviva a los
 * remounts dentro de la MISMA sesión de la app.
 */
export function create_video_engagement_store(): VideoEngagementStore {
  // ponytail: Set<string> con clave compuesta — dedupe en memoria, sin BD ni
  // dependencia nueva; suficiente porque el store vive y muere con la sesión.
  const seen = new Set<string>();

  const make_key = (
    session_id: string,
    event_type: VideoEngagementEventType,
    property_id: string
  ): string => `${session_id}::${event_type}::${property_id}`;

  return {
    has_seen: (session_id, event_type, property_id) =>
      seen.has(make_key(session_id, event_type, property_id)),
    mark_seen: (session_id, event_type, property_id) => {
      seen.add(make_key(session_id, event_type, property_id));
    },
  };
}
