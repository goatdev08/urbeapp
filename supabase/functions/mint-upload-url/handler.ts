// supabase/functions/mint-upload-url/handler.ts
// Edge Function: mintea un upload slot de un solo uso en Cloudflare Stream
// (Direct Creator Upload) para el agente autenticado, upload-first.
// Flujo: OPTIONS → método → auth → body (replace/size_bytes) → techo de tamaño
//        → concurrencia (§13.2) → Stream (TUS si size_bytes, básico si no) → insert → 200.

import type { MintUploadUrlDeps, MintUploadUrlResponse } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import {
  MAX_UPLOAD_SIZE_BYTES,
  STALE_UPLOAD_MS,
  STREAM_MAX_DURATION_SECONDS,
  STREAM_REQUIRE_SIGNED_URLS,
} from "./types.ts";

/**
 * 192.1 — `size_bytes` del body: entero positivo → TUS; cualquier otra cosa
 * (ausente, string, 0, negativo, decimal, null) → undefined = camino básico.
 * Tolerante a propósito: un body raro NUNCA debe romper el contrato viejo.
 */
function parse_size_bytes(parsed: unknown): number | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const raw = (parsed as { size_bytes?: unknown }).size_bytes;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) return undefined;
  return raw;
}

export async function handler(req: Request, deps?: MintUploadUrlDeps): Promise<Response> {
  // 1. Preflight CORS
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. Boundary: sin deps inyectadas → 500 (nunca propagar excepción cruda)
  if (!deps) {
    return error_response("INTERNAL_ERROR", "Dependencias no configuradas", 500);
  }

  // 4. Auth: el uid SIEMPRE sale del JWT, nunca del body (fail-closed).
  //    Sin header Authorization → 401 directo, sin siquiera consultar al
  //    CallerVerifier (evita depender de que el fake/adapter revise el header).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return error_response("UNAUTHENTICATED", "Autenticación requerida", 401);
  }
  const caller = await deps.callerVerifier.verify_caller(authHeader);
  if (!caller.ok) {
    return error_response("UNAUTHENTICATED", "Autenticación requerida", 401);
  }
  const uid = caller.user_id;

  // 4b. `replace: true` (quick fix 2026-08-15) — "Cambiar video": cancela los
  //     pendientes NO asociados a propiedad del propio caller antes de contar.
  //     Body ausente/ilegible → sin replace (contrato viejo intacto).
  let replace = false;
  let size_bytes: number | undefined;
  try {
    const parsed: unknown = await req.json();
    replace = typeof parsed === "object" && parsed !== null &&
      (parsed as { replace?: unknown }).replace === true;
    size_bytes = parse_size_bytes(parsed);
  } catch {
    replace = false;
    size_bytes = undefined;
  }

  // 4c. 192.1 — techo de tamaño (2ª capa; el cliente ya valida MAX_VIDEO_SIZE_BYTES).
  //     Antes de cancelar pendientes, contar concurrencia o tocar Stream.
  if (size_bytes !== undefined && size_bytes > MAX_UPLOAD_SIZE_BYTES) {
    return error_response(
      "VIDEO_TOO_LARGE",
      `El video supera el máximo permitido (${Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB)`,
      400,
    );
  }
  if (replace && deps.pendingUploadCanceller) {
    try {
      await deps.pendingUploadCanceller.cancel_unattached_uploads(uid);
    } catch {
      return error_response(
        "INTERNAL_ERROR",
        "Error interno al cancelar el video en curso",
        500,
      );
    }
  }

  // 5. Concurrencia por agente (§13.2, fail-closed): 1 video propio en
  //    uploading/processing → 409, sin llamar a Stream ni insertar. `stale_before`
  //    (reaper, 103.1 parte B) descarta 'uploading' colgados hace más de
  //    STALE_UPLOAD_MS — 'processing' nunca expira aquí (lo resuelve el webhook).
  const stale_before = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const active_count = await deps.activeUploadChecker.count_active_uploads(uid, stale_before);
  if (active_count >= 1) {
    return error_response(
      "UPLOAD_IN_PROGRESS",
      "Ya tienes un video en curso; espera a que termine antes de subir otro",
      409,
    );
  }

  // 6. Crear el upload en Stream. Falla → 502, SIN insertar (cero filas huérfanas).
  //    192.1: con size_bytes → TUS (Upload-Length exacto; único camino >200 MB);
  //    sin él → POST básico intacto para los builds instalados.
  const protocol: "tus" | "basic" = size_bytes !== undefined ? "tus" : "basic";
  let stream_result;
  try {
    const base = {
      creator: uid,
      maxDurationSeconds: STREAM_MAX_DURATION_SECONDS,
      requireSignedURLs: STREAM_REQUIRE_SIGNED_URLS,
    };
    stream_result = size_bytes !== undefined
      ? await deps.streamUploadCreator.create_tus_upload({ ...base, uploadLength: size_bytes })
      : await deps.streamUploadCreator.create_direct_upload(base);
  } catch {
    return error_response(
      "STREAM_UPLOAD_FAILED",
      "No se pudo crear el upload en Cloudflare Stream",
      502,
    );
  }

  // 7. Insertar la fila 'uploading' (upload-first, property_id NULL). Falla → 500.
  try {
    await deps.videoRegistrar.register_uploading_video({
      agent_id: uid,
      property_id: null,
      status: "uploading",
      position: 1,
      cloudflare_uid: stream_result.uid,
      tus_upload_url: stream_result.uploadURL,
    });
  } catch {
    return error_response(
      "INTERNAL_ERROR",
      "Error interno al registrar el video en curso",
      500,
    );
  }

  // 8. 200 con los valores devueltos por Stream
  const body: MintUploadUrlResponse = {
    uploadUrl: stream_result.uploadURL,
    uid: stream_result.uid,
    protocol,
  };
  return json_response(body, 200);
}
