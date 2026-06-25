// supabase/functions/admin-create-agency/index.ts
// Entry de PRODUCCIÓN (Supabase Edge Function). Construye las dependencias reales
// (supabase-js service_role) e inyecta al handler. La lógica vive en handler.ts;
// los tests importan handler.ts directamente y NO pasan por este archivo.
//
// Stub mínimo — fase RED subtarea 7.4.
// GREEN agrega make_admin_verifier y make_agency_creator en _shared/clients.ts
// e inyecta las deps reales aquí.

import { handler } from "./handler.ts";

Deno.serve((req: Request) => handler(req));
