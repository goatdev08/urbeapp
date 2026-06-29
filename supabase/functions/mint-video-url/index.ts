// supabase/functions/mint-video-url/index.ts
// Entry point de producción. Construye la dependencia real (supabase-js service_role)
// e inyecta al handler. La lógica vive en handler.ts y _shared/clients.ts (make_video_url_minter);
// los tests importan esos módulos directamente y NO pasan por este archivo.
// Auth: la exige el verify_jwt del gateway (deploy sin --no-verify-jwt); no se valida aquí.

import { handler } from "./handler.ts";
import { make_video_url_minter, service_client } from "../_shared/clients.ts";

Deno.serve((req: Request) => {
  const client = service_client();
  const video_url_minter = make_video_url_minter(client);
  return handler(req, { videoUrlMinter: video_url_minter });
});
