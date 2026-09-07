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

export type VideoEngagementEventType = 'video_view' | 'video_completed' | 'video_progress';

// ponytail: única fuente para estos literales — la RPC de estadísticas del
// lead (112.3) filtra events_raw.event_type por estos MISMOS strings; un typo
// en cualquiera de los lados daría 0 filas sin ningún síntoma visible.
export const VIDEO_VIEW_EVENT_TYPE: VideoEngagementEventType = 'video_view';
export const VIDEO_COMPLETED_EVENT_TYPE: VideoEngagementEventType = 'video_completed';
export const VIDEO_PROGRESS_EVENT_TYPE: VideoEngagementEventType = 'video_progress';

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
  /** % máximo de avance (0-100) registrado para (session_id, property_id), o null si nunca hubo bump. */
  get_max_progress: (session_id: string, property_id: string) => number | null;
  /** Sube el máximo vigente si `progress` es mayor (monotónico) y devuelve el máximo resultante. */
  bump_max_progress: (session_id: string, property_id: string, progress: number) => number;
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

  // 268.1: Map separado para el máximo de progreso — namespace independiente
  // de `seen` (clave sin event_type: "¿cuál es el avance máximo?" es una
  // pregunta distinta de "¿ya se vio/completó?", aunque compartan
  // session_id+property_id; ver EC-33).
  const max_progress = new Map<string, number>();

  const make_key = (
    session_id: string,
    event_type: VideoEngagementEventType,
    property_id: string
  ): string => `${session_id}::${event_type}::${property_id}`;

  const make_progress_key = (session_id: string, property_id: string): string =>
    `${session_id}::${property_id}`;

  return {
    has_seen: (session_id, event_type, property_id) =>
      seen.has(make_key(session_id, event_type, property_id)),
    mark_seen: (session_id, event_type, property_id) => {
      seen.add(make_key(session_id, event_type, property_id));
    },
    get_max_progress: (session_id, property_id) => {
      const key = make_progress_key(session_id, property_id);
      return max_progress.has(key) ? max_progress.get(key)! : null;
    },
    bump_max_progress: (session_id, property_id, progress) => {
      const key = make_progress_key(session_id, property_id);
      const current = max_progress.get(key);
      const next = current === undefined ? progress : Math.max(current, progress);
      max_progress.set(key, next);
      return next;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// % de avance de reproducción (268.1)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entero 0–100 (Math.floor, NUNCA Math.round) del avance de reproducción,
 * clampado a 100 (el loop puede reiniciar currentTime antes del último tick).
 * null si duration no es un número finito > 0, o si current_time no es un
 * número finito >= 0 — mismo espíritu de guarda que is_video_completed, pero
 * sin "false": aquí el contrato es un número o ausencia de dato.
 */
export function compute_progress_percent(
  current_time: number,
  duration: number | null | undefined
): number | null {
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) {
    return null;
  }
  if (!Number.isFinite(current_time) || current_time < 0) {
    return null;
  }
  return Math.min(100, Math.floor((current_time / duration) * 100));
}
