// supabase/functions/contact-agent/handler.ts
// Stub mínimo — fase RED subtarea 14.2.
// Lanza not_implemented para que los tests fallen por ASERCIÓN/excepción, no por import roto.
//
// Contrato del skeleton (lo implementa el agente supabase en la fase GREEN):
//   make_contact_agent_handler(deps) → (req) → Response
//
// Orden de orquestación (GREEN implementará):
//   1. OPTIONS → handle_cors_preflight (204 con headers CORS)
//   2. Solo POST → 405 si otro método
//   3. Verificar JWT via deps.callerVerifier → 401 UNAUTHENTICATED si falta/inválido
//   4. Parsear body JSON → 400 INVALID_INPUT si no es JSON
//   5. Validar propertyId: presente, string, formato UUID → 400 INVALID_INPUT si falla
//      (parse_contact_agent_input — validación manual sin Zod, ponytail:)
//   6. Placeholder → 200 { ok: true } (subtareas 14.3-14.6 implementarán la lógica real)

import type { ContactAgentDeps } from "./types.ts";

export function make_contact_agent_handler(
  _deps: ContactAgentDeps,
): (req: Request) => Promise<Response> {
  return async function (_req: Request): Promise<Response> {
    throw new Error("not_implemented");
  };
}
