// supabase/functions/stream-webhook/handler.ts
// GREEN — subtarea 68.5. Webhook PÚBLICO de Cloudflare Stream (deploy --no-verify-jwt).
// Verifica la firma HMAC-SHA256 del header Webhook-Signature, actualiza el estado del
// video en property_videos (por cloudflare_uid) y dispara el gancho de notificación.
// Ver types.ts para el contrato completo y handler.test.ts para los edge cases (SEAMS).

import type { CloudflareStreamWebhookPayload, StreamWebhookDeps } from "./types.ts";
import { WEBHOOK_SIGNATURE_HEADER } from "./types.ts";
import { error_response, json_response } from "../_shared/response.ts";

// ── Firma HMAC (crypto.subtle real — frontera de seguridad, NO se mockea) ───

async function hmac_sha256_hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Comparación en tiempo constante: evita filtrar por timing en qué byte difiere la firma. */
function timing_safe_equal(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (i < a.length ? a.charCodeAt(i) : 0) ^ (i < b.length ? b.charCodeAt(i) : 0);
  }
  return diff === 0;
}

/** Parsea `time=<unix>,sig1=<hex>`. Cualquier campo ausente → null (header inválido). */
function parse_signature_header(header: string): { time: string; sig1: string } | null {
  const fields: Record<string, string> = {};
  for (const part of header.split(",")) {
    const eq_idx = part.indexOf("=");
    if (eq_idx === -1) continue;
    const key = part.slice(0, eq_idx).trim();
    if (key) fields[key] = part.slice(eq_idx + 1).trim();
  }
  if (!fields.time || !fields.sig1) return null;
  return { time: fields.time, sig1: fields.sig1 };
}

/**
 * Verifica que `header` sea una firma válida de `raw_body` bajo `secret`.
 * sig1 = HMAC-SHA256(secret, `${time}.${raw_body}`) — EXACTO, sobre el rawBody
 * tal cual llegó (nunca re-serializado: cambiaría la firma).
 */
async function verify_signature(
  secret: string,
  raw_body: string,
  header: string | null,
): Promise<boolean> {
  if (!header) return false;
  const parsed = parse_signature_header(header);
  if (!parsed) return false;
  const expected = await hmac_sha256_hex(secret, `${parsed.time}.${raw_body}`);
  return timing_safe_equal(expected, parsed.sig1);
}

// ── Handler ───────────────────────────────────────────────────────────────

export function make_stream_webhook_handler(
  deps: StreamWebhookDeps,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    // 1. Solo POST (Cloudflare siempre llama con POST) — antes de tocar firma/body.
    if (req.method !== "POST") {
      return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
    }

    // 2. Firma HMAC — frontera de seguridad, fail-closed: inválida/ausente/malformada
    //    → 401 SIN tocar la DB ni el notifier.
    const raw_body = await req.text();
    const signature_header = req.headers.get(WEBHOOK_SIGNATURE_HEADER);
    const signature_ok = await verify_signature(deps.webhookSecret, raw_body, signature_header);
    if (!signature_ok) {
      return error_response("INVALID_SIGNATURE", "Firma de webhook inválida", 401);
    }

    // 3. Parseo del payload — body no-JSON → 400, sin tocar DB ni notifier.
    let payload: CloudflareStreamWebhookPayload;
    try {
      payload = JSON.parse(raw_body);
    } catch {
      return error_response("INVALID_PAYLOAD", "Payload no es JSON válido", 400);
    }

    const { uid, status } = payload;
    const state = status?.state;

    // 4. Transición de estado — idempotente: mark_ready/mark_failed pueden afectar
    //    0 filas (uid desconocido o transición ya aplicada) y la respuesta sigue
    //    siendo 200 (evita reintentos de Cloudflare). NUNCA toca `properties`.
    if (state === "ready") {
      await deps.videoStatusUpdater.mark_ready({
        cloudflare_uid: uid,
        thumbnail_url: payload.thumbnail ?? null,
        duration_seconds: payload.duration ?? null,
      });
      await deps.notifier.notify_video_event("video_ready", uid);
    } else if (state === "error") {
      await deps.videoStatusUpdater.mark_failed({
        cloudflare_uid: uid,
        failure_reason: status.errorReasonText ?? status.errorReasonCode ?? "unknown_error",
      });
      await deps.notifier.notify_video_event("video_failed", uid);
    }
    // Cualquier otro estado (p.ej. 'inprogress') → no-op, 200.

    return json_response({ ok: true }, 200);
  };
}
