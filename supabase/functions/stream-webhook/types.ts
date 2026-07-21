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

// ── Deps inyectables del handler ──────────────────────────────────────────────
// webhookSecret se lee de Deno.env.get('STREAM_WEBHOOK_SECRET') en index.ts (GREEN);
// aquí se inyecta para que los tests sean deterministas (sin tocar el entorno real).

export interface StreamWebhookDeps {
  webhookSecret: string;
  videoStatusUpdater: VideoStatusUpdater;
  notifier: VideoEventNotifier;
}
