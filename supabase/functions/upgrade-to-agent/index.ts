// supabase/functions/upgrade-to-agent/index.ts
// Entry point de producción. Mirror de create-invitation/index.ts.
// Los tests (si se agregan en un pase Deno separado — ver bitácora 71.3)
// importarán handler.ts y upgrade_runner.ts directamente, NO este archivo.
//
// Endpoint AUTENTICADO — se despliega CON verificación de JWT del gateway
// (default de Supabase, sin --no-verify-jwt): el caller ya tiene sesión.
//
// Deploy (gotchas documentados, ver supabase_deploy_import_map_gotcha):
//   supabase functions deploy upgrade-to-agent \
//     --import-map supabase/functions/deno.json --use-api

import { handler } from "./handler.ts";
import { make_upgrade_runner } from "./upgrade_runner.ts";
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

  const upgradeRunner = make_upgrade_runner(client);

  return handler(req, { callerVerifier, upgradeRunner });
});
