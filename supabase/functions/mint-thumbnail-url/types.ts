// supabase/functions/mint-thumbnail-url/types.ts
// Tipos y contratos de DI para la Edge Function mint-thumbnail-url — subtarea 68.14.
// Solo interfaces; sin imports de supabase-js (el adapter real vive en _shared/clients.ts, GREEN).
//
// Responsabilidad de la EF (thumbnail picker de Cloudflare Stream, spec 68.7 §6.1):
//   1. Parse body { cloudflare_uid } → 400 si falta/vacío/no-string.
//   2. callerVerifier.verify_caller(authHeader) → 401 UNAUTHENTICATED (frontera de confianza,
//      el uid SIEMPRE sale del JWT, nunca del body).
//   3. videoLoader.load(cloudflare_uid): null (inexistente) → 404 VIDEO_NOT_FOUND.
//   4. Ownership fail-closed: agent_id === caller O property_owner_id === caller.
//      Ninguno de los dos → 403 FORBIDDEN_NOT_OWNER, SIN mintar token.
//   5. Estado: 'ready' o 'processing' → mintar (durationSeconds puede ser null si aún
//      processing). 'failed', 'archived' (o fila sin cloudflare_uid) → 404 VIDEO_NOT_FOUND.
//   6. urlSigner.sign(cloudflare_uid) firma el JWT RS256 (UN token cubre todos los frames,
//      el cliente arma ?time=<Ns>&token=<token> por frame). Si el signer lanza (config de
//      firma ausente/incompleta) → 500 INTERNAL_ERROR, NUNCA se devuelve URL sin firmar.
//   7. 200 { baseUrl, token, durationSeconds, expiresIn }.

// ── CallerVerifier — mismo contrato que mint-upload-url (solo autenticación) ─
// Cualquier usuario autenticado puede pedir un thumbnail token; la autorización real
// es el chequeo de ownership contra la fila cargada (paso 4).

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── ThumbnailVideoLoader — ownership + estado + duración ──────────────────────
// El adapter real (GREEN) hace un SELECT sobre property_videos con LEFT JOIN properties
// para resolver property_owner_id (propiedad linkeada) en la misma consulta. null = la
// fila no existe (cloudflare_uid desconocido).

export type ThumbnailVideoStatus =
  | "uploading"
  | "processing"
  | "ready"
  | "failed"
  | "archived";

export interface ThumbnailVideoRow {
  agent_id: string | null;
  property_owner_id: string | null;
  status: ThumbnailVideoStatus;
  cloudflare_uid: string | null;
  duration_seconds: number | null;
}

export interface ThumbnailVideoLoader {
  load(cloudflare_uid: string): Promise<ThumbnailVideoRow | null>;
}

// ── ThumbnailUrlSigner — encapsula la firma RS256 real ────────────────────────
// Lanza (throw) si falta la config de firma (JWK/kid) — el handler lo traduce a
// 500 INTERNAL_ERROR sin devolver baseUrl/token (fail-closed, nunca URL sin firmar).
// El adapter real (GREEN, en _shared/clients.ts) produce:
//   baseUrl = https://customer-<sub>.cloudflarestream.com/<uid>/thumbnails/thumbnail.jpg
//             (o .../<uid>/thumbnails/thumbnail.jpg sobre videodelivery.net si no hay
//             subdominio configurado)
//   token   = JWT RS256, header { alg:'RS256', kid: STREAM_SIGNING_KEY_ID },
//             payload { sub: cloudflare_uid, kid: STREAM_SIGNING_KEY_ID, exp: now+ttl }
//   expiresIn = TTL en segundos (app_config.signed_url_ttl_seconds, fallback 14400)

export interface ThumbnailSignResult {
  baseUrl: string;
  token: string;
  expiresIn: number;
}

export interface ThumbnailUrlSigner {
  sign(cloudflare_uid: string): Promise<ThumbnailSignResult>;
}

// ── Input validado ────────────────────────────────────────────────────────────

export interface MintThumbnailUrlInput {
  cloudflare_uid: string;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintThumbnailUrlDeps {
  callerVerifier: CallerVerifier;
  videoLoader: ThumbnailVideoLoader;
  urlSigner: ThumbnailUrlSigner;
}

// ── Shape de respuesta 200 ─────────────────────────────────────────────────────

export interface MintThumbnailUrlResponse {
  baseUrl: string;
  token: string;
  durationSeconds: number | null;
  expiresIn: number;
}
