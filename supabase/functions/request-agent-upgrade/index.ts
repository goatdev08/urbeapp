// supabase/functions/request-agent-upgrade/index.ts
// Entry point de producción. Mirror de create-invitation/index.ts, con una
// diferencia clave: el ApplicationCreator usa user_client (anon key + JWT del
// caller), NO service_client — la autorización del INSERT la hace la política
// RLS agent_app_insert, no este código (ver types.ts para el porqué).
//
// Endpoint AUTENTICADO — se despliega CON verificación de JWT del gateway
// (default de Supabase, sin --no-verify-jwt): el caller ya tiene sesión.
//
// Deploy (gotchas documentados, ver supabase_deploy_import_map_gotcha):
//   supabase functions deploy request-agent-upgrade \
//     --import-map supabase/functions/deno.json --use-api

import { handler } from "./handler.ts";
import { make_application_creator } from "./application_creator.ts";
import { service_client, user_client } from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const authHeader = req.headers.get("Authorization");

  // CallerVerifier real: JWT → getUser → usuario autenticado → SELECT
  // users.role (mismo patrón que _shared/clients.ts:make_admin_verifier).
  // Usa service_client() solo para RESOLVER identidad+rol (getUser/SELECT no
  // escriben ni dependen de RLS); el INSERT en sí va por el user_client (RLS).
  // role viaja SIEMPRE resuelto server-side — nunca del cliente — para que el
  // handler pueda cortar con 409 ALREADY_AGENT antes de llamar al creator.
  const verifier_client = service_client();
  const callerVerifier: CallerVerifier = {
    async verify_caller(
      header: string | null,
    ): Promise<CallerVerifyResult> {
      if (!header || !header.startsWith("Bearer ")) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      const jwt = header.replace(/^Bearer\s+/, "");
      const { data: { user }, error: auth_error } = await verifier_client.auth
        .getUser(jwt);
      if (auth_error || !user) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      const { data: user_row } = await verifier_client
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      return { ok: true, user_id: user.id, role: user_row?.role ?? null };
    },
  };

  // ApplicationCreator real: el INSERT viaja con el JWT del caller (RLS
  // agent_app_insert autoriza, no este código). Sin header, se construye
  // igual (fallará como INVALID_INPUT/401 antes de llegar a usarlo, ya que
  // el handler verifica el caller ANTES de invocar al creator).
  const applicationCreator = make_application_creator(
    user_client(authHeader ?? ""),
  );

  return handler(req, { callerVerifier, applicationCreator });
});
