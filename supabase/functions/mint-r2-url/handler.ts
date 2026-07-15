// supabase/functions/mint-r2-url/handler.ts
// STUB — fase RED (TDD), subtarea 69.2. Solo signatures; sin lógica de negocio.
// Lanza error para forzar fallo por aserción (no por import).
//
// Para pasar a GREEN: implementar parse/validación de input (kind/op/key/keys),
// verify_caller (401), autorización fail-closed (avatar=prefix propio,
// logo=owner activo de la agencia del key → 403 si no), y delegar la firma a
// deps.r2UrlMinter.sign_put / sign_get_batch (500 si el minter lanza).

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response } from "../_shared/response.ts";
import type { MintR2UrlDeps } from "./types.ts";

export async function handler(
  req: Request,
  deps?: MintR2UrlDeps,
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
  // Los tests de validación, auth, autorización, firma y errores fallarán por aserción aquí.
  void deps;
  throw new Error("not_implemented");
}
