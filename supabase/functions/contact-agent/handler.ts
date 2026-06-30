// supabase/functions/contact-agent/handler.ts
// Skeleton GREEN — subtarea 14.2.
// Orden de orquestación (el test "sin_auth_con_input_invalido_retorna_401_no_400" lo verifica):
//   (a) OPTIONS → CORS preflight
//   (b) método !== POST → 405
//   (c) JWT auth via callerVerifier → 401 UNAUTHENTICATED (ANTES de parsear body)
//   (d) parse JSON body → 400 INVALID_INPUT si no-JSON
//   (e) validar propertyId → 400 INVALID_INPUT si falta / no-string / vacío / no-UUID
//   (f) placeholder → 200 { ok: true }  (subtareas 14.3-14.6 añadirán la lógica real)

import type { ContactAgentDeps, ContactAgentInput } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";

// UUID 8-4-4-4-12 hex, case-insensitive — ponytail: manual sin Zod, cubre todos los edge cases del test
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; error: { code: string; message: string } };

function parse_contact_agent_input(raw: unknown): ParseResult<ContactAgentInput> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "El payload debe ser un objeto JSON" },
    };
  }

  const obj = raw as Record<string, unknown>;
  const pid = obj.propertyId;

  if (pid === undefined || pid === null) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "propertyId es requerido" },
    };
  }
  if (typeof pid !== "string" || pid.length === 0) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "propertyId debe ser un string no vacío" },
    };
  }
  if (!UUID_REGEX.test(pid)) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "propertyId debe ser un UUID válido (8-4-4-4-12)",
      },
    };
  }

  return { success: true, data: { propertyId: pid } };
}

export function make_contact_agent_handler(
  deps: ContactAgentDeps,
): (req: Request) => Promise<Response> {
  return async function (req: Request): Promise<Response> {
    // (a) CORS preflight
    if (req.method === "OPTIONS") {
      return handle_cors_preflight(req);
    }

    // (b) Solo POST
    if (req.method !== "POST") {
      return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
    }

    // (c) JWT auth — ANTES de parsear body (orden crítico verificado por test)
    const auth_header = req.headers.get("Authorization");
    const auth_result = await deps.callerVerifier.verify_caller(auth_header);
    if (!auth_result.ok) {
      return error_response("UNAUTHENTICATED", "Autenticación requerida", 401);
    }

    // (d) Parse JSON body
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

    // (e) Validar propertyId
    const parsed = parse_contact_agent_input(raw);
    if (!parsed.success) {
      return error_response(parsed.error.code, parsed.error.message, 400);
    }

    // (f) Resolver propiedad + agente (14.3)
    const property_result = await deps.propertyResolver.resolve(parsed.data.propertyId);
    if (!property_result.ok) {
      if (property_result.error_code === "PROPERTY_NOT_FOUND") {
        return error_response("NOT_FOUND", "Propiedad no encontrada", 404);
      }
      // DB_ERROR → 500
      return error_response("DB_ERROR", "Error interno al obtener la propiedad", 500);
    }

    const property = property_result.data;

    // (g) Validar estado de la propiedad — solo 'active' es contactable
    if (property.status !== "active") {
      return error_response(
        "INVALID_PROPERTY_STATE",
        `La propiedad no está disponible para contacto (estado: ${property.status})`,
        400,
      );
    }

    // (h) Validar teléfono del agente — requerido para abrir WhatsApp
    if (!property.agent_phone || property.agent_phone.trim() === "") {
      return error_response("AGENT_PHONE_MISSING", "El agente no tiene teléfono registrado", 400);
    }

    // Placeholder — subtareas 14.4-14.6 añadirán leads/counter/mensaje
    return json_response({ ok: true }, 200);
  };
}
