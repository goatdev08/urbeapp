// supabase/functions/mint-ad-upload-url/handler.ts
// Edge Function: mintea un upload slot de un solo uso en Cloudflare Stream
// (Direct Creator Upload) para el creativo de un anuncio, scoped por
// ORGANIZACIÓN (agency_id) — calco de mint-upload-url/handler.ts (68.3) con
// UNA diferencia documentada en types.ts: concurrencia sobre `ad_creatives`
// (tabla propia), NUNCA sobre property_videos ni el checker viejo
// (separación por dominio, no por condicionales). La "diferencia 1" de 169.4
// (maxDurationSeconds 30 vs 120) se eliminó en #228: mismos límites de video
// que propiedades, incluido el camino TUS >200 MB (calco de 192.1).
// Flujo: OPTIONS → método → deps → auth → autz (org_can_advertise) → body
//        (size_bytes) → techo → concurrencia → Stream (TUS si size_bytes,
//        básico si no) → insert → 200.

import type { MintAdUploadUrlDeps, MintAdUploadUrlResponse } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import {
  MAX_UPLOAD_SIZE_BYTES,
  STALE_PROCESSING_MS,
  STALE_UPLOAD_MS,
  STREAM_MAX_DURATION_SECONDS,
  STREAM_REQUIRE_SIGNED_URLS,
} from "./types.ts";

/**
 * #228 (calco de 192.1) — `size_bytes` del body: entero positivo → TUS;
 * cualquier otra cosa (ausente, string, 0, negativo, decimal, null) →
 * undefined = camino básico. Tolerante a propósito: un body raro NUNCA debe
 * romper el contrato viejo de los builds instalados.
 */
function parse_size_bytes(parsed: unknown): number | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const raw = (parsed as { size_bytes?: unknown }).size_bytes;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) return undefined;
  return raw;
}

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

  // 5b. #228 — body opcional (size_bytes → TUS). Body ausente/ilegible = el
  //     contrato viejo intacto (camino básico, builds instalados).
  let size_bytes: number | undefined;
  try {
    const parsed: unknown = await req.json();
    size_bytes = parse_size_bytes(parsed);
  } catch {
    size_bytes = undefined;
  }

  // 5c. #228 — techo de tamaño (2ª capa; el cliente ya valida el mismo techo).
  //     Antes de contar concurrencia o tocar Stream.
  if (size_bytes !== undefined && size_bytes > MAX_UPLOAD_SIZE_BYTES) {
    return error_response(
      "VIDEO_TOO_LARGE",
      `El video supera el máximo permitido (${Math.round(MAX_UPLOAD_SIZE_BYTES / (1024 * 1024))} MB)`,
      400,
    );
  }

  // 6. Concurrencia POR ORGANIZACIÓN (ad_creatives, tabla PROPIA — nunca
  //    property_videos): si la agencia ya tiene >=1 creativo en
  //    uploading/processing → 409, sin llamar a Stream ni insertar.
    //    AMBOS estados expiran (#188): `stale_before` descarta 'uploading'
    //    colgados hace más de STALE_UPLOAD_MS (reaper, bug #103 heredado), y
    //    `stale_processing_before` descarta 'processing' colgados hace más de
    //    STALE_PROCESSING_MS. Antes 'processing' no expiraba nunca —se
    //    confiaba en el reintento del webhook (169.5)—, y como ese reintento
    //    es una ventana finita con backoff, un creativo atorado bloqueaba a
    //    la organización para siempre.
  const stale_before = new Date(Date.now() - STALE_UPLOAD_MS).toISOString();
  const stale_processing_before = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();
  const active_count = await deps.activeAdUploadChecker.count_active_ad_uploads(
    agency_id,
    stale_before,
    stale_processing_before,
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
  //    #228: con size_bytes → TUS (Upload-Length exacto; único camino
  //    >200 MB); sin él → POST básico intacto para los builds instalados.
  const protocol: "tus" | "basic" = size_bytes !== undefined ? "tus" : "basic";
  let stream_result;
  try {
    const base = {
      creator: agency_id,
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

  // 9. 200 con EXACTAMENTE { uploadUrl, uid, protocol } — nunca credenciales
  //    de Stream ni ningún otro campo que Stream devuelva de más.
  const body: MintAdUploadUrlResponse = {
    uploadUrl: stream_result.uploadURL,
    uid: stream_result.uid,
    protocol,
  };
  return json_response(body, 200);
}
