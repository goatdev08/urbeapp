// supabase/functions/moderate-comment/handler.ts
// GREEN — subtarea 289.6. Handler PURO con dependencias inyectables (DI); no
// importa supabase-js — eso vive en index.ts + _shared/clients.ts (patrón
// idéntico a moderate-property/handler.ts).
//
// Orquestación (fijada por el RED — handler.test.ts, types.ts):
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros métodos → 405 METHOD_NOT_ALLOWED)
//   3. Parsear JSON body → 400 INVALID_INPUT si falla
//   4. Validar payload en memoria (comment_id UUID, action del set, reason
//      opcional no-vacía) → 400 INVALID_INPUT — SIEMPRE antes del adminVerifier
//      (un payload inválido nunca dispara la verificación de admin)
//   5. adminVerifier.verify_caller(authHeader) → 401 UNAUTHENTICATED / 403
//      ADMIN_REQUIRED (el 'FORBIDDEN' del verifier se REMAPEA a 'ADMIN_REQUIRED',
//      homologado con el literal que levanta resolve_comment_reports_atomic)
//   6. resolutionWriter.resolve({comment_id, action, reason, admin_jwt}) —
//      admin_jwt es el header Authorization COMPLETO ("Bearer …"), reenviado
//      tal cual (nunca decodificado aquí)
//   7. Mapeo de errores del writer (defensa en profundidad: la RPC vuelve a
//      verificar todo de forma independiente) → 403/404/400/500; cualquier
//      código desconocido cae al 500 DB_ERROR genérico (fail-closed, nunca el
//      `message` crudo del writer, que puede traer PII)
//   8. Éxito → 200 { ok: true, comment_id, action }

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  CommentModerationAction,
  CommentResolutionErrorCode,
  ModerateCommentDeps,
} from "./types.ts";

// UUID 8-4-4-4-12 hex, case-insensitive — ponytail: manual sin Zod, calco
// contact-agent/handler.ts / post-comment/handler.ts (mismo criterio, ya
// cubre todos los edge cases del RED).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_ACTIONS = new Set<CommentModerationAction>([
  "restore",
  "keep_hidden",
  "delete_comment",
]);

interface ParsedInput {
  comment_id: string;
  action: CommentModerationAction;
  reason: string | null;
}

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
    typeof obj.comment_id !== "string" || !UUID_REGEX.test(obj.comment_id)
  ) {
    return invalid("comment_id es requerido y debe ser un UUID válido (8-4-4-4-12)");
  }

  if (
    typeof obj.action !== "string" ||
    !VALID_ACTIONS.has(obj.action as CommentModerationAction)
  ) {
    return invalid("action debe ser 'restore', 'keep_hidden' o 'delete_comment'");
  }

  let reason: string | null = null;
  if ("reason" in obj && obj.reason !== undefined) {
    if (typeof obj.reason !== "string" || obj.reason.trim() === "") {
      return invalid("reason, si se envía, debe ser una cadena no vacía");
    }
    reason = obj.reason;
  }

  return {
    success: true,
    data: {
      comment_id: obj.comment_id,
      action: obj.action as CommentModerationAction,
      reason,
    },
  };
}

// Mapeo de errores del resolutionWriter (defensa en profundidad — la RPC
// vuelve a verificar private.is_admin()/acción/existencia de forma
// independiente al adminVerifier del borde). Cualquier código FUERA de estos
// tres (incluido 'DB_ERROR' y cualquier literal desconocido) cae al 500
// DB_ERROR genérico: fail-closed, nunca un 2xx ni el `message` crudo del
// writer (puede traer detalle de Postgres con datos reales).
function map_writer_error(
  error_code: CommentResolutionErrorCode,
): { status: number; code: string; message: string } {
  switch (error_code) {
    case "ADMIN_REQUIRED":
      return {
        status: 403,
        code: "ADMIN_REQUIRED",
        message: "No autorizado: se requiere rol admin",
      };
    case "COMMENT_NOT_FOUND":
      return {
        status: 404,
        code: "COMMENT_NOT_FOUND",
        message: "Comentario no encontrado",
      };
    case "INVALID_ACTION":
      return {
        status: 400,
        code: "INVALID_ACTION",
        message: "Acción inválida",
      };
    default:
      return {
        status: 500,
        code: "DB_ERROR",
        message: "Error de base de datos",
      };
  }
}

export async function handler(
  req: Request,
  deps?: ModerateCommentDeps,
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

  // 4. Validar payload en-memoria — SIEMPRE antes del adminVerifier.
  const parsed = parse_input(raw);
  if (!parsed.success) {
    return error_response("INVALID_INPUT", parsed.message, 400);
  }
  const input = parsed.data;

  // 5. Verificar caller (solo admin)
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.adminVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    if (verifyResult.error_code === "FORBIDDEN") {
      return error_response(
        "ADMIN_REQUIRED",
        "No autorizado: se requiere rol admin",
        403,
      );
    }
    return error_response("UNAUTHENTICATED", "Se requiere autenticación", 401);
  }

  // 6. Resolver — admin_jwt es el header Authorization COMPLETO.
  const writeResult = await deps!.resolutionWriter.resolve({
    comment_id: input.comment_id,
    action: input.action,
    reason: input.reason,
    admin_jwt: authHeader ?? "",
  });

  // 7. Mapeo de errores (defensa en profundidad)
  if (!writeResult.ok) {
    const mapped = map_writer_error(writeResult.error_code);
    return error_response(mapped.code, mapped.message, mapped.status);
  }

  // 8. Éxito
  return json_response(
    { ok: true, comment_id: input.comment_id, action: input.action },
    200,
  );
}
