// supabase/functions/register-agency/index.ts
// Entry point de producción. Mirror de upgrade-to-agent/index.ts.
// Los tests importan handler.ts y agency_registrar.ts directamente, NO este archivo.
//
// Endpoint AUTENTICADO — se despliega CON verificación de JWT del gateway
// (default de Supabase, sin --no-verify-jwt): el caller ya tiene sesión.
//
// Deploy (gotchas documentados, ver supabase_deploy_import_map_gotcha):
//   supabase functions deploy register-agency \
//     --import-map supabase/functions/deno.json --use-api

import { handler } from "./handler.ts";
import { make_agency_registrar } from "./agency_registrar.ts";
import { service_client } from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado
  const callerVerifier: CallerVerifier = {
    async verify_caller(
      authHeader: string | null,
    ): Promise<CallerVerifyResult> {
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      const jwt = authHeader.replace(/^Bearer\s+/, "");
      const { data: { user }, error: auth_error } = await client.auth.getUser(
        jwt,
      );
      if (auth_error || !user) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      return { ok: true, user_id: user.id };
    },
  };

  const agencyRegistrar = make_agency_registrar(client);

  return handler(req, { callerVerifier, agencyRegistrar });
});
