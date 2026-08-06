// supabase/functions/upgrade-to-agent/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso
// vive en index.ts (entry de producción). Patrón espejo de create-invitation.
//
// Contrato:
//   POST { invitationCode: string } (mín. 6 chars, mismo criterio que
//   validate-invitation/_shared/validation.ts)
//   → 200 { agency_id, agency_member_id }
//   | 400 INVALID_INPUT | 401 UNAUTHENTICATED
//   | 404 TOKEN_NOT_FOUND
//   | 409 {ALREADY_AGENT|ALREADY_ACTIVE_MEMBER}
//   | 422 {TOKEN_EXPIRED|TOKEN_REVOKED|TOKEN_MAX_USES_REACHED|AGENCY_INACTIVE}
//   | 405 | 500 {USER_NOT_FOUND|UPGRADE_FAILED}
//
// ⭐ user_id SIEMPRE del JWT (nunca del payload) — el caller solo puede
// subirse a SÍ MISMO. La RPC upgrade_to_agent_atomic (migración 20260805000004)
// hace la validación+canje atómico completo; este handler solo autentica y
// mapea errores de negocio a HTTP.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type { UpgradeToAgentDeps, UpgradeToAgentInput } from "./types.ts";

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: UpgradeToAgentInput }
  | { success: false; code: string; message: string };

function invalid(message: string, code = "INVALID_INPUT"): ParseResult {
  return { success: false, code, message };
}

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  if (obj.invitationCode === undefined || obj.invitationCode === null) {
    return invalid("invitationCode es requerido");
  }
  if (
    typeof obj.invitationCode !== "string" || obj.invitationCode.length === 0
  ) {
    return invalid("invitationCode no puede ser vacío");
  }
  if (obj.invitationCode.length < 6) {
    return invalid("invitationCode debe tener al menos 6 caracteres");
  }

  return { success: true, data: { invitationCode: obj.invitationCode } };
}

// Mapeo de los errores de negocio de la RPC (SQLSTATE P0001) a HTTP status.
const UPGRADE_ERROR_STATUS: Record<string, number> = {
  TOKEN_NOT_FOUND: 404,
  TOKEN_REVOKED: 422,
  TOKEN_EXPIRED: 422,
  TOKEN_MAX_USES_REACHED: 422,
  AGENCY_INACTIVE: 422,
  ALREADY_AGENT: 409,
  ALREADY_ACTIVE_MEMBER: 409,
  USER_NOT_FOUND: 500,
};

const UPGRADE_ERROR_MESSAGES: Record<string, string> = {
  TOKEN_NOT_FOUND: "El código de invitación no existe",
  TOKEN_REVOKED: "El código de invitación ha sido revocado",
  TOKEN_EXPIRED: "El código de invitación ha expirado",
  TOKEN_MAX_USES_REACHED: "El código de invitación ya no está disponible",
  AGENCY_INACTIVE: "La agencia asociada a este código no está activa",
  ALREADY_AGENT: "Tu cuenta ya tiene privilegios de agente",
  ALREADY_ACTIVE_MEMBER: "Ya perteneces a una inmobiliaria activa",
  USER_NOT_FOUND: "No se pudo completar el upgrade",
};

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: UpgradeToAgentDeps,
): Promise<Response> {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. Parse JSON body
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

  // 4. Validar payload en-memoria
  const parsed = parse_input(raw);
  if (!parsed.success) {
    return error_response(parsed.code, parsed.message, 400);
  }

  // 5. Verificar caller (JWT) — user_id SIEMPRE del token, nunca del payload
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.callerVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    return error_response("UNAUTHENTICATED", "Se requiere autenticación", 401);
  }

  // 6. Canje atómico vía RPC upgrade_to_agent_atomic (migración 20260805000004)
  const result = await deps!.upgradeRunner.upgrade_atomic({
    user_id: verifyResult.user_id,
    token: parsed.data.invitationCode,
  });

  // 7. Mapear resultado a HTTP
  if (!result.ok) {
    const status = UPGRADE_ERROR_STATUS[result.error_code] ?? 500;
    const message = UPGRADE_ERROR_MESSAGES[result.error_code] ??
      "No se pudo completar el upgrade";
    return error_response(result.error_code, message, status);
  }

  // 8. Éxito
  return json_response(
    { agency_id: result.agency_id, agency_member_id: result.agency_member_id },
    200,
  );
}
