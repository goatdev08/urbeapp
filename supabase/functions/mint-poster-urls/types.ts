// supabase/functions/mint-poster-urls/types.ts
// Tipos y contratos de DI para la Edge Function mint-poster-urls — subtarea 89.1.
// Solo interfaces; sin imports de supabase-js (el adapter real vive en _shared/clients.ts, GREEN).
//
// Responsabilidad de la EF (portadas del grid de propiedades, PRD-beta):
//   1. Auth: verify_jwt del gateway ya exige JWT; el handler además re-verifica con
//      CallerVerifier para obtener el uid del caller (nunca del body).
//   2. Por cada property_id: primer video 'ready' (por position), autorizado si
//      properties.owner_user_id = caller (CUALQUIER status) O properties.status = 'active'
//      (público). service_role bypassa RLS — esta autorización por-item vive en el
//      PosterUrlMinter, es la única barrera.
//   3. Fail-closed por item (NUNCA batch-wide): no autorizado / sin video ready / sin
//      cloudflare_uid / error de firma → el item se OMITE del array; el resto del batch
//      sigue. property_ids vacío → { posters: [] } sin tocar la red.
//   4. 200 { posters: [{ property_id, posterUrl }] } — SOLO los autorizados+disponibles.

// ── CallerVerifier — mismo contrato que mint-upload-url / mint-thumbnail-url ──
// Cualquier usuario autenticado puede pedir portadas; la autorización real es
// por-item (owner-o-active), resuelta dentro del PosterUrlMinter.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── Resultado por propiedad ───────────────────────────────────────────────────

export interface MintedPoster {
  property_id: string;
  posterUrl: string;
}

// ── PosterUrlMinter — batch, auth combinada por item ──────────────────────────
//
// El adapter real (make_poster_url_minter, GREEN, en _shared/clients.ts) hace:
//   1. JOIN property_videos ⋈ properties (owner_user_id, status), filtrando:
//        property_videos.status = 'ready'
//        AND property_videos.deleted_at IS NULL
//        AND property_videos.property_id IN (property_ids)
//      ordenado por position ASC — se queda con el PRIMER video ready por propiedad.
//   2. Autoriza cada fila: properties.owner_user_id === caller_id (cualquier status)
//      O properties.status === 'active' (público). No autorizado → se OMITE.
//   3. Sin cloudflare_uid en la fila (legacy/en vuelo) → se OMITE.
//   4. Firma posterUrl a time = COALESCE(thumbnail_pct,50)/100 × duration_seconds,
//      reusando el mismo mecanismo (sub=cloudflare_uid, token en el path) que
//      build_poster_url/sign_stream_token de make_video_url_minter (68.15).
//      Error de firma (JWK inválido, hlsConfig ausente) → se OMITE esa fila,
//      SIN lanzar — el batch nunca se rompe por un item.
//   5. service_role bypassa RLS: el filtro owner-o-active del código es la
//      ÚNICA barrera de seguridad — no se olvida.

export interface PosterUrlMinter {
  mint_posters(property_ids: string[], caller_id: string): Promise<MintedPoster[]>;
}

// ── Input validado ────────────────────────────────────────────────────────────

export interface MintPosterUrlsInput {
  property_ids: string[]; // UUIDs; puede ser vacío (a diferencia de mint-video-url)
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintPosterUrlsDeps {
  callerVerifier: CallerVerifier;
  posterUrlMinter: PosterUrlMinter;
}

// ── Shape de respuesta 200 ─────────────────────────────────────────────────────

export interface MintPosterUrlsResponse {
  posters: MintedPoster[];
}
