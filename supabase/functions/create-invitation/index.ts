// supabase/functions/create-invitation/index.ts
// Entry point de producción. Mirror de update-lead-note/index.ts.
// Los tests importan handler.ts e invitation_creator.ts directamente, NO este archivo.

import { handler } from "./handler.ts";
import { make_invitation_creator } from "./invitation_creator.ts";
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

  const invitationCreator = make_invitation_creator(client);

  return handler(req, { callerVerifier, invitationCreator });
});
