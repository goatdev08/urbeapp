// supabase/functions/mint-thumbnail-url/handler.ts
// Edge Function: mintea baseUrl + token RS256 para pedir frames de thumbnail de
// Cloudflare Stream (UN token cubre todos los ?time=<Ns> que arma el cliente).
// Flujo (fail-closed, spec 68.7 §6.1 / types.ts):
//   OPTIONS → método → deps → auth → body → loader (404) → ownership (403) →
//   estado minteable (404) → signer (500 si falla) → 200.

import type { MintThumbnailUrlDeps, MintThumbnailUrlResponse } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";

export async function handler(req: Request, deps?: MintThumbnailUrlDeps): Promise<Response> {
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
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return error_response("UNAUTHENTICATED", "Autenticación requerida", 401);
  }
  const caller = await deps.callerVerifier.verify_caller(authHeader);
  if (!caller.ok) {
    return error_response("UNAUTHENTICATED", "Autenticación requerida", 401);
  }
  const uid = caller.user_id;

  // 5. Body: cloudflare_uid string no vacío.
  const raw = await req.json().catch(() => ({} as Record<string, unknown>));
  const cloudflare_uid = typeof raw?.cloudflare_uid === "string" ? raw.cloudflare_uid : "";
  if (!cloudflare_uid) {
    return error_response("BAD_REQUEST", "cloudflare_uid es requerido", 400);
  }

  // 6. Video inexistente → 404, sin mintar token.
  const row = await deps.videoLoader.load(cloudflare_uid);
  if (!row) {
    return error_response("VIDEO_NOT_FOUND", "Video no encontrado", 404);
  }

  // 7. Ownership fail-closed: agent_id o property_owner_id (propiedad linkeada).
  const is_owner = row.agent_id === uid || row.property_owner_id === uid;
  if (!is_owner) {
    return error_response("FORBIDDEN_NOT_OWNER", "No eres dueño de este video", 403);
  }

  // 8. Estado no minteable (failed/archived/sin cloudflare_uid) → 404.
  const is_mintable_status = row.status === "ready" || row.status === "processing";
  if (!is_mintable_status || !row.cloudflare_uid) {
    return error_response("VIDEO_NOT_FOUND", "Video no encontrado", 404);
  }

  // 9. Firma RS256. Si falta config/JWK → 500, NUNCA URL sin firmar.
  let sign_result;
  try {
    sign_result = await deps.urlSigner.sign(cloudflare_uid);
  } catch {
    return error_response("INTERNAL_ERROR", "No se pudo firmar el thumbnail", 500);
  }

  const body: MintThumbnailUrlResponse = {
    baseUrl: sign_result.baseUrl,
    token: sign_result.token,
    durationSeconds: row.duration_seconds ?? null,
    expiresIn: sign_result.expiresIn,
  };
  return json_response(body, 200);
}
