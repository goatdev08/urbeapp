// supabase/functions/register-agency/handler.ts
// STUB de fase RED (subtarea 71.4) — SIN lógica de negocio. Existe únicamente
// para que handler.test.ts compile e importe un `handler` real; cada test
// falla por ASERCIÓN (status/body inesperados), nunca por import faltante.
// GREEN reemplaza este cuerpo con la orquestación real (parse → auth →
// AgencyRegistrar.register_atomic → mapeo de errores), mirror de
// upgrade-to-agent/handler.ts.
//
// NO IMPLEMENTAR AQUÍ. El subagente `code-writer` (fase GREEN) escribe la
// lógica real después de que este RED quede aprobado por el guardian.

import type { RegisterAgencyDeps } from "./types.ts";

export function handler(
  _req: Request,
  _deps?: RegisterAgencyDeps,
): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "register-agency aún no implementado (fase RED, subtarea 71.4)",
        },
      }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    ),
  );
}
