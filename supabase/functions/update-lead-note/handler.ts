// supabase/functions/update-lead-note/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación (service layer):
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload en-memoria (lead_id no vacío, note string) → 400 si falla
//   5. callerVerifier.verify_caller(authHeader) → 401 si falla
//   6. noteUpdater.update(params) — delega existencia, ownership y UPDATE
//   7. Mapear resultado del updater → HTTP (403/404/500/200)
//
// note="" es válido (limpia la nota) — NO debe ser rechazado con 400.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type { UpdateLeadNoteDeps, UpdateLeadNoteInput } from "./types.ts";

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: UpdateLeadNoteInput }
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

  // note: requerida como string. "" es válido (limpia la nota).
  if (!("note" in obj) || obj.note === undefined || obj.note === null) {
    return invalid("note es requerida");
  }
  if (typeof obj.note !== "string") {
    return invalid("note debe ser un string");
  }

  return {
    success: true,
    data: {
      lead_id: obj.lead_id,
      note: obj.note,
    },
  };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: UpdateLeadNoteDeps,
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

  // 6. Delegar al updater: existencia, ownership, UPDATE de internal_notes
  const updateResult = await deps!.noteUpdater.update({
    user_id: verifyResult.user_id,
    lead_id: input.lead_id,
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
