// supabase/functions/mint-video-url/index.ts
// Entry point de producción. Construye la dependencia real (supabase-js service_role)
// e inyecta al handler. La lógica vive en handler.ts y _shared/clients.ts (make_video_url_minter);
// los tests importan esos módulos directamente y NO pasan por este archivo.
// Auth: la exige el verify_jwt del gateway (deploy sin --no-verify-jwt); no se valida aquí.

import type { SupabaseClient } from "@supabase/supabase-js";
import { handler } from "./handler.ts";
import { make_video_url_minter, service_client } from "../_shared/clients.ts";
import type { HlsSignerConfig } from "./types.ts";

// Default de signed_url_ttl_seconds sembrado en app_config (migración 20260720000001).
// ponytail: fallback simple si la query a app_config no responde — sin retry ni cache,
// el TTL solo controla la ventana de reproducción, no es una barrera de seguridad dura.
const DEFAULT_TTL_SECONDS = 14400;

/**
 * Arma el HlsSignerConfig leyendo los secrets STREAM_* del entorno y el TTL de
 * app_config. undefined si faltan los secrets → make_video_url_minter excluye
 * (fail-closed) las filas con cloudflare_uid, dejando la rama legacy intacta.
 */
async function build_hls_config(client: SupabaseClient): Promise<HlsSignerConfig | undefined> {
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
    // ponytail: fallback al default si app_config no responde (ver comentario arriba)
  }

  return { streamSigningKeyId, streamSigningJwk, signedUrlTtlSeconds, streamCustomerSubdomain };
}

Deno.serve(async (req: Request) => {
  const client = service_client();
  const hls_config = await build_hls_config(client);
  const video_url_minter = make_video_url_minter(client, hls_config);
  return handler(req, { videoUrlMinter: video_url_minter });
});
