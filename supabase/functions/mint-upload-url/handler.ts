// supabase/functions/mint-upload-url/handler.ts
// Edge Function: mintea un upload slot de un solo uso en Cloudflare Stream
// (Direct Creator Upload) para el agente autenticado, upload-first.
// Flujo: OPTIONS → método → auth → concurrencia (§13.2) → Stream → insert → 200.

import type { MintUploadUrlDeps, MintUploadUrlResponse } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { STREAM_MAX_DURATION_SECONDS, STREAM_REQUIRE_SIGNED_URLS } from "./types.ts";

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

  // 5. Concurrencia por agente (§13.2, fail-closed): 1 video propio en
  //    uploading/processing → 409, sin llamar a Stream ni insertar.
  const active_count = await deps.activeUploadChecker.count_active_uploads(uid);
  if (active_count >= 1) {
    return error_response(
      "UPLOAD_IN_PROGRESS",
      "Ya tienes un video en curso; espera a que termine antes de subir otro",
      409,
    );
  }

  // 6. Crear el upload en Stream. Falla → 502, SIN insertar (cero filas huérfanas).
  let stream_result;
  try {
    stream_result = await deps.streamUploadCreator.create_direct_upload({
      creator: uid,
      maxDurationSeconds: STREAM_MAX_DURATION_SECONDS,
      requireSignedURLs: STREAM_REQUIRE_SIGNED_URLS,
    });
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
  };
  return json_response(body, 200);
}
