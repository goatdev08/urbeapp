// supabase/functions/redeem-invitation/index.ts — STUB (not_implemented)
// Fase RED: este archivo es un scaffold mínimo que lanza en cada rama.
// El agente supabase implementará la lógica real en las fases GREEN (5.1+).

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response } from "../_shared/response.ts";
import { parse_redeem_invitation_input } from "../_shared/validation.ts";

/**
 * Handler exportado para facilitar tests unitarios sin Deno.serve().
 * Contrato de entrada/salida documentado en §17.3 (lineamientos) y tarea #5.
 *
 * Payload esperado: { invitationCode, email, password, fullName }
 * Respuestas:
 *   OPTIONS → 200/204 con headers CORS
 *   GET/PUT/DELETE → 405
 *   POST inválido → 400 { error: { code: "INVALID_INPUT", message } }
 *   POST válido → 200 { jwt, ... } (5.2+)
 *
 * STUB: lanza "not_implemented" — los tests fallan en rojo por aserción.
 */
export async function handler(req: Request): Promise<Response> {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req); // lanza not_implemented
  }

  // Solo POST permitido
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405); // lanza not_implemented
  }

  // Leer body
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response("INVALID_INPUT", "El cuerpo de la petición no es JSON válido", 400);
  }

  // Validar payload
  const parsed = parse_redeem_invitation_input(raw); // lanza not_implemented
  if (!parsed.success) {
    return error_response("INVALID_INPUT", parsed.error.message, 400);
  }

  // Lógica de negocio — pendiente (5.2+)
  throw new Error("not_implemented: lógica de negocio en subtareas 5.2+");
}

// Punto de entrada Deno
Deno.serve(handler);
