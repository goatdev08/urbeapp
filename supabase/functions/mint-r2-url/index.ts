// supabase/functions/mint-r2-url/index.ts
// Entry point de producción. Construye las dependencias reales (supabase-js
// service_role para JWT + ownership de agencia, aws4fetch para la firma R2)
// e inyecta al handler. La lógica vive en handler.ts; los tests importan ese
// módulo directamente y NO pasan por este archivo.

import { handler } from "./handler.ts";
import {
  make_agency_ownership_verifier,
  make_r2_url_minter,
  service_client,
} from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado.
  // Sin verificación de rol aquí — la autorización por ownership la hace el
  // handler (avatar: prefix propio; logo: AgencyOwnershipVerifier).
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

  const agencyOwnershipVerifier = make_agency_ownership_verifier(client);
  const r2UrlMinter = make_r2_url_minter();

  return handler(req, { callerVerifier, agencyOwnershipVerifier, r2UrlMinter });
});
