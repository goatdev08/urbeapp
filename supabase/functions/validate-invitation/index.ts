// supabase/functions/validate-invitation/index.ts
// Stub mínimo — fase RED de la subtarea 5.2.
// La implementación real va en la fase GREEN.
//
// Contrato:
//   POST { invitationCode: string } (mín. 6 chars)
//   → 200 { agency_name: string }            (token válido)
//   → 400 { error: { code: "INVALID_INPUT", message } }   (formato inválido)
//   → 404 { error: { code: "TOKEN_NOT_FOUND", message } }
//   → 422 { error: { code: "TOKEN_EXPIRED" | "TOKEN_REVOKED" |
//                          "TOKEN_MAX_USES_REACHED" | "AGENCY_INACTIVE", message } }
//   → 405 { error: { code: "METHOD_NOT_ALLOWED", message } }

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response } from "../_shared/response.ts";
import { validate_invitation_token } from "../_shared/invitation.ts";
import type { InvitationDb } from "../_shared/invitation.ts";

/**
 * Handler exportado para tests unitarios.
 * Acepta un `db` inyectable (para tests); en producción se usará el cliente Supabase real.
 * El segundo parámetro es opcional: cuando Deno.serve llama al handler solo pasa `req`.
 */
export async function handler(
  req: Request,
  db?: InvitationDb,
): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // Solo POST permitido
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // TODO(5.2 GREEN): implementar lógica real aquí.
  // Por ahora lanza not_implemented para que los tests fallen por aserción.
  void db;
  void validate_invitation_token;
  throw new Error("not_implemented");
}

// Punto de entrada Deno — wrapping para que Deno.serve solo reciba (req: Request)
Deno.serve((req: Request) => handler(req));
