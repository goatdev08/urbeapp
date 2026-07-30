// supabase/functions/register/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function). Construye las dependencias reales
// (supabase-js service_role) e inyecta al handler. La lógica vive en handler.ts;
// los tests importan handler.ts directamente y NO pasan por este archivo (ni por supabase-js).
//
// Endpoint PÚBLICO (sustituye el auth.signUp directo del cliente) — se despliega
// SIN verificación de JWT del gateway (--no-verify-jwt): quien llama es un
// visitante anónimo que todavía no tiene sesión.
//
// Deploy (gotchas documentados, ver supabase_deploy_import_map_gotcha):
//   supabase functions deploy register \
//     --import-map supabase/functions/deno.json --no-verify-jwt --use-api

import { handler } from "./handler.ts";
import {
  make_phone_exists,
  make_register_auth_admin,
  make_registrar,
  service_client,
} from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  const client = service_client();
  return handler(req, {
    authAdmin: make_register_auth_admin(client),
    registrar: make_registrar(client),
    phone_exists: make_phone_exists(client),
  });
});
