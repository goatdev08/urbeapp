// supabase/functions/validate-invitation/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function). Inyecta el InvitationDb real
// (supabase-js service_role). La lógica vive en handler.ts; los tests importan
// handler.ts directamente y NO pasan por aquí (ni por supabase-js).

import { handler } from "./handler.ts";
import { make_invitation_db, service_client } from "../_shared/clients.ts";

Deno.serve((req: Request) =>
  handler(req, make_invitation_db(service_client()))
);
