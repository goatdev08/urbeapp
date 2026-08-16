// supabase/functions/mint-ad-urls/handler.ts
// STUB RED — subtarea 169.5. Implementación real pendiente (GREEN): orquestación
// HTTP pura calcada de mint-poster-urls/handler.ts (CORS → método → auth →
// parse+validación de input → llama al AdUrlMinter → pasa el resultado tal cual).
// Ver types.ts para el contrato completo y handler.test.ts para los edge cases (SEAMS).

import type { MintAdUrlsDeps } from "./types.ts";

export async function handler(_req: Request, _deps?: MintAdUrlsDeps): Promise<Response> {
  throw new Error("not_implemented");
}
