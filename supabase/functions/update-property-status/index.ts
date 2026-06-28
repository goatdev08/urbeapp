// supabase/functions/update-property-status/index.ts
// Entry point de producción. Construye dependencias reales (supabase-js service_role)
// e inyecta al handler. La lógica de negocio vive en handler.ts y property_status_updater.ts;
// los tests importan esos módulos directamente y NO pasan por este archivo.

import { handler } from "./handler.ts";
import { make_property_status_updater } from "./property_status_updater.ts";
import { service_client } from "../_shared/clients.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
} from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado
  // (ownership se valida en el updater, no aquí)
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

  const propertyStatusUpdater = make_property_status_updater(client);

  return handler(req, { callerVerifier, propertyStatusUpdater });
});
