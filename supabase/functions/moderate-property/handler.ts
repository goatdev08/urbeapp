// supabase/functions/moderate-property/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción) + _shared/clients.ts. GREEN 73.9, revisado #130.
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
//   8. #130: cada rama emite UNA escritura vía moderationWriter (RPC atómica
//      moderate_property_atomic) — snapshot + status + resolución de revisión +
//      auditoría viajan en la misma transacción; ya no existe el estado
//      "propiedad activa sin rastro en admin_actions". La auditoría sigue sin
//      ser best-effort: su fallo revierte TODO y la llamada es reintentable.
//   9. #130: approve CON revisión desde pending_review|needs_changes también
//      ACTIVA la propiedad (antes quedaba invisible para siempre) y la
//      respuesta reporta el status RESULTANTE, no el previo.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  ModerateAction,
  ModeratePropertyDeps,
  ReportsResolutionAction,
  ReportsResolutionWriter,
} from "./types.ts";

// 220.3: deps del handler, ampliadas ADITIVAMENTE con el seam nuevo de
// resolución de reportes. `ModeratePropertyDeps` (types.ts) NO se toca —
// mismo criterio documentado en el archivo hermano de test
// (report_resolution.test.ts): más propiedades de las requeridas siguen
// siendo asignables donde se pide `ModeratePropertyDeps` (TS estructural).
// Opcional porque los 41 tests vigentes de handler.test.ts construyen deps
// sin este campo (nunca lo necesitan: solo se lee en la rama nueva).
export type HandlerDeps = ModeratePropertyDeps & {
  reportsResolutionWriter?: ReportsResolutionWriter;
};

// 220.3: unión local de action — el payload HTTP real siempre fue JSON sin
// tipar en el límite; `ModerateAction` deliberadamente NO se amplía (rompería
// los Records exhaustivos INITIAL_PUBLISH_TARGET_STATUS/REVISION_TARGET_STATUS
// de abajo, que dependen de `Exclude<ModerateAction, "suspend">`).
type AnyModerateAction = ModerateAction | ReportsResolutionAction;

interface ParsedInput {
  property_id: string;
  action: AnyModerateAction;
  reason?: string;
}

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

// 220.3: 4 acciones nuevas de resolución de reportes, solo válidas sobre una
// propiedad 'suspended' (guard de origen en el handler, ver más abajo).
// Literales EN INGLÉS DISTINTOS de los vigentes a propósito — 'needs_changes'
// ya significa "resolver una property_revision" (ambiguo reusarlo aquí).
const REPORTS_RESOLUTION_ACTIONS = new Set<ReportsResolutionAction>([
  "restore",
  "request_changes",
  "keep_suspended",
  "delete",
]);

// status RESULTANTE en la respuesta para cada acción de resolución de
// reportes (delete NUNCA expone deleted_at en el body, igual que la RPC).
const REPORTS_RESOLUTION_TARGET_STATUS: Record<ReportsResolutionAction, string> = {
  restore: "active",
  request_changes: "needs_changes",
  keep_suspended: "suspended",
  delete: "suspended",
};

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
  | { success: true; data: ParsedInput }
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
    !(
      VALID_ACTIONS.has(obj.action as ModerateAction) ||
      REPORTS_RESOLUTION_ACTIONS.has(obj.action as ReportsResolutionAction)
    )
  ) {
    return invalid(
      "action debe ser 'approve', 'needs_changes', 'reject', 'suspend', " +
        "'restore', 'request_changes', 'keep_suspended' o 'delete'",
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
      action: obj.action as AnyModerateAction,
      reason,
    },
  };
}

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: HandlerDeps,
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

    const writeResult = await deps!.moderationWriter.apply({
      property_id: input.property_id,
      admin_id,
      action_type: "suspend",
      old_values: { status: property.status },
      new_values: { status: "suspended" },
      reason,
      new_property_status: "suspended",
    });
    if (!writeResult.ok) {
      return error_response(
        "DB_ERROR",
        writeResult.message ?? "Error de base de datos",
        500,
      );
    }

    return json_response(
      { property_id: input.property_id, status: "suspended" },
      200,
    );
  }

  // 7.5 (220.3). Rama de resolución de reportes — 4 acciones nuevas, solo
  // válidas sobre una propiedad 'suspended' (guard de origen). NUNCA toca
  // property_revisions (mismo criterio que 'suspend' — revisionFinder no se
  // invoca en esta rama, ni en el guard ni en el camino feliz).
  if (REPORTS_RESOLUTION_ACTIONS.has(input.action as ReportsResolutionAction)) {
    const reportsAction = input.action as ReportsResolutionAction;

    if (property.status !== "suspended") {
      return error_response(
        "INVALID_TRANSITION",
        `No se puede aplicar '${reportsAction}' sobre una propiedad en estado '${property.status}'`,
        400,
      );
    }

    const writeResult = await deps!.reportsResolutionWriter!.apply({
      property_id: input.property_id,
      admin_id,
      action_type: reportsAction,
      reason,
    });
    if (!writeResult.ok) {
      return error_response(
        "DB_ERROR",
        writeResult.message ?? "Error de base de datos",
        500,
      );
    }

    return json_response(
      {
        property_id: input.property_id,
        status: REPORTS_RESOLUTION_TARGET_STATUS[reportsAction],
      },
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

  // 8a. CON revisión activa → opera sobre la revisión.
  if (revision !== null) {
    // #130: si la publicación estaba esperando moderación (pending_review) o
    // correcciones (needs_changes), aprobar la revisión TAMBIÉN la activa —
    // antes el status no se movía: quedaba invisible en el feed y sin ningún
    // camino de código que la activara jamás. En la re-revisión normal §15.6
    // (propiedad ya 'active'), el status no cambia.
    const activate = action === "approve" &&
      (property.status === "pending_review" ||
        property.status === "needs_changes");
    const resulting_status = activate ? "active" : property.status;

    const old_values: Record<string, unknown> = {
      revision_status: revision.status,
    };
    const new_values: Record<string, unknown> = {
      revision_status: REVISION_TARGET_STATUS[action],
    };
    if (activate) {
      old_values.status = property.status;
      new_values.status = "active";
    }

    const writeResult = await deps!.moderationWriter.apply({
      property_id: input.property_id,
      admin_id,
      action_type: action,
      old_values,
      new_values,
      reason,
      ...(action === "approve"
        ? { changed_fields: revision.changed_fields }
        : {}),
      ...(activate ? { new_property_status: "active" } : {}),
      revision_id: revision.id,
      revision_status: REVISION_TARGET_STATUS[action],
      revision_reason: action === "approve" ? null : reason,
    });
    if (!writeResult.ok) {
      return error_response(
        "DB_ERROR",
        writeResult.message ?? "Error de base de datos",
        500,
      );
    }

    // #130: reportar el status RESULTANTE, no el leído antes de escribir.
    return json_response(
      { property_id: input.property_id, status: resulting_status },
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
  const writeResult = await deps!.moderationWriter.apply({
    property_id: input.property_id,
    admin_id,
    action_type: action,
    old_values: { status: property.status },
    new_values: { status: target_status },
    reason,
    new_property_status: target_status,
  });
  if (!writeResult.ok) {
    return error_response(
      "DB_ERROR",
      writeResult.message ?? "Error de base de datos",
      500,
    );
  }

  return json_response(
    { property_id: input.property_id, status: target_status },
    200,
  );
}
