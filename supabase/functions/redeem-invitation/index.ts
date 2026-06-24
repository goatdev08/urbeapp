// supabase/functions/redeem-invitation/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function). Construye las dependencias reales
// (supabase-js service_role) e inyecta al handler. La lógica vive en handler.ts;
// los tests importan handler.ts directamente y NO pasan por este archivo (ni por supabase-js).

import { handler } from "./handler.ts";
import {
  make_auth_admin,
  make_invitation_db,
  make_redeemer,
  service_client,
} from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  const client = service_client();
  return handler(req, {
    db: make_invitation_db(client),
    authAdmin: make_auth_admin(client),
    redeemer: make_redeemer(client),
  });
});
