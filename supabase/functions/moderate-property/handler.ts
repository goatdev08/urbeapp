// supabase/functions/moderate-property/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción) + _shared/clients.ts. GREEN (subtarea 73.9).
//
// Orquestación (service layer), siguiendo el contrato documentado en types.ts:
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload en-memoria (property_id, action, reason) → 400 si falla
//   5. adminVerifier.verify_caller(authHeader) → 401/403
//   6. propertyFetcher.fetch(property_id) → 404/500
//   7. Rama suspend (directo a properties.status, NUNCA toca property_revisions)
//      vs. rama approve/needs_changes/reject (con-revisión → opera sobre la
//      revisión; sin-revisión → transiciona properties.status desde pending_review)
//   8. SIEMPRE registra en admin_actions al final de una escritura exitosa —
//      su fallo también es 500 (la auditoría no es best-effort).

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  ModerateAction,
  ModeratePropertyDeps,
  ModeratePropertyInput,
} from "./types.ts";

// Estados terminales desde los que suspend NUNCA transiciona (PRD §16.1: "no se
// contempla reabrir"). Documentado también en la subtarea 73.9 (bitácora RED).
const SUSPEND_BLOCKED_STATES = new Set<string>([
  "sold",
  "rented",
  "deleted_hard",
  "deleted_soft",
]);

const VALID_ACTIONS = new Set<ModerateAction>([
  "approve",
  "needs_changes",
  "reject",
  "suspend",
]);

// status resultante de properties para cada acción en la rama SIN-revisión
// (publicación inicial, properties.status pasa de 'pending_review' a esto).
const INITIAL_PUBLISH_TARGET_STATUS: Record<
  Exclude<ModerateAction, "suspend">,
  string
> = {
  approve: "active",
  needs_changes: "needs_changes",
  reject: "rejected",
};

// status de property_revisions resultante para cada acción en la rama CON-revisión.
const REVISION_TARGET_STATUS: Record<
  Exclude<ModerateAction, "suspend">,
  "approved" | "needs_changes" | "rejected"
> = {
  approve: "approved",
  needs_changes: "needs_changes",
  reject: "rejected",
};

// ── Validación del payload ────────────────────────────────────────────────────

