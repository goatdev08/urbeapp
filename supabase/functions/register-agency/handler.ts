// supabase/functions/register-agency/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso
// vive en index.ts (entry de producción). Patrón espejo de
// upgrade-to-agent/handler.ts.
//
// Contrato:
//   POST { name, slug, contact_name, contact_phone, contact_email, logo_url? }
//   → 201 { agency_id, name, slug, status: 'pending_approval', logo_url }
//   | 400 INVALID_INPUT | 401 UNAUTHENTICATED
//   | 400 CREATED_BY_REQUIRED | 400 FIELDS_INCOMPLETE
//   | 409 SLUG_DUPLICATE | 409 NAME_DUPLICATE
//   | 405 | 500 {USER_NOT_FOUND|código desconocido}
//
// ⭐ created_by_user_id SIEMPRE del JWT (nunca del payload) — el caller solo
// puede registrar una agencia a su propio nombre. La RPC register_agency_atomic
// (migración 20260805000006) hace la validación+alta atómica completa; este
// handler solo autentica, valida el payload en memoria y mapea errores de
// negocio a HTTP.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { parse_register_agency_input } from "../_shared/validation.ts";
import type { RegisterAgencyDeps } from "./types.ts";

// Mapeo de los errores de negocio de la RPC (SQLSTATE P0001) a HTTP status.
const REGISTER_AGENCY_ERROR_STATUS: Record<string, number> = {
  SLUG_DUPLICATE: 409,
  NAME_DUPLICATE: 409,
  CREATED_BY_REQUIRED: 400,
  FIELDS_INCOMPLETE: 400,
  USER_NOT_FOUND: 500,
};

const REGISTER_AGENCY_ERROR_MESSAGES: Record<string, string> = {
  SLUG_DUPLICATE: "Ya existe una agencia con ese slug",
  NAME_DUPLICATE: "Ya existe una agencia con ese nombre",
  CREATED_BY_REQUIRED: "created_by_user_id es requerido",
  FIELDS_INCOMPLETE: "Los datos de contacto están incompletos",
  USER_NOT_FOUND: "No se pudo completar el registro",
};

// ── Handler exportado ─────────────────────────────────────────────────────────

export async function handler(
  req: Request,
  deps?: RegisterAgencyDeps,
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

  // 4. Validar payload en-memoria (name/slug/contact_* obligatorios, §4.7)
  const parsed = parse_register_agency_input(raw);
  if (!parsed.success) {
    return error_response(parsed.error.code, parsed.error.message, 400);
  }

  // 5. Verificar caller (JWT) — user_id SIEMPRE del token, nunca del payload
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.callerVerifier.verify_caller(authHeader);
  if (!verifyResult.ok) {
    return error_response("UNAUTHENTICATED", "Se requiere autenticación", 401);
  }

  // 6. Alta atómica vía RPC register_agency_atomic (migración 20260805000006)
  const result = await deps!.agencyRegistrar.register_atomic({
    name: parsed.data.name,
    slug: parsed.data.slug,
    contact_name: parsed.data.contact_name,
    contact_phone: parsed.data.contact_phone,
    contact_email: parsed.data.contact_email,
    logo_url: parsed.data.logo_url,
    created_by_user_id: verifyResult.user_id,
  });

  // 7. Mapear resultado a HTTP
  if (!result.ok) {
    const status = REGISTER_AGENCY_ERROR_STATUS[result.error_code] ?? 500;
    const message = REGISTER_AGENCY_ERROR_MESSAGES[result.error_code] ??
      "No se pudo completar el registro";
    return error_response(result.error_code, message, status);
  }

  // 8. Éxito
  return json_response(
    {
      agency_id: result.agency.agency_id,
      name: result.agency.name,
      slug: result.agency.slug,
      status: result.agency.status,
      logo_url: result.agency.logo_url,
    },
    201,
  );
}
