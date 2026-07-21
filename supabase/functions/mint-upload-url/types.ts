// supabase/functions/mint-upload-url/types.ts
// Tipos y contratos de DI para la Edge Function mint-upload-url — subtarea 68.3.
// Solo interfaces; sin imports de supabase-js (el adapter real vive en _shared/clients.ts, GREEN).
//
// Responsabilidad de la EF (flujo UPLOAD-FIRST, Cloudflare Stream Direct Creator Upload):
//   1. Extrae uid del JWT del caller (nunca del body) vía CallerVerifier.
//   2. Invariante de concurrencia POR AGENTE (regla §13.2, fail-closed): si el agente ya
//      tiene >=1 video en status IN ('uploading','processing') AND deleted_at IS NULL
//      → 409 UPLOAD_IN_PROGRESS, sin llamar a Stream ni insertar.
//   3. Crea el upload en Stream — POST
//      https://api.cloudflare.com/client/v4/accounts/{STREAM_ACCOUNT_ID}/stream/direct_upload
//      con { maxDurationSeconds: 120, requireSignedURLs: true, creator: uid }.
//      Si Stream falla (no-2xx o success:false) → 502 STREAM_UPLOAD_FAILED, SIN insertar
//      (cero filas huérfanas).
//   4. Inserta property_videos(agent_id=uid, property_id=NULL, status='uploading', position=1,
//      cloudflare_uid=<uid de Stream>, tus_upload_url=<uploadURL de Stream>).
//      Si el insert falla → 500 INTERNAL_ERROR.
//   5. 200 { uploadUrl, uid } — uid es el que Stream asignó al video (NO el uid del agente).

export const STREAM_MAX_DURATION_SECONDS = 120;
export const STREAM_REQUIRE_SIGNED_URLS = true;

// ── CallerVerifier — mismo contrato que mint-r2-url (solo autenticación) ─────
// No hay chequeo de rol aquí: cualquier agente autenticado puede pedir un upload slot;
// la invariante de negocio real es la de concurrencia (ActiveUploadChecker).

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── ActiveUploadChecker — invariante de concurrencia por agente (§13.2) ──────
// El adapter real (GREEN) hace:
//   SELECT count(*) FROM property_videos
//   WHERE agent_id = $1 AND status IN ('uploading','processing') AND deleted_at IS NULL
// count >= 1 → el handler responde 409 sin tocar Stream ni la tabla.

export interface ActiveUploadChecker {
  count_active_uploads(agent_id: string): Promise<number>;
}

// ── StreamUploadCreator — adapter de Direct Creator Upload de Cloudflare Stream ─
// Lanza (throw) si la respuesta de Stream no es 2xx o success:false — el handler
// lo traduce a 502 STREAM_UPLOAD_FAILED. Nunca deja fila huérfana en ese caso.

export interface StreamDirectUploadParams {
  creator: string;
  maxDurationSeconds: number;
  requireSignedURLs: boolean;
}

export interface StreamDirectUploadResult {
  uploadURL: string;
  uid: string;
}

export interface StreamUploadCreator {
  create_direct_upload(
    params: StreamDirectUploadParams,
  ): Promise<StreamDirectUploadResult>;
}

// ── VideoRegistrar — inserta la fila 'uploading' (upload-first, property_id NULL) ─
// Lanza (throw) si el insert falla — el handler lo traduce a 500 INTERNAL_ERROR.

export interface RegisterUploadingVideoParams {
  agent_id: string;
  property_id: null;
  status: "uploading";
  position: 1;
  cloudflare_uid: string;
  tus_upload_url: string;
}

export interface VideoRegistrar {
  register_uploading_video(params: RegisterUploadingVideoParams): Promise<void>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintUploadUrlDeps {
  callerVerifier: CallerVerifier;
  activeUploadChecker: ActiveUploadChecker;
  streamUploadCreator: StreamUploadCreator;
  videoRegistrar: VideoRegistrar;
}

// ── Shape de respuesta 200 ─────────────────────────────────────────────────────

export interface MintUploadUrlResponse {
  uploadUrl: string;
  uid: string;
}
