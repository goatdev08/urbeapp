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

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintVideoUrlDeps {
  videoUrlMinter: VideoUrlMinter;
}
