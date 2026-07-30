// supabase/functions/register/handler.ts
// STUB — fase RED subtarea 93.2. Fija SOLO la firma pública para que
// handler.test.ts pueda importar el módulo; no implementa lógica de negocio.
//
// El agente supabase implementa la orquestación real en fase GREEN:
//   validar payload (§5.1, TODOS los campos obligatorios) →
//   deps.authAdmin.createUser(...) con user_metadata EXACTA a lo que lee
//   handle_new_user (migración 20260727000002) y email_confirm:true →
//   deps.registrar.register_atomic({ user_id, ip }) — EXACTAMENTE UNA VEZ,
//   la RPC 93.1 es append-only, no idempotente → 200 { user_id }.
//   Si register_atomic falla → compensación deps.authAdmin.deleteUser(user_id);
//   si la compensación también falla, el error ORIGINAL de register_atomic
//   sigue subiendo (no se enmascara) — mismo patrón que
//   ../redeem-invitation/handler.ts.
//   Todo error de createUser/register_atomic se mapea a un código SANITIZADO
//   (nunca teléfono/email/nombre de índice/detail crudo de Postgres en el
//   body — hueco 2 de la tarea #93).
//
// Toda invocación lanza a propósito: fuerza RED por excepción, no por import roto.

import type { RegisterDeps } from "./types.ts";

export function handler(
  _req: Request,
  _deps?: RegisterDeps,
): Promise<Response> {
  throw new Error("not_implemented");
}
