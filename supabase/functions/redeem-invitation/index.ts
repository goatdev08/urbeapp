// supabase/functions/redeem-invitation/index.ts
// Fase GREEN 5.3: validación de entrada + validación de token + creación de usuario auth.
// La orquestación completa (asociar agencia, marcar token usado) se enchufará en 5.4+.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { parse_redeem_invitation_input } from "../_shared/validation.ts";
import {
  type InvitationDb,
  validate_invitation_token,
} from "../_shared/invitation.ts";
import {
  type AuthAdminClient,
  create_agent_auth_user,
} from "../_shared/auth_user.ts";
import {
  type InvitationRedeemer,
  REDEEM_ERROR_MESSAGES,
  REDEEM_ERROR_STATUS,
} from "../_shared/redeem.ts";

/**
 * Dependencias inyectables del handler (DI pattern).
 * Opcionales: en producción se construyen a partir del cliente Supabase real;
 * en tests se inyectan fakes controlados.
 */
export interface RedeemDeps {
  db?: InvitationDb;
  authAdmin?: AuthAdminClient;
  redeemer?: InvitationRedeemer;
}

// Mensajes legibles para errores de validación del token
const TOKEN_ERROR_MESSAGES: Record<string, string> = {
  TOKEN_NOT_FOUND: "El código de invitación no existe",
  TOKEN_REVOKED: "El código de invitación ha sido revocado",
  TOKEN_EXPIRED: "El código de invitación ha expirado",
  TOKEN_MAX_USES_REACHED: "El código de invitación ya no está disponible",
  AGENCY_INACTIVE: "La agencia asociada a este código no está activa",
};

const TOKEN_ERROR_STATUS: Record<string, number> = {
  TOKEN_NOT_FOUND: 404,
  TOKEN_REVOKED: 422,
  TOKEN_EXPIRED: 422,
  TOKEN_MAX_USES_REACHED: 422,
  AGENCY_INACTIVE: 422,
};

/**
 * Handler exportado para facilitar tests unitarios sin Deno.serve().
 * Contrato de entrada/salida documentado en §17.3 (lineamientos) y tarea #5.
 *
 * Payload esperado: { invitationCode, email, password, firstName, lastName }
 * Respuestas:
 *   OPTIONS → 200 con headers CORS
 *   GET/PUT/DELETE → 405
 *   POST inválido → 400 { error: { code: "INVALID_INPUT", message } }
 *   POST válido sin deps → 200 { status: "ok", data } (scaffold — sin deps reales)
 *   POST válido con deps → orquesta: validar token → crear usuario → 200 { user_id }
 *
 * @param deps  Dependencias inyectables (db, authAdmin). En producción: undefined → stub.
 *              En tests: se pasan fakes controlados.
 */
export async function handler(
  req: Request,
  deps?: RedeemDeps,
): Promise<Response> {
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

  const { invitationCode, email, password, firstName, lastName } = parsed.data;

  // Si no se inyectaron deps (scaffold / tests 5.1), retornar 200 con datos parseados.
  // Esto preserva el comportamiento del contrato 5.1 mientras las deps no estén disponibles.
  if (
    deps?.db === undefined || deps?.authAdmin === undefined ||
    deps?.redeemer === undefined
  ) {
    return json_response({ status: "ok", data: parsed.data }, 200);
  }

  const { db, authAdmin, redeemer } = deps;

  // Paso 1 (5.2): Validar el token de invitación
  const token_result = await validate_invitation_token(db, invitationCode);
  if (!token_result.ok) {
    const status = TOKEN_ERROR_STATUS[token_result.error_code] ?? 422;
    const message = TOKEN_ERROR_MESSAGES[token_result.error_code] ??
      "Error de validación";
    return error_response(token_result.error_code, message, status);
  }

  // Paso 2 (5.3): Crear usuario en auth.users via admin client
  // Nota: el trigger handle_new_user (migración 0002) crea public.users automáticamente.
  // NO insertar la fila en public.users desde aquí.
  const auth_result = await create_agent_auth_user(authAdmin, {
    email,
    password,
    first_name: firstName,
    last_name: lastName,
  });

  if (!auth_result.ok) {
    if (auth_result.error_code === "EMAIL_ALREADY_EXISTS") {
      return error_response(auth_result.error_code, auth_result.message, 409);
    }
    return error_response(auth_result.error_code, auth_result.message, 500);
  }

  // Paso 3 (5.4): canje atómico vía RPC redeem_invitation_atomic (migración 0013).
  // La RPC consolida en una transacción: consumo del token + agency_members +
  // denormalización de users (role/agency_id) + los 4 consentimientos legales.
  const ip = req.headers.get("x-forwarded-for");
  const redeem = await redeemer.redeem_atomic({
    token_id: token_result.token_id,
    user_id: auth_result.user_id,
    ip,
  });

  if (!redeem.ok) {
    // Compensación: no hay transacción distribuida entre auth.admin y public.*.
    // Si la RPC falla tras crear el usuario, revertimos el usuario huérfano (best-effort).
    try {
      await authAdmin.deleteUser(auth_result.user_id);
    } catch (_e) {
      // Si la compensación falla, devolvemos igual el error original del canje.
    }
    const status = REDEEM_ERROR_STATUS[redeem.error_code] ?? 500;
    const message = REDEEM_ERROR_MESSAGES[redeem.error_code] ??
      "No se pudo completar el registro";
    return error_response(redeem.error_code, message, status);
  }

  return json_response(
    {
      user_id: auth_result.user_id,
      agency_id: token_result.agency_id,
      agency_name: token_result.agency_name,
      agency_member_id: redeem.agency_member_id,
    },
    200,
  );
}

// Punto de entrada Deno — wrapping para que Deno.serve solo reciba (req: Request)
Deno.serve((req: Request) => handler(req));
