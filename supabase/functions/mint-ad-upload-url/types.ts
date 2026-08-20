// supabase/functions/mint-ad-upload-url/types.ts
// Tipos y contratos de DI para la Edge Function mint-ad-upload-url — subtarea 169.4.
// Solo interfaces; sin imports de supabase-js (el adapter real vive en _shared/clients.ts, GREEN).
// Calco deliberado de mint-upload-url/types.ts (subtarea 68.3) — mismo pipeline
// upload-first hacia Cloudflare Stream Direct Creator Upload — con DOS diferencias
// de negocio (duración y scope de concurrencia) MÁS el reaper de 103.1 parte B
// reusado tal cual (mismo STALE_UPLOAD_MS): copiar el pipeline sin copiar su
// arreglo heredaría el 409 permanente que #103 tuvo que resolver — solo que aquí
// bloquearía a una ORGANIZACIÓN entera, no a un agente:
//
//   DIFERENCIA 1 — duración: STREAM_MAX_DURATION_SECONDS = 30 (propiedades usa 120).
//     El MÍNIMO de 6 s NO lo impone esta EF (Stream no lo puede validar en el mint) —
//     se valida al pasar a 'ready' (169.5, webhook) y al elegir el archivo en el
//     cliente (169.6). Esta EF NUNCA rechaza por duración corta.
//
//   DIFERENCIA 2 — concurrencia SCOPED POR ORGANIZACIÓN, tabla PROPIA: el 409 de
//     mint-upload-url (ActiveUploadChecker) cuenta sobre `property_videos`, keyeado
//     por agent_id. Como `ad_creatives` es OTRA TABLA por completo, ese checker
//     JAMÁS ve una fila de anuncio. El invariante de concurrencia de ESTA EF vive en
//     ActiveAdUploadChecker, keyeado por agency_id sobre `ad_creatives` — un owner
//     que además es agente puede tener un video de propiedad en vuelo Y subir un
//     anuncio al mismo tiempo, sin tocar una línea del checker viejo (separación por
//     dominio, no por condicionales — el beneficio que justificó la tabla propia).
//
// Responsabilidad de la EF:
//   1. Extrae uid del JWT del caller (nunca del body) vía CallerVerifier.
//   2. Autz fail-closed vía AdvertiserAuthorizer: solo un miembro owner/admin de una
//      organización con private.org_can_advertise (168.1) puede mintear un slot de
//      anuncio. Colapsa TRES causas distintas en el MISMO error FORBIDDEN — mismo
//      criterio fail-closed que private.org_can_advertise, que compone "inexistente |
//      soft-deleted | inactiva | sin capacidad" en un solo booleano sin distinguir:
//        a) el caller no es miembro activo de ninguna organización,
//        b) el caller es miembro pero NO owner/admin (viewer/agent),
//        c) la organización existe y el caller es owner/admin, pero
//           private.org_can_advertise(agency_id) es false (sin la capacidad).
//      Nunca 404 (filtraría existencia) ni 500 (confundiría con un error real).
//   3. Invariante de concurrencia POR ORGANIZACIÓN: si la agencia ya tiene >=1
//      creativo en status IN ('uploading','processing') → 409 AD_UPLOAD_IN_PROGRESS,
//      sin llamar a Stream ni insertar.
//   4. Crea el upload en Stream — POST .../stream/direct_upload con
//      { maxDurationSeconds: 30, requireSignedURLs: true, creator: agency_id }.
//      creator=agency_id (NO el uid del caller): el creativo pertenece a la
//      organización, no a la persona que lo sube (decisión de diseño de esta
//      subtarea, documentada — el creator de mint-upload-url es el agent_id porque
//      property_videos pertenece al agente).
//      Si Stream falla (no-2xx o success:false) → 502 STREAM_UPLOAD_FAILED, SIN
//      insertar (cero filas huérfanas).
//   5. Inserta ad_creatives(agency_id, status='uploading', cloudflare_uid=<uid de
//      Stream>). A diferencia de property_videos, ad_creatives NO tiene columnas
//      position ni tus_upload_url (schema de 169.1, 20260816000005_ads_schema.sql) —
//      el uploadURL se devuelve al cliente pero no se persiste.
//      Si el insert falla → 500 INTERNAL_ERROR.
//   6. 200 { uploadUrl, uid } — uid es el que Stream asignó al video (NO el agency_id).
//      La respuesta JAMÁS incluye credenciales de Stream (account id, api token) ni
//      ningún otro campo que Stream devuelva de más.

export const STREAM_MAX_DURATION_SECONDS = 30;
export const STREAM_REQUIRE_SIGNED_URLS = true;

