// supabase/functions/update-lead-status/index.ts
// Entry point de producción — STUB (fase RED, subtarea 15.6).
// Construirá las dependencias reales cuando el handler esté implementado.
// Los tests importan handler.ts y lead_status_updater.ts directamente, NO este archivo.

import { handler } from "./handler.ts";
import { make_lead_status_updater } from "./lead_status_updater.ts";
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

  const leadStatusUpdater = make_lead_status_updater(client);

  return handler(req, { callerVerifier, leadStatusUpdater });
});
