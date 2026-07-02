// supabase/functions/update-lead-status/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación (service layer):
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload en-memoria (lead_id, new_status enum) → 400 si falla
//   5. callerVerifier.verify_caller(authHeader) → 401 si falla
//   6. leadStatusUpdater.update(params) — delega existencia, ownership, transición y UPDATE
//   7. Mapear resultado del updater → HTTP (403/404/400/500/200)

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  LeadStatusEnum,
  UpdateLeadStatusDeps,
  UpdateLeadStatusInput,
} from "./types.ts";

// ── Enum real de lead_status (migración 0001) ──────────────────────────────────
// Valores: new, contacted, in_progress, visit_scheduled, closed_won, closed_lost, discarded.
// 'qualified', 'closed', 'visit_done', 'negotiation' NO existen en el schema.

const VALID_LEAD_STATUSES = new Set<string>([
  "new",
  "contacted",
  "in_progress",
  "visit_scheduled",
  "closed_won",
  "closed_lost",
  "discarded",
]);

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: UpdateLeadStatusInput }
  | { success: false; code: string; message: string };

function invalid(message: string, code = "INVALID_INPUT"): ParseResult {
  return { success: false, code, message };
}

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return invalid("El payload debe ser un objeto JSON");
  }

  const obj = raw as Record<string, unknown>;

  // lead_id: string no vacío
  if (
    obj.lead_id === undefined ||
    obj.lead_id === null ||
    typeof obj.lead_id !== "string" ||
    obj.lead_id.trim() === ""
  ) {
    return invalid("lead_id es requerido y no puede ser vacío");
  }

  // new_status: solo valores del enum lead_status real
  if (obj.new_status === undefined || obj.new_status === null) {
    return invalid("new_status es requerido");
  }
  if (typeof obj.new_status !== "string" || !VALID_LEAD_STATUSES.has(obj.new_status)) {
    return invalid(
      "new_status debe ser un valor válido del enum lead_status (new, contacted, in_progress, visit_scheduled, closed_won, closed_lost, discarded)",
    );
  }

  // note: opcional — solo incluir si es string
  const note = "note" in obj && typeof obj.note === "string" ? obj.note : undefined;

  return {
    success: true,
    data: {
      lead_id: obj.lead_id,
      new_status: obj.new_status as LeadStatusEnum,
      note,
    },
  };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: UpdateLeadStatusDeps,
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

  // 5. Verificar caller (JWT) — user_id SIEMPRE del token, nunca del payload
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.callerVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    return error_response("UNAUTHENTICATED", "Se requiere autenticación", 401);
  }

  // 6. Delegar al updater: existencia, ownership, transición de estado, UPDATE
  const updateResult = await deps!.leadStatusUpdater.update({
    user_id: verifyResult.user_id,
    lead_id: input.lead_id,
    new_status: input.new_status,
    note: input.note,
  });

  // 7. Mapear resultado del updater a HTTP
  if (!updateResult.ok) {
    switch (updateResult.error_code) {
      case "UNAUTHORIZED_AGENT":
        return error_response(
          "UNAUTHORIZED_AGENT",
          updateResult.message ?? "No autorizado: el caller no es el agente dueño del lead",
          403,
        );
      case "LEAD_NOT_FOUND":
        return error_response(
          "LEAD_NOT_FOUND",
          updateResult.message ?? "Lead no encontrado",
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

  // 8. Éxito — retorna el lead actualizado
  return json_response({ lead: updateResult.lead }, 200);
}
