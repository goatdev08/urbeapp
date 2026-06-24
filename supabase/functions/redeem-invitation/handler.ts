// supabase/functions/redeem-invitation/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación: validar entrada → validar token (5.2) → crear usuario (5.3) →
// canje atómico vía RPC (5.4, migración 0013) con compensación deleteUser.

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
 * Handler exportado para tests unitarios sin Deno.serve().
 *
 * Payload esperado: { invitationCode, email, password, firstName, lastName }
 * Respuestas:
 *   OPTIONS → 200 con headers CORS
 *   GET/PUT/DELETE → 405
 *   POST inválido → 400 { error: { code: "INVALID_INPUT", message } }
 *   POST válido sin deps → 200 { status: "ok", data } (scaffold — sin deps reales)
 *   POST válido con deps → orquesta: validar token → crear usuario → canje → 200
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

  // Paso 2 (5.3): Crear usuario en auth.users via admin client.
  // El trigger handle_new_user (migración 0002) crea public.users automáticamente.
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
  // La RPC consolida: consumo del token + agency_members + denorm users + 4 consentimientos.
  // x-forwarded-for puede ser "cliente, proxy1, proxy2"; la RPC (inet) solo
  // acepta UNA IP, así que tomamos la primera (el cliente real) recortada.
  const xff = req.headers.get("x-forwarded-for");
  const ip = xff?.split(",")[0].trim() || null;
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
