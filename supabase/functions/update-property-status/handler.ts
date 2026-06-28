// supabase/functions/update-property-status/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación (service layer):
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload en-memoria (new_status enum, closed_reason invariante) → 400 si falla
//   5. callerVerifier.verify_caller(authHeader) → 401 si falla
//   6. propertyStatusUpdater.update(params) — delega existencia, ownership, transición y UPDATE
//   7. Mapear resultado del updater → HTTP (403/404/400/500/200)

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  ClosedReasonEnum,
  PropertyStatusEnum,
  UpdatePropertyStatusDeps,
  UpdatePropertyStatusInput,
} from "./types.ts";

// ── Enums válidos para esta EF ────────────────────────────────────────────────
// Solo draft|active|paused|closed. pending_review/needs_changes/suspended → moderación (EF distinta).

const VALID_STATUSES = new Set<string>(["draft", "active", "paused", "closed"]);
const VALID_CLOSED_REASONS = new Set<string>(["rented", "sold", "withdrawn", "expired"]);

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: UpdatePropertyStatusInput }
  | { success: false; code: string; message: string };

function invalid(message: string, code = "INVALID_INPUT"): ParseResult {
  return { success: false, code, message };
}

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  // property_id: string no vacío
  if (
    obj.property_id === undefined ||
    obj.property_id === null ||
    typeof obj.property_id !== "string" ||
    obj.property_id.trim() === ""
  ) {
    return invalid("property_id es requerido y no puede ser vacío");
  }

  // new_status: solo draft|active|paused|closed aceptados
  if (obj.new_status === undefined || obj.new_status === null) {
    return invalid("new_status es requerido");
  }
  if (typeof obj.new_status !== "string" || !VALID_STATUSES.has(obj.new_status)) {
    return invalid(
      "new_status debe ser 'draft', 'active', 'paused' o 'closed'",
    );
  }

  const new_status = obj.new_status as PropertyStatusEnum;

  // closed_reason: invariante 🔒 (mig 0005: property_closed_requires_reason)
  const has_closed_reason = "closed_reason" in obj && obj.closed_reason !== undefined;
  const closed_reason_value = has_closed_reason ? obj.closed_reason : undefined;

  if (new_status === "closed") {
    // Obligatorio y no-null al cerrar
    if (!has_closed_reason || closed_reason_value === null) {
      return invalid(
        "closed_reason es requerido cuando new_status es 'closed'",
        "MISSING_CLOSED_REASON",
      );
    }
    if (
      typeof closed_reason_value !== "string" ||
      !VALID_CLOSED_REASONS.has(closed_reason_value)
    ) {
      return invalid(
        "closed_reason debe ser 'rented', 'sold', 'withdrawn' o 'expired'",
      );
    }
  } else {
    // En transiciones no-cierre, closed_reason es inválido si tiene valor real
    // DECISIÓN: rechazar (400), no ignorar — indica confusión del caller
    if (
      has_closed_reason &&
      closed_reason_value !== null &&
      closed_reason_value !== undefined
    ) {
      return invalid(
        "closed_reason solo puede estar presente cuando new_status es 'closed'",
      );
    }
  }

  return {
    success: true,
    data: {
      property_id: obj.property_id,
      new_status,
      // ponytail: null explícito para transiciones no-cierre — el shape del updater lo requiere
      closed_reason: new_status === "closed"
        ? (closed_reason_value as ClosedReasonEnum)
        : null,
    },
  };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: UpdatePropertyStatusDeps,
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

  const input = parsed.data;

  // 5. Verificar caller (JWT)
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.callerVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    return error_response("UNAUTHENTICATED", "Se requiere autenticación", 401);
  }

  // 6. Delegar al updater: existencia, ownership, transición de estado, UPDATE
  //    user_id SIEMPRE del JWT verificado, nunca del payload (seguridad)
  const updateResult = await deps!.propertyStatusUpdater.update({
    user_id: verifyResult.user_id,
    property_id: input.property_id,
    new_status: input.new_status,
    closed_reason: input.closed_reason,
  });

  // 7. Mapear resultado del updater a HTTP
  if (!updateResult.ok) {
    switch (updateResult.error_code) {
      case "UNAUTHORIZED_OWNER":
        return error_response(
          "UNAUTHORIZED_OWNER",
          updateResult.message ?? "No autorizado: el caller no es el dueño de la propiedad",
          403,
        );
      case "PROPERTY_NOT_FOUND":
        return error_response(
          "PROPERTY_NOT_FOUND",
          updateResult.message ?? "Propiedad no encontrada",
          404,
        );
      case "INVALID_TRANSITION":
        return error_response(
          "INVALID_TRANSITION",
          updateResult.message ?? "Transición de estado no permitida",
          400,
        );
      case "DB_ERROR":
      default:
        return error_response(
          "DB_ERROR",
          updateResult.message ?? "Error de base de datos",
          500,
        );
    }
  }

  // 8. Éxito
  return json_response({ property: updateResult.property }, 200);
}
