// supabase/functions/suspend-agency/index.ts
// Entry point de producción (subtarea #211.1). Construye las dependencias
// reales (supabase-js service_role) e inyecta al handler. La lógica vive en
// handler.ts con su suite DI — este archivo se mantiene DELGADO a propósito:
// un index.ts con lógica propia es lógica SIN COBERTURA (riesgo visto en 73.4,
// mitigado en 73.6). Mismo patrón que moderate-ad/index.ts.

import { handler } from "./handler.ts";
import { make_admin_verifier, make_agency_status_writer, service_client } from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  return handler(req, {
    adminVerifier: make_admin_verifier(client),
    agencyStatusWriter: make_agency_status_writer(client),
  });
});
