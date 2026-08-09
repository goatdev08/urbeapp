// supabase/functions/edit-property/handler.ts
// STUB — fase RED de la subtarea 73.6. Solo la firma exportada existe; la
// orquestación real (CORS/método/parse/auth/ownership/diff §15.5/HTTP mapping,
// ver handler.test.ts) es responsabilidad del GREEN (agente `supabase`).
//
// Deliberadamente lanza para que TODOS los tests de handler.test.ts fallen por
// excepción (RED válido), no por "module not found".

import type { EditPropertyDeps } from "./types.ts";

export function handler(
  _req: Request,
  _deps?: EditPropertyDeps,
): Promise<Response> {
  throw new Error("not_implemented");
}
