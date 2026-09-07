// supabase/functions/update-lead-status/index.ts
// Entry point de producción. Construye dependencias reales (supabase-js
// service_role) e inyecta al handler. La lógica de negocio vive en handler.ts
// y lead_status_updater.ts; los tests importan esos módulos directamente y NO
// pasan por este archivo.

import { handler } from "./handler.ts";
import { make_lead_status_updater } from "./lead_status_updater.ts";
import { make_agency_role_resolver, service_client } from "../_shared/clients.ts";
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

  // 269.3: cierre de #31 — el owner/admin ACTIVO de la agencia del lead
  // también puede escribir; mismo resolver de membresía vigente que
  // edit-property/update-property-status (#202).
  const leadStatusUpdater = make_lead_status_updater(
    client,
    make_agency_role_resolver(client),
  );

  return handler(req, { callerVerifier, leadStatusUpdater });
});
