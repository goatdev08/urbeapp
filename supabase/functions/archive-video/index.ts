// supabase/functions/archive-video/index.ts
// Entry point de producción. Construye las dependencias reales (supabase-js
// service_role para JWT/DB, fetch nativo para Cloudflare Stream + R2) e inyecta
// al handler. La lógica vive en handler.ts; los tests importan ese módulo
// directamente y NO pasan por este archivo.
//
// Deploy (gotcha documentado): esta EF importa _shared/clients.ts →
//   supabase functions deploy archive-video --import-map supabase/functions/deno.json --use-api
//
// NO se despliega en esta subtarea (68.8): bloqueante externo real, ver bitácora
// (par de credenciales R2 desajustado + 402 del gateway Cloudflare).

import { handler } from "./handler.ts";
import {
  make_archive_uploader,
  make_stream_archiver,
  make_video_archiver,
  make_video_loader,
  service_client,
} from "../_shared/clients.ts";
import type { CallerVerifier, CallerVerifyResult } from "./types.ts";

Deno.serve((req: Request) => {
  const client = service_client();

  // CallerVerifier real: JWT → getUser → role IN ('agent', 'admin') (mismo
  // patrón que publish-property/index.ts).
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

      const { data: user_row, error: user_error } = await client
        .from("users")
        .select("role")
        .eq("id", user.id)
        .maybeSingle();
      if (user_error || !user_row) {
        return { ok: false, error_code: "UNAUTHENTICATED" };
      }
      if (user_row.role !== "agent" && user_row.role !== "admin") {
        return { ok: false, error_code: "FORBIDDEN" };
      }

      return { ok: true, user_id: user.id, role: user_row.role };
    },
  };

  return handler(req, {
    callerVerifier,
    videoLoader: make_video_loader(client),
    streamArchiver: make_stream_archiver(),
    archiveUploader: make_archive_uploader(),
    videoArchiver: make_video_archiver(client),
    sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
});
