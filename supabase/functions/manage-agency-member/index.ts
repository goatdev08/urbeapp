// supabase/functions/manage-agency-member/index.ts
// Entry point de producción. Mirror de update-property-status/index.ts. Construye
// dependencias reales (supabase-js service_role) e inyecta al handler. La lógica
// de negocio vive en handler.ts y member_manager.ts; los tests importan esos
// módulos directamente y NO pasan por este archivo.
//
// Endpoint AUTENTICADO — se despliega CON verificación de JWT del gateway
// (default de Supabase, sin --no-verify-jwt): el caller ya tiene sesión.
//
// Deploy (gotchas documentados, ver supabase_deploy_import_map_gotcha):
//   supabase functions deploy manage-agency-member \
//     --import-map supabase/functions/deno.json --use-api

import { handler } from "./handler.ts";
import { make_agency_member_manager } from "./member_manager.ts";
import { service_client } from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado
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

  const memberManager = make_agency_member_manager(client);

  return handler(req, { callerVerifier, memberManager });
});
