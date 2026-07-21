// supabase/functions/archive-video/types.ts
// Tipos y contratos de DI para la Edge Function archive-video — subtarea 68.8.
// Solo interfaces + stubs de tipos; sin imports de supabase-js (el adapter real vive en
// _shared/clients.ts, GREEN). NADA de lógica aquí.
//
// Responsabilidad de la EF (modelo síncrono con backoff corto, ORDERING SEGURO):
// mueve un video 'ready' de Cloudflare Stream a Cloudflare R2 (cold-store) y libera
// el slot de Stream, SOLO después de confirmar que la copia en R2 quedó escrita.
//
//   1. Parse body { property_video_id } → 400 INVALID_INPUT si falta/vacío/no-string.
//   2. callerVerifier.verify_caller(authHeader) → 401 UNAUTHENTICATED / 403 FORBIDDEN
//      (rol IN ('agent','admin'), mismo patrón que publish-property). Rol 'user' → 403.
//   3. videoLoader.load(property_video_id):
//        - no existe → 404 VIDEO_NOT_FOUND
//        - existe pero el caller no es admin NI el dueño (agent_id) → 403 FORBIDDEN_NOT_OWNER
//        - status distinto de 'ready' (uploading/processing/archived) → 409 VIDEO_STATUS_NOT_ARCHIVABLE
//          (incluye re-archivar uno YA archived: idempotencia resuelta como 409, no 200 no-op —
//          decisión registrada: archivar es una operación de una sola vez con efectos de lado
//          irreversibles hacia Stream; una re-invocación exitosa silenciosa ocultaría bugs del caller)
//        - cloudflare_uid NULL (no debería pasar si status='ready', pero es defensivo) → 422
//          VIDEO_MISSING_CLOUDFLARE_UID
//   4. streamArchiver.enable_download(cloudflare_uid) → { state, url?, percentComplete? }.
//      Si state='inprogress': backoff exponencial CORTO vía sleep INYECTABLE (nunca espera real
//      en tests). Constantes ARCHIVE_BACKOFF_*: delay arranca en INITIAL_MS, se duplica cada
//      vuelta (tope MAX_DELAY_MS), se re-consulta enable_download; se acumula el tiempo
//      "gastado" (suma de delays, no reloj real) y si alcanza MAX_TOTAL_MS antes de ver 'ready'
//      → 202 (pending) SIN llamar delete_video ni mark_archived (idempotente: una
//      re-invocación reintenta desde cero; enable_download de Stream es idempotente).
//   5. state='ready' (con o sin backoff previo) → streamArchiver.fetch_mp4(url) trae los bytes.
//      Si fetch_mp4 lanza → 502 STREAM_DOWNLOAD_FAILED, SIN tocar Stream.delete ni mark_archived
//      (mismo principio fail-closed que el paso de R2: no se pierde nada porque no se cambió nada).
//   6. archiveUploader.upload(archive_key, bytes) sube a R2. archive_key = `archive/<cloudflare_uid>.mp4`
//      (misma convención de prefix "archive/" que mint-r2-url). Si upload lanza (falla el PUT,
//      no-2xx) → 502 R2_UPLOAD_FAILED, y **NO** se llama streamArchiver.delete_video NI
//      videoArchiver.mark_archived — invariante anti-pérdida-de-datos: Stream queda intacto,
//      el feed sigue sirviendo el video, nada se pierde.
//   7. ORDERING SEGURO (punto de no retorno = PUT a R2 confirmado):
//        a. streamArchiver.delete_video(cloudflare_uid) — libera el slot de Stream (deja de
//           pagar minutos). Si esto lanza, la copia en R2 YA es segura: se decide marcar
//           'archived' de todos modos (la copia está a salvo; el borrado de Stream se puede
//           reintentar por fuera / manualmente) y responder 200 igual — NUNCA reintentar el
//           PUT a R2 dos veces por un fallo de limpieza que no perdió datos.
//        b. videoArchiver.mark_archived({ property_video_id, r2_archive_key }) — UPDATE
//           status='archived', archived_at=now(), r2_archive_key=key, cloudflare_uid=NULL.
//   8. 200 { archived: true, r2_archive_key }.
//
// El ORDEN de llamadas (verificable con spies) es el contrato central de esta EF:
//   archiveUploader.upload  →  streamArchiver.delete_video  →  videoArchiver.mark_archived
// NUNCA al revés: jamás se borra de Stream ni se marca archived antes de que R2 confirme.

