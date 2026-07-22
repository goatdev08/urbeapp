// supabase/functions/mint-video-url/types.ts
// Tipos y contratos de DI para la Edge Function mint-video-url.
// Solo interfaces; sin imports de supabase-js (que vive en _shared/clients.ts).
//
// Responsabilidad de la EF:
//   MINTER PURO: recibe property_ids, devuelve signed URLs de video (TTL 3600 s).
//   Auth: verify_jwt del gateway de Supabase exige JWT válido; la EF no re-verifica.
//   Scope: no hace query de feed (radio/anti-clustering) — eso es la tarea #9.

// ── Input validado ────────────────────────────────────────────────────────────

export interface MintVideoUrlInput {
  property_ids: string[]; // UUIDs; no vacío (validación de no-vacío y forma la hace el handler)
}

// ── Resultado por video ───────────────────────────────────────────────────────

export interface MintedVideo {
  property_id: string;
  video_id: string;
  signed_url: string;
  // ── posterUrl (subtarea 68.15, aditivo) ─────────────────────────────────────
  // URL firmada de la portada (thumbnail) para render en feed/detalle:
  //   - Fila Stream (cloudflare_uid): URL firmada de
  //     `https://<domain>/<uid>/thumbnails/thumbnail.jpg[?time=<T>s]&token=<jwt>`,
  //     donde T = COALESCE(thumbnail_pct,50)/100 × duration_seconds (.toFixed(1));
  //     sin `?time=` si duration_seconds es null. Mismo dominio y mecanismo de
  //     firma (sub=uid) que el manifest HLS.
  //   - Fila legacy Storage (sin cloudflare_uid): siempre null explícito.
  // Opcional en el tipo (no `posterUrl: string | null` estricto) para que los
  // productores existentes de MintedVideo (adapter real en clients.ts, fixtures
  // de handler.test.ts) sigan compilando sin tocarse durante el RED de 68.15;
  // el GREEN debe poblarlo explícitamente (incl. `null` en legacy) en TODAS las
  // filas — los tests nuevos lo exigen por presencia+valor, no solo por tipo.
  posterUrl?: string | null;
}

// ── VideoUrlMinter ────────────────────────────────────────────────────────────
//
// Dependencia inyectable que produce signed URLs para un lote de propiedades.
//
// El adapter real (21.3, en _shared/clients.ts) hace:
//   1. JOIN properties ⋈ property_videos filtrando:
//        properties.status = 'active'
//        AND property_videos.status = 'ready'
//        AND properties.deleted_at IS NULL
//        AND property_videos.deleted_at IS NULL
//   2. Por cada fila resultante llama createSignedUrl(storage_path, 3600).
//   3. Los property_ids sin video válido se EXCLUYEN del resultado
//      (decisión de dominio: batch → 200 con subconjunto; sin 404 parciales).
//   4. Opera con service_role, que bypassa RLS; los filtros SQL del paso 1
//      son la única barrera de seguridad — no se olvidan.

export interface VideoUrlMinter {
  mint_signed_urls(property_ids: string[]): Promise<MintedVideo[]>;
}

// ── HlsSignerConfig — seam DI del firmante Stream (subtarea 68.6) ────────────
//
// Config inyectable para que make_video_url_minter (adapter real en clients.ts)
// pueda firmar URLs HLS de Cloudflare Stream por fila con cloudflare_uid, sin que
// el minter dependa directo de Deno.env ni de una consulta a app_config:
//   - streamSigningKeyId / streamSigningJwk: mismos secrets que STREAM_SIGNING_KEY_ID /
//     STREAM_SIGNING_JWK (JWK RSA privado, JSON codificado en base64 estándar).
//   - signedUrlTtlSeconds: viene de app_config.signed_url_ttl_seconds (~14400, 4h);
//     nunca hardcodeado en el minter.
//   - streamCustomerSubdomain: opcional; si falta, el minter puede resolver el dominio
//     `videodelivery.net` en vez de `customer-<code>.cloudflarestream.com`.
//
// Fail-closed: si falta hlsConfig, o streamSigningJwk no parsea a un JWK RSA válido,
// las filas con cloudflare_uid se EXCLUYEN del batch (no se lanza, no rompe las demás).
// Precedencia dual-ref: una fila con cloudflare_uid Y storage_path usa SIEMPRE la
// rama Stream (cloudflare_uid gana), por la migración 20260720000002.
export interface HlsSignerConfig {
  streamSigningKeyId: string;
  streamSigningJwk: string;
  signedUrlTtlSeconds: number;
  streamCustomerSubdomain?: string;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintVideoUrlDeps {
  videoUrlMinter: VideoUrlMinter;
}
