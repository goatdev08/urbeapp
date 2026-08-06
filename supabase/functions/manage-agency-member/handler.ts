// supabase/functions/manage-agency-member/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Mirror de update-property-status/handler.ts.
//
// Orquestación (service layer):
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload en-memoria (member_id no vacío, action en {suspend,reactivate,remove}) → 400
//   5. callerVerifier.verify_caller(authHeader) → 401 si falla
//   6. memberManager.manage(params) — delega visibilidad, autorización, transición y UPDATE
//      (caller_user_id SIEMPRE del JWT verificado, nunca del payload — anti-spoofing)
//   7. Mapear resultado del manager → HTTP (404/403/409/500/200)

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  ManageAgencyMemberDeps,
  ManageAgencyMemberInput,
  MemberAction,
} from "./types.ts";

const VALID_ACTIONS = new Set<string>(["suspend", "reactivate", "remove"]);

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: ManageAgencyMemberInput }
  | { success: false; message: string };

function invalid(message: string): ParseResult {
  return { success: false, message };
}

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  if (
    obj.member_id === undefined ||
    obj.member_id === null ||
    typeof obj.member_id !== "string" ||
    obj.member_id.trim() === ""
  ) {
    return invalid("member_id es requerido y no puede ser vacío");
  }

  if (
    obj.action === undefined ||
    obj.action === null ||
    typeof obj.action !== "string" ||
    !VALID_ACTIONS.has(obj.action)
  ) {
    return invalid("action debe ser 'suspend', 'reactivate' o 'remove'");
  }

  return {
    success: true,
    data: {
      member_id: obj.member_id,
      action: obj.action as MemberAction,
    },
  };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: ManageAgencyMemberDeps,
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
    return error_response("INVALID_INPUT", parsed.message, 400);
  }

  const input = parsed.data;

  // 5. Verificar caller (JWT)
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.callerVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    return error_response("UNAUTHENTICATED", "Se requiere autenticación", 401);
  }

  // 6. Delegar al manager: visibilidad, autorización, transición, UPDATE.
  //    caller_user_id SIEMPRE del JWT verificado, nunca del payload (seguridad).
  const manageResult = await deps!.memberManager.manage({
    caller_user_id: verifyResult.user_id,
    member_id: input.member_id,
    action: input.action,
  });

  // 7. Mapear resultado del manager a HTTP
  if (!manageResult.ok) {
    switch (manageResult.error_code) {
      case "MEMBER_NOT_FOUND":
        return error_response(
          "MEMBER_NOT_FOUND",
          manageResult.message ?? "Miembro no encontrado",
          404,
        );
      case "NOT_AUTHORIZED":
        return error_response(
          "NOT_AUTHORIZED",
          manageResult.message ?? "No autorizado para gestionar este miembro",
          403,
        );
      case "CANNOT_MANAGE_OWNER":
        return error_response(
          "CANNOT_MANAGE_OWNER",
          manageResult.message ?? "Un admin de agencia no puede gestionar al owner",
          403,
        );
      case "INVALID_TRANSITION":
        return error_response(
          "INVALID_TRANSITION",
          manageResult.message ?? "Transición de estado no permitida",
          409,
        );
      case "DB_ERROR":
      default:
        return error_response(
          "DB_ERROR",
          manageResult.message ?? "Error de base de datos",
          500,
        );
    }
  }

  // 8. Éxito
  return json_response({ member: manageResult.member }, 200);
}