// ── Input validado ────────────────────────────────────────────────────────────

export interface ArchiveVideoInput {
  property_video_id: string;
}

// ── CallerVerifier — mismo contrato que publish-property (rol agent/admin) ───

export type CallerVerifyResult =
  | { ok: true; user_id: string; role: "agent" | "admin" }
  | { ok: false; error_code: "UNAUTHENTICATED" | "FORBIDDEN" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── VideoLoader — carga la fila a archivar ────────────────────────────────────

export type ArchivableVideoStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "archived";

export interface ArchivableVideoRow {
  id: string;
  agent_id: string | null;
  cloudflare_uid: string | null;
  status: ArchivableVideoStatus;
}

export interface VideoLoader {
  load(property_video_id: string): Promise<ArchivableVideoRow | null>;
}

// ── StreamArchiver — habilita/descarga/borra en Cloudflare Stream ─────────────

export type EnableDownloadState = "inprogress" | "ready";

export interface EnableDownloadResult {
  state: EnableDownloadState;
  url?: string; // presente cuando state === 'ready'
  percentComplete?: number;
}

export interface StreamArchiver {
  enable_download(cloudflare_uid: string): Promise<EnableDownloadResult>;
  fetch_mp4(url: string): Promise<Uint8Array>;
  delete_video(cloudflare_uid: string): Promise<void>;
}

// ── ArchiveUploader — sube el MP4 descargado a Cloudflare R2 (cold-store) ────
// Diseño: una sola dep que encapsula sign_put + PUT (en vez de exponer R2Minter y
// R2Uploader por separado) — más simple de fakear y de leer en el handler; reusa
// la idea de make_r2_url_minter().sign_put ya existente en _shared/clients.ts (GREEN
// la compone junto con un PUT fetch real).

export interface ArchiveUploadResult {
  ok: true;
  key: string;
}

export interface ArchiveUploader {
  /** Lanza (throw) si el PUT a R2 no es 2xx — el handler lo traduce a 502 R2_UPLOAD_FAILED. */
  upload(key: string, body: Uint8Array): Promise<ArchiveUploadResult>;
}

// ── VideoArchiver — escritura final en property_videos ────────────────────────

export interface MarkArchivedParams {
  property_video_id: string;
  r2_archive_key: string;
}

export interface VideoArchiver {
  mark_archived(params: MarkArchivedParams): Promise<void>;
}

// ── Sleep inyectable — para que el backoff no espere de verdad en tests ──────

export type Sleep = (ms: number) => Promise<void>;

// ── Constantes de backoff (corto, síncrono) ───────────────────────────────────
// Secuencia de delays: INITIAL_MS, x2, x2, ... tope MAX_DELAY_MS. Se acumula la suma
// de los delays (NO el reloj real) contra MAX_TOTAL_MS para decidir cuándo dar el
// intento por vencido (202). Con estos valores el handler hace, como máximo, 6
// llamadas a enable_download y 5 sleeps antes de responder 202 (ver handler.test.ts
// para la traza exacta que el GREEN debe reproducir).
export const ARCHIVE_BACKOFF_INITIAL_MS = 1000;
export const ARCHIVE_BACKOFF_MULTIPLIER = 2;
export const ARCHIVE_BACKOFF_MAX_DELAY_MS = 5000;
export const ARCHIVE_BACKOFF_MAX_TOTAL_MS = 15000;

// ── Convención de key en R2 (documentación; NO helper — el GREEN construye el
//    string en handler.ts; los tests hardcodean el literal como valor esperado
//    independiente) ────────────────────────────────────────────────────────────
// archive_key = `archive/${cloudflare_uid}.mp4`  (mismo prefix "archive/" que mint-r2-url).

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface ArchiveVideoDeps {
  callerVerifier: CallerVerifier;
  videoLoader: VideoLoader;
  streamArchiver: StreamArchiver;
  archiveUploader: ArchiveUploader;
  videoArchiver: VideoArchiver;
  sleep: Sleep;
}

// ── Shape de respuesta 200 ─────────────────────────────────────────────────────

export interface ArchiveVideoResponse {
  archived: true;
  r2_archive_key: string;
}

// ── Shape de respuesta 202 (backoff agotado, pendiente, sin cambios de estado) ─

export interface ArchivePendingResponse {
  archived: false;
  pending: true;
}
