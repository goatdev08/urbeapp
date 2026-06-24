// supabase/functions/validate-invitation/index.ts
// Fase GREEN 5.2: implementación completa del endpoint de validación de invitación.
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
import { error_response, json_response } from "../_shared/response.ts";
import { validate_invitation_token } from "../_shared/invitation.ts";
import type { InvitationDb } from "../_shared/invitation.ts";

// Mapeo de error_code de validate_invitation_token a status HTTP
const ERROR_STATUS: Record<string, number> = {
  TOKEN_NOT_FOUND: 404,
  TOKEN_REVOKED: 422,
  TOKEN_EXPIRED: 422,
  TOKEN_MAX_USES_REACHED: 422,
  AGENCY_INACTIVE: 422,
};

// Mensajes legibles por error_code
const ERROR_MESSAGES: Record<string, string> = {
  TOKEN_NOT_FOUND: "El código de invitación no existe",
  TOKEN_REVOKED: "El código de invitación ha sido revocado",
  TOKEN_EXPIRED: "El código de invitación ha expirado",
  TOKEN_MAX_USES_REACHED: "El código de invitación ya no está disponible",
  AGENCY_INACTIVE: "La agencia asociada a este código no está activa",
};

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

  // Leer body JSON
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

  // Validar invitationCode
  if (
    raw === null ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    return error_response(
      "INVALID_INPUT",
      "El payload debe ser un objeto JSON",
      400,
    );
  }

  const obj = raw as Record<string, unknown>;

  if (obj.invitationCode === undefined || obj.invitationCode === null) {
    return error_response("INVALID_INPUT", "invitationCode es requerido", 400);
  }

  if (
    typeof obj.invitationCode !== "string" ||
    obj.invitationCode.length === 0
  ) {
    return error_response(
      "INVALID_INPUT",
      "invitationCode no puede ser vacío",
      400,
    );
  }

  if (obj.invitationCode.length < 6) {
    return error_response(
      "INVALID_INPUT",
      "invitationCode debe tener al menos 6 caracteres",
      400,
    );
  }

  const invitation_code = obj.invitationCode;

  // Construir db real si no se inyectó (producción)
  // En producción: se construirá con el cliente supabase-js.
  // Por ahora, si no hay db inyectado, es un error de configuración.
  if (db === undefined) {
    // TODO: construir el InvitationDb real con el cliente Supabase en producción
    return error_response(
      "INTERNAL_ERROR",
      "Base de datos no configurada",
      500,
    );
  }

  // Llamar a la lógica de validación
  const result = await validate_invitation_token(db, invitation_code);

  if (!result.ok) {
    const status = ERROR_STATUS[result.error_code] ?? 422;
    const message = ERROR_MESSAGES[result.error_code] ??
      "Error de validación";
    return error_response(result.error_code, message, status);
  }

  return json_response({ agency_name: result.agency_name }, 200);
}

// Punto de entrada Deno — wrapping para que Deno.serve solo reciba (req: Request)
Deno.serve((req: Request) => handler(req));
