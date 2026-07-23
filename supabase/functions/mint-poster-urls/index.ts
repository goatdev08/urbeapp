// supabase/functions/mint-poster-urls/index.ts
// Entry point de producción. Construye las dependencias reales (supabase-js
// service_role para JWT + firma RS256) e inyecta al handler. La lógica vive en
// handler.ts y _shared/clients.ts (make_poster_url_minter); los tests importan
// esos módulos directamente y NO pasan por este archivo.
// Auth: verify_jwt del gateway (deploy sin --no-verify-jwt) exige JWT válido
// antes de invocar la función; el CallerVerifier de abajo solo resuelve el uid.
//
// Deploy (gotcha documentado): esta EF importa _shared/clients.ts →
//   supabase functions deploy mint-poster-urls --import-map supabase/functions/deno.json --use-api

import type { SupabaseClient } from "@supabase/supabase-js";
import { handler } from "./handler.ts";
import { make_poster_url_minter, service_client } from "../_shared/clients.ts";
import type { HlsSignerConfig } from "../mint-video-url/types.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

// Default de signed_url_ttl_seconds sembrado en app_config (migración 20260720000001),
// mismo default que mint-video-url/index.ts y mint-thumbnail-url/index.ts.
const DEFAULT_TTL_SECONDS = 14400;

/**
 * Arma el HlsSignerConfig leyendo los secrets STREAM_* del entorno y el TTL de
 * app_config. undefined si faltan los secrets → make_poster_url_minter excluye
 * (fail-closed) las filas Stream, devolviendo un batch degradado. Espeja
 * build_hls_config de mint-video-url/index.ts.
 */
async function build_config(client: SupabaseClient): Promise<HlsSignerConfig | undefined> {
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

Deno.serve(async (req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado. Cualquier
  // usuario autenticado puede pedir portadas; la autorización real es por-item
  // (owner-o-active), resuelta dentro de make_poster_url_minter.
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

  const hls_config = await build_config(client);
  const posterUrlMinter = make_poster_url_minter(client, hls_config);

  return handler(req, { callerVerifier, posterUrlMinter });
});
