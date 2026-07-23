// supabase/functions/mint-poster-urls/handler.ts
// STUB — subtarea 89.1 (fase RED). Sin lógica de negocio: únicamente hace que
// handler.test.ts falle por aserción/excepción en vez de por import roto.
// La implementación real (orquestación descrita en types.ts) llega en GREEN.

import type { MintPosterUrlsDeps } from "./types.ts";

export function handler(_req: Request, _deps?: MintPosterUrlsDeps): Promise<Response> {
  throw new Error("not_implemented");
}
