// supabase/functions/archive-video/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Ver types.ts para el contrato completo y las
// razones de cada decisión (ordering seguro, backoff, fail-closed).
//
// Orquestación:
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. deps ausentes → 500 INTERNAL_ERROR (nunca propagar excepción cruda)
//   4. Parse JSON body → 400 INVALID_INPUT si falla / property_video_id inválido
//   5. callerVerifier.verify_caller(authHeader) → 401/403
//   6. videoLoader.load → 404 / 403 (no dueño ni admin) / 422 (sin cloudflare_uid) /
//      409 (status no archivable)
//   7. streamArchiver.enable_download + backoff corto (sleep inyectable) hasta 'ready'
//      o hasta agotar ARCHIVE_BACKOFF_MAX_TOTAL_MS → 202 sin tocar Stream/DB
//   8. fetch_mp4 → 502 STREAM_DOWNLOAD_FAILED si falla, sin tocar R2/Stream/DB
//   9. archiveUploader.upload → 502 R2_UPLOAD_FAILED si falla, sin tocar Stream/DB
//  10. ORDERING SEGURO: delete_video (best-effort) → mark_archived → 200

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import {
  ARCHIVE_BACKOFF_INITIAL_MS,
  ARCHIVE_BACKOFF_MAX_DELAY_MS,
  ARCHIVE_BACKOFF_MAX_TOTAL_MS,
  ARCHIVE_BACKOFF_MULTIPLIER,
  type ArchivableVideoRow,
  type ArchiveVideoDeps,
  type ArchiveVideoInput,
} from "./types.ts";

const ARCHIVABLE_STATUSES = new Set<string>(["ready"]);

function parse_input(raw: unknown): ArchiveVideoInput | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.property_video_id !== "string" || obj.property_video_id.trim() === "") {
    return null;
  }
  return { property_video_id: obj.property_video_id };
}

export async function handler(
  req: Request,
  deps?: ArchiveVideoDeps,
): Promise<Response> {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. deps ausentes → nunca propagar excepción cruda
  if (!deps) {
    return error_response("INTERNAL_ERROR", "Dependencias no configuradas", 500);
  }

  // 4. Parse body JSON
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response("INVALID_INPUT", "El cuerpo de la petición no es JSON válido", 400);
  }

  const input = parse_input(raw);
  if (input === null) {
    return error_response("INVALID_INPUT", "property_video_id es requerido y no puede ser vacío", 400);
  }

  // 5. Auth — JWT del solicitante (frontera de confianza, fail-closed)
  //    Sin header Authorization → 401 directo, sin siquiera consultar al
  //    CallerVerifier (evita depender de que el fake/adapter revise el header).
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return error_response("UNAUTHENTICATED", "Autenticación requerida", 401);
  }
  const caller = await deps.callerVerifier.verify_caller(authHeader);
  if (!caller.ok) {
    const status = caller.error_code === "UNAUTHENTICATED" ? 401 : 403;
    return error_response(
      caller.error_code,
      caller.error_code === "UNAUTHENTICATED" ? "Solicitante no autenticado" : "Rol no autorizado",
      status,
    );
  }

  // 6. Cargar el video
  const video: ArchivableVideoRow | null = await deps.videoLoader.load(input.property_video_id);
  if (video === null) {
    return error_response("VIDEO_NOT_FOUND", "El video no existe", 404);
  }

  // Ownership: admin bypassa; agent solo puede archivar lo suyo
  if (caller.role !== "admin" && video.agent_id !== caller.user_id) {
    return error_response("FORBIDDEN_NOT_OWNER", "No eres el dueño de este video", 403);
  }

  if (!ARCHIVABLE_STATUSES.has(video.status)) {
    return error_response(
      "VIDEO_STATUS_NOT_ARCHIVABLE",
      `El video en status '${video.status}' no puede archivarse`,
      409,
    );
  }

  if (video.cloudflare_uid === null) {
    return error_response(
      "VIDEO_MISSING_CLOUDFLARE_UID",
      "El video no tiene una referencia de Cloudflare Stream",
      422,
    );
  }

  const cloudflare_uid = video.cloudflare_uid;

  // 7. enable_download + backoff corto (sleep inyectable, nunca espera real)
  let result = await deps.streamArchiver.enable_download(cloudflare_uid);
  let elapsed_ms = 0;
  let delay_ms = ARCHIVE_BACKOFF_INITIAL_MS;

  while (result.state !== "ready") {
    if (elapsed_ms >= ARCHIVE_BACKOFF_MAX_TOTAL_MS) {
      return json_response({ archived: false, pending: true }, 202);
    }
    await deps.sleep(delay_ms);
    elapsed_ms += delay_ms;
    result = await deps.streamArchiver.enable_download(cloudflare_uid);
    delay_ms = Math.min(delay_ms * ARCHIVE_BACKOFF_MULTIPLIER, ARCHIVE_BACKOFF_MAX_DELAY_MS);
  }

  // 8. Descargar el MP4
  let bytes: Uint8Array;
  try {
    bytes = await deps.streamArchiver.fetch_mp4(result.url!);
  } catch {
    return error_response("STREAM_DOWNLOAD_FAILED", "No se pudo descargar el video de Cloudflare Stream", 502);
  }

  // 9. Subir a R2 (punto de no retorno una vez confirmado)
  const archive_key = `archive/${cloudflare_uid}.mp4`;
  try {
    await deps.archiveUploader.upload(archive_key, bytes);
  } catch {
    return error_response("R2_UPLOAD_FAILED", "No se pudo subir el video a Cloudflare R2", 502);
  }

  // 10. ORDERING SEGURO: R2 confirmado -> borrar de Stream (best-effort) -> marcar archived
  try {
    await deps.streamArchiver.delete_video(cloudflare_uid);
  } catch {
    // La copia en R2 YA es segura: no se pierde nada. El borrado de Stream se puede
    // reintentar por fuera; NUNCA se reintenta el PUT a R2 por esto.
  }

  await deps.videoArchiver.mark_archived({
    property_video_id: input.property_video_id,
    r2_archive_key: archive_key,
  });

  return json_response({ archived: true, r2_archive_key: archive_key }, 200);
}
