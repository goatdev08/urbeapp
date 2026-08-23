// supabase/functions/moderate-ad/handler.ts
// STUB de la fase RED (subtarea #208.1). Sin lógica de negocio: devuelve
// siempre 501 para que cada caso de handler.test.ts falle por ASERCIÓN de
// status/body, nunca por un import roto.

import type { ModerateAdDeps } from "./types.ts";

export function handler(_req: Request, _deps: ModerateAdDeps): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({ error: { code: "NOT_IMPLEMENTED", message: "RED" } }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    ),
  );
}
