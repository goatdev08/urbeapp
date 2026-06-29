// supabase/functions/mint-video-url/handler.ts
// STUB — no implementado. Devuelve siempre 500 para que los tests fallen
// por aserción (fase RED). La implementación real vive en la subtarea 21.2.

import type { MintVideoUrlDeps } from "./types.ts";

export async function handler(
  _req: Request,
  _deps?: MintVideoUrlDeps,
): Promise<Response> {
  return new Response(
    JSON.stringify({ error: { code: "NOT_IMPLEMENTED", message: "stub — not implemented" } }),
    { status: 500, headers: { "Content-Type": "application/json" } },
  );
}
