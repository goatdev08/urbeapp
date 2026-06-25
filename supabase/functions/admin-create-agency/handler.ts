// supabase/functions/admin-create-agency/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Orquestación: validación de body → validación de payload → verificar admin →
// creación atómica de agencia vía RPC (migración 0016).

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { parse_create_agency_input } from "../_shared/validation.ts";
import type { AdminVerifier } from "../_shared/admin_auth.ts";
import type { AgencyCreator } from "../_shared/agency.ts";
import {
  AGENCY_CREATE_ERROR_MESSAGES,
  AGENCY_CREATE_ERROR_STATUS,
} from "../_shared/agency.ts";

/**
 * Dependencias inyectables del handler (DI pattern).
 * En producción se construyen desde _shared/clients.ts.
 * En tests se inyectan fakes controlados.
 */
export interface AdminCreateAgencyDeps {
  adminVerifier?: AdminVerifier;
  agencyCreator?: AgencyCreator;
}

/**
 * Handler exportado para tests unitarios sin Deno.serve().
 *
 * Payload esperado: { name, slug, contact_email?, contact_name?, contact_phone? }
 * Respuestas:
 *   OPTIONS → 200 con headers CORS
 *   GET/PUT/DELETE → 405
 *   POST inválido (body/validación) → 400 { error: { code: "INVALID_INPUT", message } }
 *   POST sin/!admin → 401 UNAUTHENTICATED | 403 FORBIDDEN
 *   POST admin válido → 201 { agency_id } | 409 SLUG_DUPLICATE | 409 NAME_DUPLICATE | 500
 */
export async function handler(
  req: Request,
  deps?: AdminCreateAgencyDeps,
): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // Solo POST permitido
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // Leer body — 400 si no es JSON válido
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

  // Validar payload — 400 si falla
  const parsed = parse_create_agency_input(raw);
  if (!parsed.success) {
    return error_response(parsed.error.code, parsed.error.message, 400);
  }

  const { name, slug, contact_email, contact_name, contact_phone } =
    parsed.data;

  // Verificar admin — 401 UNAUTHENTICATED | 403 FORBIDDEN
  const authHeader = req.headers.get("Authorization");
  const verifyResult = await deps!.adminVerifier!.verify_caller(authHeader);
  if (!verifyResult.ok) {
    const status = verifyResult.error_code === "UNAUTHENTICATED" ? 401 : 403;
    const message =
      verifyResult.error_code === "UNAUTHENTICATED"
        ? "Se requiere autenticación de administrador"
        : "Acceso denegado: se requiere rol de administrador";
    return error_response(verifyResult.error_code, message, status);
  }

  // Crear agencia atómicamente
  const createResult = await deps!.agencyCreator!.create_atomic({
    name,
    slug,
    contact_name,
    contact_phone,
    contact_email,
    created_by_user_id: verifyResult.user_id,
  });

  if (!createResult.ok) {
    const status = AGENCY_CREATE_ERROR_STATUS[createResult.error_code] ?? 500;
    if (status >= 500) {
      return error_response(
        createResult.error_code,
        "Error interno al crear la agencia",
        500,
      );
    }
    const message =
      AGENCY_CREATE_ERROR_MESSAGES[createResult.error_code] ??
      "Error al crear la agencia";
    return error_response(createResult.error_code, message, status);
  }

  return json_response({ agency_id: createResult.agency_id }, 201);
}