type ParseResult =
  | { success: true; data: ModeratePropertyInput }
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
    obj.property_id === undefined ||
    obj.property_id === null ||
    typeof obj.property_id !== "string" ||
    obj.property_id.trim() === ""
  ) {
    return invalid("property_id es requerido y no puede ser vacío");
  }

  if (
    obj.action === undefined ||
    obj.action === null ||
    typeof obj.action !== "string" ||
    !VALID_ACTIONS.has(obj.action as ModerateAction)
  ) {
    return invalid(
      "action debe ser 'approve', 'needs_changes', 'reject' o 'suspend'",
    );
  }

  let reason: string | undefined;
  if ("reason" in obj && obj.reason !== undefined) {
    if (typeof obj.reason !== "string" || obj.reason.trim() === "") {
      return invalid("reason, si se envía, debe ser una cadena no vacía");
    }
    reason = obj.reason;
  }

  return {
    success: true,
    data: {
      property_id: obj.property_id,
      action: obj.action as ModerateAction,
      reason,
    },
  };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: ModeratePropertyDeps,
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
  const reason: string | null = input.reason ?? null;

  // 5. Verificar caller (solo admin)
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.adminVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    const status = verifyResult.error_code === "FORBIDDEN" ? 403 : 401;
    return error_response(
      verifyResult.error_code,
      verifyResult.error_code === "FORBIDDEN"
        ? "No autorizado: se requiere rol admin"
        : "Se requiere autenticación",
      status,
    );
  }
  const admin_id = verifyResult.user_id;

  // 6. Traer la propiedad
  const fetchResult = await deps!.propertyFetcher.fetch(input.property_id);
  if (!fetchResult.ok) {
    if (fetchResult.error_code === "PROPERTY_NOT_FOUND") {
      return error_response(
        "PROPERTY_NOT_FOUND",
        fetchResult.message ?? "Propiedad no encontrada",
        404,
      );
    }
    return error_response(
      "DB_ERROR",
      fetchResult.message ?? "Error de base de datos",
      500,
    );
  }
  const property = fetchResult.property;

  // 7. Rama suspend — DIRECTO a properties.status, jamás toca property_revisions.
  if (input.action === "suspend") {
    if (SUSPEND_BLOCKED_STATES.has(property.status)) {
      return error_response(
        "INVALID_TRANSITION",
        `No se puede suspender una propiedad en estado '${property.status}'`,
        400,
      );
    }

    const writeResult = await deps!.propertyUpdater.set_status(
      input.property_id,
      "suspended",
    );
    if (!writeResult.ok) {
      return error_response(
        "DB_ERROR",
        writeResult.message ?? "Error de base de datos",
        500,
      );
    }

    const recordResult = await deps!.adminActionRecorder.record({
      admin_id,
      action_type: "suspend",
      entity_type: "property",
      entity_id: input.property_id,
      old_values: { status: property.status },
      new_values: { status: "suspended" },
      reason,
    });
    if (!recordResult.ok) {
      return error_response(
        "DB_ERROR",
        recordResult.message ?? "Error de base de datos",
        500,
      );
    }

    return json_response(
      { property_id: input.property_id, status: "suspended" },
      200,
    );
  }

  // 8. approve/needs_changes/reject: ¿hay una revisión activa?
  const action = input.action as Exclude<ModerateAction, "suspend">;
  const revisionResult = await deps!.revisionFinder.find_active(
    input.property_id,
  );
  if (!revisionResult.ok) {
    return error_response(
      "DB_ERROR",
      revisionResult.message ?? "Error de base de datos",
      500,
    );
  }
  const revision = revisionResult.revision;

  // 8a. CON revisión activa → opera sobre la revisión, properties NO se toca.
  if (revision !== null) {
    if (action === "approve") {
      const applyResult = await deps!.propertyUpdater.apply_revision_snapshot(
        input.property_id,
        revision.changed_fields,
      );
      if (!applyResult.ok) {
        return error_response(
          "DB_ERROR",
          applyResult.message ?? "Error de base de datos",
          500,
        );
      }
    }

    const resolveResult = await deps!.revisionResolver.resolve({
      revision_id: revision.id,
      status: REVISION_TARGET_STATUS[action],
      admin_id,
      reason: action === "approve" ? null : reason,
    });
    if (!resolveResult.ok) {
      return error_response(
        "DB_ERROR",
        resolveResult.message ?? "Error de base de datos",
        500,
      );
    }

    const recordResult = await deps!.adminActionRecorder.record({
      admin_id,
      action_type: action,
      entity_type: "property",
      entity_id: input.property_id,
      old_values: { revision_status: revision.status },
      new_values: { revision_status: REVISION_TARGET_STATUS[action] },
      reason,
    });
    if (!recordResult.ok) {
      return error_response(
        "DB_ERROR",
        recordResult.message ?? "Error de base de datos",
        500,
      );
    }

    return json_response(
      { property_id: input.property_id, status: property.status },
      200,
    );
  }

  // 8b. SIN revisión activa → solo tiene sentido sobre la publicación inicial.
  if (property.status !== "pending_review") {
    return error_response(
      "NOTHING_TO_MODERATE",
      "No hay revisión activa ni publicación pendiente que moderar",
      400,
    );
  }

  const target_status = INITIAL_PUBLISH_TARGET_STATUS[action];
  const writeResult = await deps!.propertyUpdater.set_status(
    input.property_id,
    target_status,
  );
  if (!writeResult.ok) {
    return error_response(
      "DB_ERROR",
      writeResult.message ?? "Error de base de datos",
      500,
    );
  }

  const recordResult = await deps!.adminActionRecorder.record({
    admin_id,
    action_type: action,
    entity_type: "property",
    entity_id: input.property_id,
    old_values: { status: property.status },
    new_values: { status: target_status },
    reason,
  });
  if (!recordResult.ok) {
    return error_response(
      "DB_ERROR",
      recordResult.message ?? "Error de base de datos",
      500,
    );
  }

  return json_response(
    { property_id: input.property_id, status: target_status },
    200,
  );
}
