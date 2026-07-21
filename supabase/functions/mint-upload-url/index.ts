// supabase/functions/mint-upload-url/index.ts
// Entry point de producción. Construye las dependencias reales (supabase-js
// service_role para JWT + concurrencia + insert, fetch nativo para Cloudflare
// Stream) e inyecta al handler. La lógica vive en handler.ts; los tests
// importan ese módulo directamente y NO pasan por este archivo.
// Auth: verify_jwt del gateway (deploy sin --no-verify-jwt) exige JWT válido
// antes de invocar la función; el CallerVerifier de abajo solo resuelve el uid.
//
// Deploy (gotcha documentado): esta EF importa _shared/clients.ts →
//   supabase functions deploy mint-upload-url --import-map supabase/functions/deno.json --use-api

import { handler } from "./handler.ts";
import {
  make_active_upload_checker,
  make_stream_upload_creator,
  make_video_registrar,
  service_client,
} from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → usuario autenticado. Sin chequeo de
  // rol — cualquier agente autenticado puede pedir un upload slot; la
  // invariante de negocio real es la de concurrencia (ActiveUploadChecker).
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

  const activeUploadChecker = make_active_upload_checker(client);
  const streamUploadCreator = make_stream_upload_creator();
  const videoRegistrar = make_video_registrar(client);

  return handler(req, { callerVerifier, activeUploadChecker, streamUploadCreator, videoRegistrar });
});
