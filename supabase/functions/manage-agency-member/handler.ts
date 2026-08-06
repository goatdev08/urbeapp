// supabase/functions/manage-agency-member/handler.ts
// STUB de fase RED (subtarea 71.6) — SIN lógica de negocio. Existe únicamente
// para que handler.test.ts compile e importe un `handler` real; cada test
// falla por ASERCIÓN (status/body inesperados), nunca por import faltante.
// GREEN reemplaza este cuerpo con la orquestación real (parse → auth →
// AgencyMemberManager.manage → mapeo de errores), mirror de
// register-agency/handler.ts / update-property-status/handler.ts.
//
// NO IMPLEMENTAR AQUÍ. El subagente `code-writer` (fase GREEN) escribe la
// lógica real después de que este RED quede aprobado por el guardian.

import type { ManageAgencyMemberDeps } from "./types.ts";

export function handler(
  _req: Request,
  _deps?: ManageAgencyMemberDeps,
): Promise<Response> {
  return Promise.resolve(
    new Response(
      JSON.stringify({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "manage-agency-member aún no implementado (fase RED, subtarea 71.6)",
        },
      }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    ),
  );
}
