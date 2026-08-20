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

// ── STALE_UPLOAD_MS — ventana de expiración del reaper (subtarea 103.1, parte B) ─
// Bug #103 derivado: count_active_uploads() contaba TODAS las filas en
// ('uploading','processing') sin ventana de tiempo → si el binario nunca llega
// (falla real, no falso negativo), la fila quedaba 'uploading' PARA SIEMPRE y el
// agente no podía volver a publicar jamás (409 UPLOAD_IN_PROGRESS eterno).
// El handler calcula `new Date(Date.now() - STALE_UPLOAD_MS).toISOString()` y lo
// pasa como `stale_before` al checker; el filtro `created_at > stale_before`
// (solo para 'uploading'; 'processing' no tiene ventana porque el webhook lo
// resuelve solo) vive en el adapter real (_shared/clients.ts).
// ponytail: 15 min fijo, no configurable — una subida legítima en red muy mala
// (>15 min para <200 MB) podría abrir un segundo slot antes de que la primera
// termine; el tope de tamaño (200 MB) hace ese escenario improbable en la demo.
export const STALE_UPLOAD_MS = 15 * 60 * 1000;

// ── STALE_PROCESSING_MS — ventana de expiración de 'processing' (tarea #188) ──
//
// 🔴 ANTES NO EXISTÍA, y esa ausencia era el defecto: 'processing' contaba
// SIEMPRE en el 409 de concurrencia, sin expiración. El argumento era que el
// webhook (169.5) lo resolvía solo — pero el reintento de Cloudflare es una
// ventana FINITA con backoff. Si la base está caída más allá de esa ventana,
// la fila se atora y bloquea a su dueño PARA SIEMPRE. Es el mismo bug #103 que
// ya se pagó para 'uploading', un estado más adelante.
//
// POR QUÉ 1 HORA Y NO 15 MIN: no es el mismo número que STALE_UPLOAD_MS y no
// puede serlo. Una fila 'uploading' vieja es un upload que nunca llegó a
// Stream — expirarla rápido es gratis. Una fila 'processing' es un video que
// Stream está transcodificando de verdad, y una ventana corta mataría
// transcodificaciones válidas.
//
// ⚠️ HONESTIDAD SOBRE ESTE NÚMERO: la tarea pedía MEDIRLO contra el pipeline
// real antes de fijarlo, y no se midió — no hay anuncios desplegados y medirlo
// quemaría cuota de Stream. Se eligió por asimetría de consecuencias, que sí
// es defendible: quedarse CORTO permite que alguien inicie un segundo upload
// mientras el primero aún transcodifica (molesto, acotado); quedarse LARGO
// bloquea a una organización durante todo ese tiempo (grave). Ante la duda,
// corto. Una hora cubre con holgura el peor caso realista (subida de hasta
// 200 MB por datos móviles + transcodificación de un video de ≤30 s), medido
// desde `created_at`, que es cuando arrancó la subida — no cuando empezó la
// transcodificación.
//
// Cambiar este valor es UNA LÍNEA, y upload_window_parity.test.ts falla si se
// cambia de un solo lado.
export const STALE_PROCESSING_MS = 60 * 60 * 1000;


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
// El adapter real (_shared/clients.ts) hace:
//   SELECT count(*) FROM property_videos
//   WHERE agent_id = $1 AND deleted_at IS NULL
//     AND (status = 'processing' OR (status = 'uploading' AND created_at > $2))
// count >= 1 → el handler responde 409 sin tocar Stream ni la tabla.
//
// subtarea 103.1 (parte B, reaper): `stale_before` ($2, ISO) es el corte de
// expiración — sin ventana, una fila 'uploading' que nunca recibió el binario
// bloqueaba al agente PARA SIEMPRE (bug #103 derivado). El handler calcula
// `stale_before` a partir de STALE_UPLOAD_MS y lo pasa siempre; 'processing' no
// tiene ventana porque el webhook lo resuelve solo.

export interface ActiveUploadChecker {
  count_active_uploads(
    agent_id: string,
    stale_before: string,
    stale_processing_before: string,
  ): Promise<number>;
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

// ── PendingUploadCanceller — "Cambiar video" cancela la subida anterior ──────
// Quick fix 2026-08-15 (smoke manual): body { replace: true } → antes del
// chequeo de concurrencia se soft-borran (deleted_at = now()) las filas del
// caller con property_id IS NULL en ('uploading','processing') — los videos
// "del wizard en curso" que aún no pertenecen a ninguna propiedad. Devuelve
// cuántas canceló. Las filas ya asociadas a una propiedad NO se tocan (esas
// siguen bajo la invariante §13.2). Lanza si el UPDATE falla → 500.
// Sin `replace` (builds instalados antes del OTA) el handler no lo llama.

export interface PendingUploadCanceller {
  cancel_unattached_uploads(agent_id: string): Promise<number>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintUploadUrlDeps {
  callerVerifier: CallerVerifier;
  activeUploadChecker: ActiveUploadChecker;
  streamUploadCreator: StreamUploadCreator;
  videoRegistrar: VideoRegistrar;
  /** Opcional para no romper a los llamadores/tests previos: sin él, `replace` se ignora. */
  pendingUploadCanceller?: PendingUploadCanceller;
}

// ── Shape de respuesta 200 ─────────────────────────────────────────────────────

export interface MintUploadUrlResponse {
  uploadUrl: string;
  uid: string;
}
