// supabase/functions/mint-thumbnail-url/index.ts
// Entry point de producción. Construye las dependencias reales (supabase-js
// service_role para JWT + ownership + firma RS256) e inyecta al handler. La
// lógica vive en handler.ts y _shared/clients.ts (make_thumbnail_url_signer);
// los tests importan esos módulos directamente y NO pasan por este archivo.
// Auth: verify_jwt del gateway (deploy sin --no-verify-jwt) exige JWT válido
// antes de invocar la función; el CallerVerifier de abajo solo resuelve el uid.
//
// Deploy (gotcha documentado): esta EF importa _shared/clients.ts →
//   supabase functions deploy mint-thumbnail-url --import-map supabase/functions/deno.json --use-api

import type { SupabaseClient } from "@supabase/supabase-js";
import { handler } from "./handler.ts";
import { make_thumbnail_url_signer, service_client } from "../_shared/clients.ts";
import type { HlsSignerConfig } from "../mint-video-url/types.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  ThumbnailVideoLoader,
  ThumbnailVideoRow,
} from "./types.ts";

// Default de signed_url_ttl_seconds sembrado en app_config (migración 20260720000001),
// mismo default que mint-video-url/index.ts.
const DEFAULT_TTL_SECONDS = 14400;

/**
 * Arma el HlsSignerConfig leyendo los secrets STREAM_* del entorno y el TTL de
 * app_config. undefined si faltan los secrets → make_thumbnail_url_signer
 * lanzaría al firmar; el handler lo traduce a 500 INTERNAL_ERROR (fail-closed).
 * Espeja build_hls_config de mint-video-url/index.ts.
 */
async function build_thumbnail_hls_config(client: SupabaseClient): Promise<HlsSignerConfig | undefined> {
  const streamSigningKeyId = Deno.env.get("STREAM_SIGNING_KEY_ID");
  const streamSigningJwk = Deno.env.get("STREAM_SIGNING_JWK");
  if (!streamSigningKeyId || !streamSigningJwk) return undefined;

  const streamCustomerSubdomain = Deno.env.get("STREAM_CUSTOMER_SUBDOMAIN") ?? undefined;

  let signedUrlTtlSeconds = DEFAULT_TTL_SECONDS;
  try {
    const { data } = await client
      .from("app_config")
      .select("value")
      .eq("key", "signed_url_ttl_seconds")
      .maybeSingle();
    if (typeof data?.value === "number") signedUrlTtlSeconds = data.value;
  } catch {
    // ponytail: fallback al default si app_config no responde (mismo criterio que mint-video-url)
  }

  return { streamSigningKeyId, streamSigningJwk, signedUrlTtlSeconds, streamCustomerSubdomain };
}

/**
 * Adaptador real de ThumbnailVideoLoader: LEFT JOIN properties para resolver
 * property_owner_id (propiedad linkeada) en la misma consulta. El filtro
 * WHERE cloudflare_uid = ... es la barrera real (service_role bypassa RLS);
 * null = fila inexistente (cloudflare_uid desconocido).
 */
function make_thumbnail_video_loader(client: SupabaseClient): ThumbnailVideoLoader {
  return {
    async load(cloudflare_uid: string): Promise<ThumbnailVideoRow | null> {
      const { data, error } = await client
        .from("property_videos")
        .select("agent_id, status, cloudflare_uid, duration_seconds, properties(owner_user_id)")
        .eq("cloudflare_uid", cloudflare_uid)
        .is("deleted_at", null)
        .maybeSingle();
      if (error || !data) return null;

      const raw_property = (data as unknown as { properties: unknown }).properties;
      const property = (Array.isArray(raw_property) ? raw_property[0] : raw_property) as
        | { owner_user_id: string }
        | null
        | undefined;

      return {
        agent_id: data.agent_id,
        property_owner_id: property?.owner_user_id ?? null,
        status: data.status,
        cloudflare_uid: data.cloudflare_uid,
        duration_seconds: data.duration_seconds,
      };
    },
  };
}

Deno.serve(async (req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado. Cualquier
  // usuario autenticado puede pedir un thumbnail token; la autorización real
  // es el chequeo de ownership contra la fila cargada (handler.ts, paso 7).
  const callerVerifier: CallerVerifier = {
    async verify_caller(authHeader: string | null): Promise<CallerVerifyResult> {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }

      const jwt = authHeader.replace(/^Bearer\s+/, "");
      const { data: { user }, error: auth_error } = await client.auth.getUser(jwt);
      if (auth_error || !user) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }

      return { ok: true, user_id: user.id };
    },
  };

  const videoLoader = make_thumbnail_video_loader(client);
  const hls_config = await build_thumbnail_hls_config(client);
  // ponytail: sin secrets STREAM_* el JWK es "" → sign() lanza al decodificar
  // (atob/JSON.parse), el handler lo traduce a 500 INTERNAL_ERROR. Reusa el
  // fail-closed ya probado en el signer en vez de un chequeo undefined extra aquí.
  const urlSigner = make_thumbnail_url_signer(
    hls_config ?? { streamSigningKeyId: "", streamSigningJwk: "", signedUrlTtlSeconds: DEFAULT_TTL_SECONDS },
  );

  return handler(req, { callerVerifier, videoLoader, urlSigner });
});
