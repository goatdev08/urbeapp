// supabase/functions/admin-create-agency/handler.ts
// Handler PURO con dependencias inyectables (DI). No importa supabase-js — eso vive
// en index.ts (entry de producción). Esto mantiene los tests rápidos y offline.
//
// Stub mínimo — fase RED subtarea 7.4.
// GREEN implementa:
//   (1) CORS preflight
//   (2) solo POST → 405
//   (3) body parse + parse_create_agency_input → 400
//   (4) adminVerifier.verify_caller → 401/403
//   (5) agencyCreator.create_atomic → 409/500
//   (6) éxito → 201 { agency_id }

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response } from "../_shared/response.ts";
import type { AdminVerifier } from "../_shared/admin_auth.ts";
import type { AgencyCreator } from "../_shared/agency.ts";

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
 *
 * Stub: retorna 500 INTERNAL_ERROR para todo hasta que GREEN implemente la lógica.
 */
export async function handler(
  _req: Request,
  _deps?: AdminCreateAgencyDeps,
): Promise<Response> {
  // Stub mínimo — todos los tests fallan por aserción (status 500 != esperado).
  // GREEN reemplaza esta función con la lógica real.
  return error_response("INTERNAL_ERROR", "not_implemented", 500);
}
