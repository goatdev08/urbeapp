// supabase/functions/request-agent-upgrade/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso
// vive en index.ts (entry de producción). Patrón espejo de create-invitation.
//
// Contrato:
//   POST { reason?: string | null }
//   → 201 { application_id }
//   | 400 INVALID_INPUT | 401 UNAUTHENTICATED
//   | 409 DUPLICATE_PENDING_APPLICATION | 405 | 500 DB_ERROR
//
// ⭐ user_id SIEMPRE del JWT (nunca del payload). El ApplicationCreator usa el
// cliente DEL USUARIO (anon key + JWT) para que la política RLS
// agent_app_insert sea la que autoriza el INSERT — este handler no reimplementa
// esa regla.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  RequestAgentUpgradeDeps,
  RequestAgentUpgradeInput,
} from "./types.ts";

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: RequestAgentUpgradeInput }
  | { success: false; code: string; message: string };

function invalid(message: string, code = "INVALID_INPUT"): ParseResult {
  return { success: false, code, message };
}

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  // reason: opcional — docs/motivo no obligatorios en beta (§4.2). Si viene,
  // debe ser string; vacío/whitespace se normaliza a null.
  let reason: string | null = null;
  if (obj.reason !== undefined && obj.reason !== null) {
    if (typeof obj.reason !== "string") {
      return invalid("reason debe ser un string");
    }
    const trimmed = obj.reason.trim();
    reason = trimmed.length > 0 ? trimmed : null;
  }

  return { success: true, data: { reason } };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: RequestAgentUpgradeDeps,
): Promise<Response> {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. Parse JSON body — body vacío es válido (equivale a {}: reason=null)
  let raw: unknown;
  try {
    const text = await req.text();
    raw = text.trim() === "" ? {} : JSON.parse(text);
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

  // 6. Delegar al creator: INSERT vía cliente del usuario (RLS agent_app_insert)
  const createResult = await deps!.applicationCreator.create({
    user_id: verifyResult.user_id,
    reason: parsed.data.reason,
  });

  // 7. Mapear resultado a HTTP
  if (!createResult.ok) {
    switch (createResult.error_code) {
      case "DUPLICATE_PENDING_APPLICATION":
        return error_response(
          "DUPLICATE_PENDING_APPLICATION",
          "Ya tienes una solicitud pendiente de revisión",
          409,
        );
      case "DB_ERROR":
      default:
        return error_response(
          "DB_ERROR",
          createResult.message ?? "Error de base de datos",
          500,
        );
    }
  }

  // 8. Éxito
  return json_response({ application_id: createResult.application_id }, 201);
}
