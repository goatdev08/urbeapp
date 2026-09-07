// supabase/functions/update-lead-note/index.ts
// Entry point de producción. Mirror de update-lead-status/index.ts.
// Los tests importan handler.ts y note_updater.ts directamente, NO este archivo.

import { handler } from "./handler.ts";
import { make_note_updater } from "./note_updater.ts";
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
  // también puede editar la nota; mismo resolver que update-lead-status.
  const noteUpdater = make_note_updater(
    client,
    make_agency_role_resolver(client),
  );

  return handler(req, { callerVerifier, noteUpdater });
});
