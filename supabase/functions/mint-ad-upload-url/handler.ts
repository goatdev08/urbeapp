// supabase/functions/mint-ad-upload-url/handler.ts
// Edge Function: mintea un upload slot de un solo uso en Cloudflare Stream
// (Direct Creator Upload) para el creativo de un anuncio, scoped por
// ORGANIZACIÓN (agency_id) — calco de mint-upload-url/handler.ts (68.3) con
// dos diferencias documentadas en types.ts: maxDurationSeconds=30 (no 120) y
// concurrencia sobre `ad_creatives` (tabla propia), NUNCA sobre
// property_videos ni el checker viejo (separación por dominio, no por
// condicionales).
// Flujo: OPTIONS → método → deps → auth → autz (org_can_advertise) →
//        concurrencia → Stream → insert → 200.

import type { MintAdUploadUrlDeps, MintAdUploadUrlResponse } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import {
  STALE_UPLOAD_MS,
  STREAM_MAX_DURATION_SECONDS,
  STREAM_REQUIRE_SIGNED_URLS,
} from "./types.ts";

export async function handler(
  req: Request,
  deps?: MintAdUploadUrlDeps,
): Promise<Response> {
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

  // 5. Autz fail-closed vía AdvertiserAuthorizer: solo un miembro owner/admin
  //    de una organización con private.org_can_advertise (168.1) puede
  //    mintear un slot de anuncio. Colapsa TRES causas distintas (sin
  //    organización / rol no owner-admin / sin capacidad) en el MISMO 403 —
  //    nunca 404 (filtraría existencia) ni 500 (confundiría con un error real).
  const authz = await deps.advertiserAuthorizer.authorize_advertiser(uid);
  if (!authz.ok) {
    return error_response(
      "FORBIDDEN",
      "No tienes permiso para publicar anuncios de esta organización",
      403,
    );
  }
  const agency_id = authz.agency_id;

  // 6. Concurrencia POR ORGANIZACIÓN (ad_creatives, tabla PROPIA — nunca
  //    property_videos): si la agencia ya tiene >=1 creativo en
  //    uploading/processing → 409, sin llamar a Stream ni insertar.
  //    `stale_before` (reaper, bug #103 heredado) descarta 'uploading'
  //    colgados hace más de STALE_UPLOAD_MS — 'processing' nunca expira aquí
  //    (lo resuelve el webhook, 169.5).
  const stale_before = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const active_count = await deps.activeAdUploadChecker.count_active_ad_uploads(
    agency_id,
    stale_before,
  );
  if (active_count >= 1) {
    return error_response(
      "AD_UPLOAD_IN_PROGRESS",
      "Ya tienes un anuncio en curso; espera a que termine antes de subir otro",
      409,
    );
  }

  // 7. Crear el upload en Stream. creator=agency_id (NO el uid del caller):
  //    el creativo pertenece a la organización, como todo lo demás de esta
  //    EF. Falla → 502, SIN insertar (cero filas huérfanas).
  let stream_result;
  try {
    stream_result = await deps.streamUploadCreator.create_direct_upload({
      creator: agency_id,
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

  // 8. Insertar la fila 'uploading'. Falla → 500.
  try {
    await deps.adCreativeRegistrar.register_uploading_ad_creative({
      agency_id,
      status: "uploading",
      cloudflare_uid: stream_result.uid,
    });
  } catch {
    return error_response(
      "INTERNAL_ERROR",
      "Error interno al registrar el anuncio en curso",
      500,
    );
  }

  // 9. 200 con EXACTAMENTE { uploadUrl, uid } — nunca credenciales de Stream
  //    ni ningún otro campo que Stream devuelva de más.
  const body: MintAdUploadUrlResponse = {
    uploadUrl: stream_result.uploadURL,
    uid: stream_result.uid,
  };
  return json_response(body, 200);
}
