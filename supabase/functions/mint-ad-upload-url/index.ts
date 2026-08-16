// supabase/functions/mint-ad-upload-url/index.ts
// Entry point de producción. Construye las dependencias reales (supabase-js
// service_role para JWT + autz + concurrencia + insert, fetch nativo para
// Cloudflare Stream) e inyecta al handler. La lógica vive en handler.ts; los
// tests importan ese módulo directamente y NO pasan por este archivo.
// Auth: verify_jwt del gateway (deploy sin --no-verify-jwt) exige JWT válido
// antes de invocar la función; el CallerVerifier de abajo solo resuelve el uid.
//
// Deploy (gotcha documentado, mint-upload-url/index.ts): esta EF importa
// _shared/clients.ts →
//   supabase functions deploy mint-ad-upload-url --import-map supabase/functions/deno.json --use-api

import { handler } from "./handler.ts";
import {
  make_active_ad_upload_checker,
  make_ad_creative_registrar,
  make_advertiser_authorizer,
  make_stream_upload_creator,
  service_client,
} from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado. Sin chequeo de
  // rol aquí — la autorización real vive en AdvertiserAuthorizer (org_can_advertise).
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

  const advertiserAuthorizer = make_advertiser_authorizer(client);
  const activeAdUploadChecker = make_active_ad_upload_checker(client);
  const streamUploadCreator = make_stream_upload_creator();
  const adCreativeRegistrar = make_ad_creative_registrar(client);

  return handler(req, {
    callerVerifier,
    advertiserAuthorizer,
    activeAdUploadChecker,
    streamUploadCreator,
    adCreativeRegistrar,
  });
});
