// supabase/functions/update-property-status/handler.ts
// STUB — fase RED (TDD). Solo signatures; sin lógica de negocio.
// Lanza error para forzar fallo por aserción (no por import).
//
// Para pasar a GREEN: implementar handle_cors_preflight, validación, auth, updater calls.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response } from "../_shared/response.ts";
import type { UpdatePropertyStatusDeps } from "./types.ts";

export async function handler(
  req: Request,
  deps?: UpdatePropertyStatusDeps,
): Promise<Response> {
  // CORS preflight — implementado trivialmente para no bloquear tests de CORS
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // Método no POST — implementado trivialmente
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // ponytail: stub RED — todo el flujo POST lanza not_implemented.
  // Los tests de happy path, validación, auth, transición y DB fallarán por aserción aquí.
  throw new Error("not_implemented");
}
