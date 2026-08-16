// supabase/functions/stream-webhook/handler.ts
// GREEN — subtarea 68.5. Webhook PÚBLICO de Cloudflare Stream (deploy --no-verify-jwt).
// Verifica la firma HMAC-SHA256 del header Webhook-Signature, actualiza el estado del
// video en property_videos (por cloudflare_uid) y dispara el gancho de notificación.
// Ver types.ts para el contrato completo y handler.test.ts para los edge cases (SEAMS).

import type {
  AdCreativeStatusUpdater,
  CloudflareStreamWebhookPayload,
  StreamWebhookDeps,
} from "./types.ts";
import {
  AD_DURATION_INVALID,
  AD_MAX_DURATION_SECONDS,
  AD_MIN_DURATION_SECONDS,
  WEBHOOK_SIGNATURE_HEADER,
} from "./types.ts";
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

// ── Rama de anuncios (169.5, ADITIVA) ────────────────────────────────────
// Solo se invoca cuando el UPDATE sobre property_videos afectó 0 filas — el
// cloudflare_uid de un video de propiedad real SIEMPRE afecta 1 fila ahí y
// esta función jamás se llega a evaluar para ese caso (aditividad).

/**
 * 🔴 Orden de validación NO es arbitrario: el rango [AD_MIN_DURATION_SECONDS,
 * AD_MAX_DURATION_SECONDS] se valida contra `raw_duration` — la duración
 * CRUDA fraccionaria que reporta Stream — NUNCA contra un valor redondeado.
 * Redondear ANTES de validar dejaría pasar un video de 5.7 s (redondea a 6)
 * violando el mínimo real, que es justo lo único que esta validación existe
 * para imponer (Stream ya capa el máximo en 30 s desde mint-ad-upload-url,
 * 169.4). Por eso este handler NUNCA redondea `duration_seconds` antes de
 * pasarlo al updater — quien persista en la columna `integer` de ad_creatives
 * (el adapter real de AdCreativeStatusUpdater, deliberadamente fuera del
 * alcance de 169.5) es quien decide CUÁNDO redondear, siempre DESPUÉS de que
 * esta validación ya pasó, nunca antes.
 * Duración AUSENTE (Stream no la reportó) ⇒ fail-closed: sin duración no hay
 * forma de verificar el mínimo, así que se trata como inválida.
 */
async function handle_ad_ready_transition(
  updater: AdCreativeStatusUpdater,
  cloudflare_uid: string,
  thumbnail_url: string | null,
  raw_duration: number | null,
): Promise<void> {
  const duration_valid = raw_duration !== null &&
    raw_duration >= AD_MIN_DURATION_SECONDS &&
    raw_duration <= AD_MAX_DURATION_SECONDS;

  if (!duration_valid) {
    await updater.mark_failed({ cloudflare_uid, reason_code: AD_DURATION_INVALID });
    return;
  }

  await updater.mark_ready({ cloudflare_uid, thumbnail_url, duration_seconds: raw_duration });
}

/**
 * 🔴 DECISIÓN TOMADA (coordinador, 2026-08-16): un fallo de infraestructura en
 * la rama de ad_creatives SE PROPAGA — nunca se traga a un 200. No "arreglar"
 * esto envolviéndolo en un catch que devuelva 200; es la decisión documentada,
 * no un descuido.
 *
 * Por qué: `ad_creatives.status='processing'` NO tiene ventana de expiración
 * (169.4 — el reaper solo cubre 'uploading'). Si este error se tragara aquí,
 * el creativo quedaría atorado en 'processing' PARA SIEMPRE, sin ruta de
 * recuperación. El reintento de Cloudflare sobre este mismo webhook es el
 * ÚNICO mecanismo que lo rescata — dejar que la excepción llegue a
 * Deno.serve (→ 500 + reintento) es la conducta correcta, no un efecto
 * colateral.
 *
 * Esto NUNCA ocurre ante un `cloudflare_uid` desconocido (ese caso afecta 0
 * filas y sigue devolviendo 200 normal, como siempre) — solo ante un fallo
 * REAL de infraestructura sobre `ad_creatives` (red/DB), donde reintentar SÍ
 * es lo correcto. El mensaje re-lanzado conserva la causa original
 * (logueable, nunca reemplazada) y nombra explícitamente 'ad_creatives' — un
 * webhook que atiende dos dominios (property_videos Y ad_creatives) necesita
 * poder identificar cuál falló solo con el mensaje.
 */
async function run_ad_creatives_branch(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (cause) {
    const cause_message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Rama de anuncios (ad_creatives) falló: ${cause_message}`);
  }
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
    //
    // 169.5 (ADITIVA): SOLO cuando el UPDATE sobre property_videos afecta 0
    // filas Y deps.adCreativeStatusUpdater está inyectado, se intenta la rama
    // de anuncios (ad_creatives, por el mismo cloudflare_uid). El dep es
    // OPCIONAL a propósito: su ausencia (como en la suite existente de 68.5,
    // que NUNCA lo inyecta) preserva el comportamiento EXACTO de antes de
    // 169.5 — 200 idempotente, sin tocar ad_creatives.
    if (state === "ready") {
      const thumbnail_url = payload.thumbnail ?? null;
      const raw_duration = payload.duration ?? null;
      const property_rows_affected = await deps.videoStatusUpdater.mark_ready({
        cloudflare_uid: uid,
        thumbnail_url,
        duration_seconds: raw_duration,
      });
      if (property_rows_affected === 0 && deps.adCreativeStatusUpdater) {
        const adCreativeStatusUpdater = deps.adCreativeStatusUpdater;
        await run_ad_creatives_branch(() =>
          handle_ad_ready_transition(adCreativeStatusUpdater, uid, thumbnail_url, raw_duration)
        );
      }
      await deps.notifier.notify_video_event("video_ready", uid);
    } else if (state === "error") {
      const reason = status.errorReasonText ?? status.errorReasonCode ?? "unknown_error";
      const property_rows_affected = await deps.videoStatusUpdater.mark_failed({
        cloudflare_uid: uid,
        failure_reason: reason,
      });
      if (property_rows_affected === 0 && deps.adCreativeStatusUpdater) {
        const adCreativeStatusUpdater = deps.adCreativeStatusUpdater;
        await run_ad_creatives_branch(() =>
          adCreativeStatusUpdater.mark_failed({ cloudflare_uid: uid, reason_code: reason })
        );
      }
      await deps.notifier.notify_video_event("video_failed", uid);
    }
    // Cualquier otro estado (p.ej. 'inprogress') → no-op, 200.

    return json_response({ ok: true }, 200);
  };
}
