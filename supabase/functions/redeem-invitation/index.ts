// supabase/functions/redeem-invitation/index.ts
// Fase GREEN 5.1: scaffold + validación de entrada implementados.
// La lógica de negocio (canje real) se enchufará en 5.2+.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { parse_redeem_invitation_input } from "../_shared/validation.ts";

/**
 * Handler exportado para facilitar tests unitarios sin Deno.serve().
 * Contrato de entrada/salida documentado en §17.3 (lineamientos) y tarea #5.
 *
 * Payload esperado: { invitationCode, email, password, fullName }
 * Respuestas:
 *   OPTIONS → 200 con headers CORS
 *   GET/PUT/DELETE → 405
 *   POST inválido → 400 { error: { code: "INVALID_INPUT", message } }
 *   POST válido → 200 { ... } (lógica real en 5.2+)
 */
export async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // Solo POST permitido
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // Leer body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response(
      "INVALID_INPUT",
      "El cuerpo de la petición no es JSON válido",
      400,
    );
  }

  // Validar payload
  const parsed = parse_redeem_invitation_input(raw);
  if (!parsed.success) {
    return error_response("INVALID_INPUT", parsed.error.message, 400);
  }

  // TODO(5.2): enchufar lógica de negocio aquí:
  //   1. sha256_hex(parsed.data.invitationCode) → buscar en agency_invitation_tokens
  //   2. Verificar token vigente y no usado
  //   3. Crear usuario via supabase.auth.admin.createUser
  //   4. Asociar usuario a la agencia
  //   5. Marcar token como usado
  //   6. Devolver { jwt, user }
  //
  // Por ahora, retornamos 200 con los datos parseados para que el scaffold
  // sea coherente y los tests de 5.1 pasen correctamente.
  return json_response({ status: "ok", data: parsed.data }, 200);
}

// Punto de entrada Deno
Deno.serve(handler);
