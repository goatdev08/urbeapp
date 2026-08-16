// supabase/functions/stream-webhook/types.ts
// Tipos y contratos de DI para la Edge Function stream-webhook — subtarea 68.5.
// Solo interfaces; sin imports de supabase-js (el adapter real vive en _shared/clients.ts, GREEN).
//
// Responsabilidad de la EF (webhook PÚBLICO de Cloudflare Stream, deploy --no-verify-jwt;
// lo llama Cloudflare, no un cliente con JWT de Supabase — el uid del video viaja en el payload):
//   1. Verifica la firma HMAC-SHA256 del header `Webhook-Signature: time=<unix>,sig1=<hex>`
//      contra STREAM_WEBHOOK_SECRET: sig1 = HMAC-SHA256(secret, `${time}.${rawBody}`), hex,
//      comparación en tiempo constante. Header ausente/malformado o firma inválida → 401,
//      SIN tocar la DB ni el notifier (fail-closed).
//   2. Parsea el payload de Cloudflare Stream: { uid, status: { state }, thumbnail, ... }.
//      Payload no-JSON → 400, sin tocar DB ni notifier.
//   3. state='ready' → videoStatusUpdater.mark_ready({ cloudflare_uid: uid,
//      thumbnail_url: payload.thumbnail ?? null,
//      duration_seconds: payload.duration ?? null }) — duration_seconds SIEMPRE presente
//      como key (null explícito si Stream no reportó duration), nunca undefined (68.13).
//      state='error' → videoStatusUpdater.mark_failed({ cloudflare_uid: uid,
//      failure_reason: <de status.errorReasonText/Code> }).
//      Cualquier otro state (p.ej. 'inprogress') → no-op, 200, sin notify.
//   4. En ready/error (haya o no filas afectadas) invoca notifier.notify_video_event
//      (SOLO el gancho — registro del evento; el envío real de push llega en Ola 2).
//   5. Idempotente: mark_ready/mark_failed pueden afectar 0 filas (re-entrega para un video
//      ya en ese estado, o uid desconocido) → 200 igual (evita reintentos de Cloudflare).
//   6. Método != POST → 405.
//   NUNCA actualiza `properties` (el enum property_status no tiene media_failed, y en
//   upload-first el video puede no tener property_id todavía) — SOLO la fila property_videos
//   filtrada por cloudflare_uid.

export const WEBHOOK_SIGNATURE_HEADER = "Webhook-Signature";

// ── Payload de Cloudflare Stream (solo los campos que la EF usa) ─────────────

export interface CloudflareStreamWebhookStatus {
  state: string; // 'ready' | 'error' | 'inprogress' | otros estados de Stream
  errorReasonCode?: string;
  errorReasonText?: string;
}

export interface CloudflareStreamWebhookPayload {
  uid: string;
  status: CloudflareStreamWebhookStatus;
  thumbnail?: string;
  duration?: number; // segundos, fraccional (68.13) — solo presente cuando state='ready'
}

// ── VideoStatusUpdater — escritura en property_videos, SIEMPRE por cloudflare_uid ─
// El adapter real (GREEN) hace UPDATE public.property_videos WHERE cloudflare_uid = $1;
// devuelve el número de filas afectadas (0 = uid desconocido, o transición ya aplicada
// —idempotencia—; en ambos casos el handler responde 200 igual, nunca error).

export interface MarkVideoReadyParams {
  cloudflare_uid: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
}

export interface MarkVideoFailedParams {
  cloudflare_uid: string;
  failure_reason: string;
}

export interface VideoStatusUpdater {
  mark_ready(params: MarkVideoReadyParams): Promise<number>;
  mark_failed(params: MarkVideoFailedParams): Promise<number>;
}

// ── VideoEventNotifier — gancho de push (Ola 0; el envío real llega en Ola 2) ────

export type VideoNotifyEvent = "video_ready" | "video_failed";

export interface VideoEventNotifier {
  notify_video_event(event: VideoNotifyEvent, cloudflare_uid: string): Promise<void>;
}

// ── AdCreativeStatusUpdater — extensión ADITIVA (subtarea 169.5) ───────────────
// La rama de anuncios: el handler intenta PRIMERO videoStatusUpdater (arriba,
// contra property_videos, SIN CAMBIOS) y SOLO SI ese UPDATE afectó 0 filas
// intenta ad_creatives (por cloudflare_uid). Por construcción, un cloudflare_uid
// de un video de propiedad JAMÁS llega aquí: su UPDATE sobre property_videos
// afecta 1 fila y la rama de abajo ni se evalúa.
//
// `adCreativeStatusUpdater` es OPCIONAL a propósito en StreamWebhookDeps: la
// suite EXISTENTE de 68.5 (handler.test.ts) nunca lo inyecta y no debe
// modificarse — el handler debe tratar su ausencia como "no hay rama de
// anuncios que intentar" (200 idempotente, igual que antes de 169.5), nunca
// como error.
//
// AD_DURATION_INVALID (R2 de la tarea 169: duración 6–30 s de un anuncio,
// distinta de los 60–120 s de propiedades): Stream ya capó el MÁXIMO en 30 s
// (mint-ad-upload-url pide maxDurationSeconds:30, subtarea 169.4). El MÍNIMO
// de 6 s solo se puede verificar contra `payload.duration`, la duración REAL
// que reporta ESTE webhook al pasar a 'ready'. Fuera de [6,30] ⇒ mark_failed
// con reason_code=AD_DURATION_INVALID en vez de mark_ready — el creativo va a
// 'failed', NUNCA a 'ready', aunque Stream haya reportado state='ready'.
// Duración AUSENTE en el payload 'ready' ⇒ también AD_DURATION_INVALID:
// fail-closed, sin duration_seconds no hay forma de verificar el mínimo de 6 s
// (mismo criterio fail-closed que el resto del repo: no se asume válido lo que
// no se puede verificar).
//
// ad_creatives (20260816000005_ads_schema.sql) NO tiene columna de razón de
// falla (a diferencia de property_videos.failure_reason) — reason_code viaja
// en el contrato del updater (para que el handler sea testeable y explícito
// sobre POR QUÉ falló), pero si el adapter real la persiste o no es una
// decisión de GREEN fuera del alcance de este RED.

export const AD_DURATION_INVALID = "AD_DURATION_INVALID";
export const AD_MIN_DURATION_SECONDS = 6;
export const AD_MAX_DURATION_SECONDS = 30;

export interface MarkAdCreativeReadyParams {
  cloudflare_uid: string;
  thumbnail_url: string | null;
  duration_seconds: number;
}

export interface MarkAdCreativeFailedParams {
  cloudflare_uid: string;
  reason_code: string;
}

export interface AdCreativeStatusUpdater {
  mark_ready(params: MarkAdCreativeReadyParams): Promise<number>;
  mark_failed(params: MarkAdCreativeFailedParams): Promise<number>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────
// webhookSecret se lee de Deno.env.get('STREAM_WEBHOOK_SECRET') en index.ts (GREEN);
// aquí se inyecta para que los tests sean deterministas (sin tocar el entorno real).

export interface StreamWebhookDeps {
  webhookSecret: string;
  videoStatusUpdater: VideoStatusUpdater;
  notifier: VideoEventNotifier;
  /** OPCIONAL (169.5): ausente ⇒ el handler se comporta EXACTAMENTE como antes de 169.5. */
  adCreativeStatusUpdater?: AdCreativeStatusUpdater;
}
