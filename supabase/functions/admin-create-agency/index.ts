// supabase/functions/admin-create-agency/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function). Construye las dependencias reales
// (supabase-js service_role) e inyecta al handler. La lógica vive en handler.ts;
// los tests importan handler.ts directamente y NO pasan por este archivo.

import { handler } from "./handler.ts";
import {
  make_admin_verifier,
  make_agency_creator,
  make_auth_admin,
  service_client,
} from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  const client = service_client();
  return handler(req, {
    adminVerifier: make_admin_verifier(client),
    agencyCreator: make_agency_creator(client),
    authAdmin: make_auth_admin(client),
  });
});