// ── STALE_UPLOAD_MS — ventana de expiración del reaper (bug heredado de #103) ──
// Copiar el pipeline de mint-upload-url (68.3/103.1 parte B) SIN copiar su
// arreglo hereda el bug: un creativo 'uploading' que nunca llega a Stream (falla
// real, no falso negativo) quedaría 'uploading' PARA SIEMPRE → 409
// AD_UPLOAD_IN_PROGRESS eterno para la organización, arreglable solo con SQL a
// mano. El handler calcula `new Date(Date.now() - STALE_UPLOAD_MS).toISOString()`
// y lo pasa como `stale_before` a ActiveAdUploadChecker; el filtro
// `created_at > stale_before` (solo para 'uploading'; 'processing' no tiene
// ventana porque el webhook lo resuelve solo) vive en el adapter real
// (_shared/clients.ts, GREEN). MISMO valor y semántica que
// mint-upload-url/types.ts:35 (STALE_UPLOAD_MS) — no es un umbral nuevo, es el
// mismo invariante reusado (CLAUDE.md: reusar antes que reescribir).
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


// ── CallerVerifier — mismo contrato que mint-upload-url (solo autenticación) ────
// Sin chequeo de rol aquí: la autorización real vive en AdvertiserAuthorizer.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── AdvertiserAuthorizer — autz fail-closed, colapsa 3 causas en FORBIDDEN ──────
// El adapter real (GREEN, _shared/clients.ts) resuelve la organización ACTIVA del
// caller (invariante 🔒 "máx 1 organización activa por persona",
// agency_members_one_active_per_user) y compone: rol activo owner/admin (patrón
// private.agency_role_of) AND private.org_can_advertise(agency_id) (168.1). El
// agency_id SIEMPRE sale de esta resolución server-side — nunca del body (mismo
// criterio fail-closed que "el uid siempre sale del JWT").

export type AdvertiserAuthorizeResult =
  | { ok: true; agency_id: string }
  | { ok: false; error_code: "FORBIDDEN" };

export interface AdvertiserAuthorizer {
  authorize_advertiser(user_id: string): Promise<AdvertiserAuthorizeResult>;
}

// ── ActiveAdUploadChecker — invariante de concurrencia POR ORGANIZACIÓN ─────────
// El adapter real hace:
//   SELECT count(*) FROM ad_creatives
//   WHERE agency_id = $1
//     AND (status = 'processing' OR (status = 'uploading' AND created_at > $2))
// count >= 1 → el handler responde 409 sin tocar Stream ni la tabla. Tabla y
// clave DISTINTAS del ActiveUploadChecker de mint-upload-url (agent_id sobre
// property_videos) — por diseño, nunca colisiona con un video de propiedad.
//
// Reaper (bug heredado de #103, ver STALE_UPLOAD_MS arriba): `stale_before` ($2,
// ISO) es el corte de expiración para 'uploading' — sin ventana, una fila
// 'uploading' que nunca recibió el binario bloquearía a la organización PARA
// SIEMPRE. 'processing' no tiene ventana porque el webhook lo resuelve solo.

export interface ActiveAdUploadChecker {
  count_active_ad_uploads(
    agency_id: string,
    stale_before: string,
    stale_processing_before: string,
  ): Promise<number>;
}

// ── StreamUploadCreator — adapter de Direct Creator Upload de Cloudflare Stream ─
// Mismo contrato que mint-upload-url, con maxDurationSeconds=30 (STREAM_MAX_DURATION_SECONDS).
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

// ── AdCreativeRegistrar — inserta la fila 'uploading' en ad_creatives ───────────
// Lanza (throw) si el insert falla — el handler lo traduce a 500 INTERNAL_ERROR.
// Shape MÁS ANGOSTO que RegisterUploadingVideoParams (mint-upload-url): ad_creatives
// no tiene columnas property_id/position/tus_upload_url (schema de 169.1).

export interface RegisterUploadingAdCreativeParams {
  agency_id: string;
  status: "uploading";
  cloudflare_uid: string;
}

export interface AdCreativeRegistrar {
  register_uploading_ad_creative(params: RegisterUploadingAdCreativeParams): Promise<void>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintAdUploadUrlDeps {
  callerVerifier: CallerVerifier;
  advertiserAuthorizer: AdvertiserAuthorizer;
  activeAdUploadChecker: ActiveAdUploadChecker;
  streamUploadCreator: StreamUploadCreator;
  adCreativeRegistrar: AdCreativeRegistrar;
}

// ── Shape de respuesta 200 ─────────────────────────────────────────────────────
// EXACTAMENTE estos dos campos — nunca account id / api token / cualquier otro
// campo que Stream devuelva de más (ver test dedicado).

export interface MintAdUploadUrlResponse {
  uploadUrl: string;
  uid: string;
}
