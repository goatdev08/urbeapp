// supabase/functions/post-comment/handler.ts
// GREEN — subtarea 289.5. Orquestación pura con DI (sin supabase-js: eso vive en
// index.ts + _shared/clients.ts). Orden fijado por el RED (ver types.ts, cabecera):
//   OPTIONS → método → callerVerifier (401, ANTES del body) → parse JSON (400) →
//   validar payload en-memoria (400) → propertyFetcher (404/409/500) →
//   classify_comment(body, configReader fail-open) → commentWriter (500) → 201.

import type { CommentRecord, PostCommentDeps, PostCommentInput } from "./types.ts";
import { classify_comment } from "./classify.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";

// UUID 8-4-4-4-12 hex, case-insensitive — ponytail: manual sin Zod, calco
// contact-agent/handler.ts:20-21 (mismo criterio, ya cubre todos los edge cases).
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_BODY_LENGTH = 500;

// 'active' es el ÚNICO status de properties que admite comentarios (mismo valor
// que usa moderate-property para "visible/aprobada" — 20260809000002).
const ACTIVE_PROPERTY_STATUS = "active";

type ParseResult =
  | { success: true; data: PostCommentInput }
  | { success: false; message: string };

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { success: false, message: "El payload debe ser un objeto JSON" };
  }

  const obj = raw as Record<string, unknown>;

  const property_id = obj.property_id;
  if (typeof property_id !== "string" || !UUID_REGEX.test(property_id)) {
    return {
      success: false,
      message: "property_id es requerido y debe ser un UUID válido (8-4-4-4-12)",
    };
  }

  // \S (no trim) — un body con espacios de borde se acepta y se inserta TAL CUAL
  // (EC15): la validación solo exige que exista contenido no-whitespace.
  const body = obj.body;
  if (
    typeof body !== "string" ||
    !/\S/.test(body) ||
    body.length > MAX_BODY_LENGTH
  ) {
    return {
      success: false,
      message:
        `body es requerido, no puede estar vacío/solo-espacios y debe medir ≤${MAX_BODY_LENGTH} caracteres`,
    };
  }

  return { success: true, data: { property_id, body } };
}

export async function handler(
  req: Request,
  deps?: PostCommentDeps,
): Promise<Response> {
  // 1. CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. JWT ANTES de tocar el body (calco contact-agent, no update-lead-note):
  // un caller sin JWT nunca debe enterarse de si su body es válido o no (EC6).
  const auth_header = req.headers.get("Authorization");
  const auth_result = await deps!.callerVerifier.verify_caller(auth_header);
  if (!auth_result.ok) {
    return error_response("UNAUTHENTICATED", "Autenticación requerida", 401);
  }

  // 4. Parse JSON body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response(
      "INVALID_INPUT",
      "El cuerpo de la solicitud no es JSON válido",
      400,
    );
  }

  // 5. Validar payload en-memoria
  const parsed = parse_input(raw);
  if (!parsed.success) {
    return error_response("INVALID_INPUT", parsed.message, 400);
  }
  const input = parsed.data;

  // 6. Propiedad: debe existir y estar 'active'
  const property_result = await deps!.propertyFetcher.fetch(input.property_id);
  if (!property_result.ok) {
    if (property_result.error_code === "PROPERTY_NOT_FOUND") {
      return error_response(
        "PROPERTY_NOT_FOUND",
        property_result.message ?? "Propiedad no encontrada",
        404,
      );
    }
    return error_response(
      "DB_ERROR",
      property_result.message ?? "Error de base de datos",
      500,
    );
  }
  if (property_result.property.status !== ACTIVE_PROPERTY_STATUS) {
    return error_response(
      "PROPERTY_NOT_ACTIVE",
      `La propiedad no admite comentarios (estado: ${property_result.property.status})`,
      409,
    );
  }

  // 7. Filtro determinista — configReader es OPCIONAL y fail-open: su ausencia o
  // el rechazo de su promesa NUNCA tumban la petición (EC23/EC24), solo dejan la
  // lista de palabras vacía; el filtro base (teléfono/email/URL) sigue vivo.
  // ponytail: fail-open documentado (mismo criterio que build_hls_config en
  // mint-video-url/index.ts) — comment_filter_words calibra falsos positivos sin
  // publicar app, pero no es una barrera de seguridad dura.
  let filter_words: string[] = [];
  if (deps!.configReader) {
    try {
      filter_words = await deps!.configReader.get_filter_words();
    } catch {
      filter_words = [];
    }
  }

  const status = classify_comment(input.body, filter_words);

  // 8. Persistir — status YA CLASIFICADO; el user_id SIEMPRE viene del JWT, nunca
  // del body (EC16).
  const write_result = await deps!.commentWriter.insert({
    property_id: input.property_id,
    user_id: auth_result.user_id,
    body: input.body,
    status,
  });
  if (!write_result.ok) {
    // Mensaje genérico a propósito: NUNCA incluir el texto del comentario (EC25).
    return error_response(
      "DB_ERROR",
      "Error interno al guardar el comentario",
      500,
    );
  }

  // status en la respuesta = el que YA CLASIFICAMOS localmente (no lo que el
  // writer haya devuelto) — el writer persiste el status que se le mandó, pero la
  // fuente de verdad de la clasificación es este handler (EC22 lo verifica).
  const response_body: { comment: CommentRecord } = {
    comment: { ...write_result.comment, status },
  };
  return json_response(response_body, 201);
}
