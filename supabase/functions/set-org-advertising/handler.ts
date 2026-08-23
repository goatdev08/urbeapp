// supabase/functions/set-org-advertising/handler.ts
//
// 🔴 STUB RED — subtarea #209.1. Firma real, CERO lógica de negocio. Lanza a
// propósito para que handler.test.ts falle por ASERCIÓN (no por import roto).
// La implementación real (parseo + orden CORS/método/JSON/payload/auth/writer,
// traducción de OrgAdvertisingErrorCode → HTTP) la escribe la fase GREEN,
// siguiendo el patrón ya cerrado en moderate-ad/handler.ts.

import type { SetOrgAdvertisingDeps } from "./types.ts";

export async function handler(
  _req: Request,
  _deps: SetOrgAdvertisingDeps,
): Promise<Response> {
  await Promise.resolve();
  throw new Error("not_implemented: set-org-advertising handler (RED, subtarea #209.1)");
}
