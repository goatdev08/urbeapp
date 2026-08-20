// supabase/functions/mint-ad-urls/types.ts
// Tipos y contratos de DI para la Edge Function mint-ad-urls — subtarea 169.5.
// Solo interfaces; sin imports de supabase-js (el adapter real vive en _shared/clients.ts, GREEN).
// Calco deliberado de mint-poster-urls/types.ts (subtarea 89.1) — mismo mecanismo
// de firma (sign_stream_token/build_poster_url, token en el PATH), mismo patrón
// de auth combinada por-item y batch fail-closed.
//
// Responsabilidad de la EF (portadas firmadas de creativos de anuncio):
//   1. Auth: verify_jwt del gateway ya exige JWT; el handler además re-verifica con
//      CallerVerifier para obtener el uid del caller (nunca del body).
//   2. Por cada creative_id (ad_creatives.id): autorizado si el caller es MIEMBRO
//      ACTIVO de la agencia dueña del creativo (agency_id, columna directa —
//      ad_creatives NO necesita join a otra tabla para la ownership, a diferencia
//      de property_videos⋈properties) O el creativo está referenciado por al
//      menos un `ads` con status='active' Y vigente (now() BETWEEN starts_at AND
//      ends_at) — el análogo de "properties.status='active'" en mint-poster-urls.
//      service_role bypassa RLS — esta autorización por-item vive en el
//      AdUrlMinter, es la única barrera.
//   3. Fail-closed por item (NUNCA batch-wide): no autorizado / creativo no
//      'ready' / sin cloudflare_uid / error de firma → el item se OMITE del
//      array, SIN distinguir "no autorizado" de "no existe" hacia afuera. El
//      resto del batch sigue. creative_ids vacío → { urls: [] } sin tocar la red.
//   4. NUNCA devuelve una URL sin firmar — cada posterUrl sale de sign_stream_token
//      + build_poster_url (mismo mecanismo que mint-poster-urls/mint-video-url):
//      el token va SIEMPRE en el PATH, nunca como query param `?token=`
//      (recordatorio caro de #68: 36 tests con dobles no cazaron esto en su
//      momento porque nunca ejercitaron la URL real).
//   5. 200 { urls: [{ creative_id, posterUrl, videoUrl }] } — SOLO los autorizados+disponibles.

// ── CallerVerifier — mismo contrato que mint-poster-urls / mint-thumbnail-url ──
// Cualquier usuario autenticado puede pedir URLs; la autorización real es
// por-item (miembro-o-ad-activo), resuelta dentro del AdUrlMinter.

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── Resultado por creativo ─────────────────────────────────────────────────────

export interface MintedAdUrl {
  creative_id: string;
  posterUrl: string;
  /** 170.8: manifest HLS firmado con el MISMO token que el póster. Sin esto el
   *  anuncio era una tarjeta estática dentro de un feed de video. */
  videoUrl: string;
}

// ── AdUrlMinter — batch, auth combinada por item ───────────────────────────────
//
// El adapter real (make_ad_url_minter, GREEN, en _shared/clients.ts) hace:
//   1. Resuelve la agencia ACTIVA del caller (mismo mecanismo que
//      make_advertiser_authorizer, 169.4: agency_members.select('agency_id')
//      .eq('user_id',caller_id).eq('status','active').maybeSingle() — SIN el
//      paso adicional de org_can_advertise, que aquí no aplica: mint-ad-urls
//      solo lee, no habilita publicar).
//   2. Trae ad_creatives ⋈ ads (reverse FK ads.creative_id) filtrando
//      status='ready' AND id IN (creative_ids).
//   3. Autoriza cada fila: agency_id === agencia del caller (cualquier estado
//      del creativo, siempre que sea 'ready' por el filtro de arriba) O algún
//      `ads` embebido tiene status='active' AND now() BETWEEN starts_at AND
//      ends_at (público/vigente). No autorizado → se OMITE, sin filtrar si el
//      creative_id existe o no.
//   4. Sin cloudflare_uid en la fila → se OMITE.
//   5. Firma reusando sign_stream_token/build_poster_url (mismo mecanismo que
//      make_poster_url_minter, 89.1): token EN EL PATH. ad_creatives NO tiene
//      columna thumbnail_pct (a diferencia de property_videos) — el time SIEMPRE
//      usa el default 50% de build_poster_url (se le pasa thumbnail_pct=null).
//      Error de firma (JWK inválido, hlsConfig ausente) → se OMITE esa fila,
//      SIN lanzar — el batch nunca se rompe por un item.
//   6. service_role bypassa RLS: el filtro miembro-o-activo del código es la
//      ÚNICA barrera de seguridad — no se olvida.

export interface AdUrlMinter {
  mint_ad_urls(creative_ids: string[], caller_id: string): Promise<MintedAdUrl[]>;
}

// ── Input validado ────────────────────────────────────────────────────────────

export interface MintAdUrlsInput {
  creative_ids: string[]; // UUIDs de ad_creatives; puede ser vacío
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface MintAdUrlsDeps {
  callerVerifier: CallerVerifier;
  adUrlMinter: AdUrlMinter;
}

// ── Shape de respuesta 200 ─────────────────────────────────────────────────────

export interface MintAdUrlsResponse {
  urls: MintedAdUrl[];
}
