// supabase/functions/create-invitation/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso
// vive en index.ts (entry de producción). Patrón espejo de update-lead-note.
//
// Contrato:
//   POST { max_uses?: number|null, expires_at?: string|null } (body vacío = {})
//   → 201 { invitation: { token_id, plain_token, agency_id, max_uses, expires_at } }
//   | 400 INVALID_INPUT | 401 UNAUTHENTICATED | 403 NOT_AGENCY_OWNER
//   | 422 AGENCY_INACTIVE | 405 | 500 DB_ERROR
//
// ⭐ user_id SIEMPRE del JWT; agency_id se deriva en el creator de la membresía
// owner del caller. Nada del payload identifica al caller ni a la agencia.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type { CreateInvitationDeps, CreateInvitationInput } from "./types.ts";

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: CreateInvitationInput }
  | { success: false; code: string; message: string };

function invalid(message: string, code = "INVALID_INPUT"): ParseResult {
  return { success: false, code, message };
}

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  // max_uses: opcional; si viene (y no es null) debe ser entero ≥ 1.
  let max_uses: number | null = null;
  if (obj.max_uses !== undefined && obj.max_uses !== null) {
    if (
      typeof obj.max_uses !== "number" ||
      !Number.isInteger(obj.max_uses) ||
      obj.max_uses < 1
    ) {
      return invalid("max_uses debe ser un entero mayor o igual a 1");
    }
    max_uses = obj.max_uses;
  }

  // expires_at: opcional; si viene debe ser fecha ISO parseable y futura.
  let expires_at: string | null = null;
  if (obj.expires_at !== undefined && obj.expires_at !== null) {
    if (typeof obj.expires_at !== "string") {
      return invalid("expires_at debe ser un string ISO 8601");
    }
    const parsed_ms = Date.parse(obj.expires_at);
    if (Number.isNaN(parsed_ms)) {
      return invalid("expires_at no es una fecha válida");
    }
    if (parsed_ms <= Date.now()) {
      return invalid("expires_at debe ser una fecha futura");
    }
    expires_at = obj.expires_at;
  }

  return { success: true, data: { max_uses, expires_at } };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: CreateInvitationDeps,
): Promise<Response> {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. Parse JSON body — body vacío es válido (equivale a {}: defaults)
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

  // 6. Delegar al creator: membresía owner, agencia activa, generación, INSERT
  const createResult = await deps!.invitationCreator.create({
    user_id: verifyResult.user_id,
    max_uses: parsed.data.max_uses,
    expires_at: parsed.data.expires_at,
  });

  // 7. Mapear resultado a HTTP
  if (!createResult.ok) {
    switch (createResult.error_code) {
      case "NOT_AGENCY_OWNER":
        return error_response(
          "NOT_AGENCY_OWNER",
          createResult.message ??
            "Solo el dueño de una agencia activa puede generar códigos",
          403,
        );
      case "AGENCY_INACTIVE":
        return error_response(
          "AGENCY_INACTIVE",
          createResult.message ?? "La agencia no está activa",
          422,
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

  // 8. Éxito — el plain_token viaja UNA sola vez en esta respuesta
  return json_response({ invitation: createResult.invitation }, 201);
}
