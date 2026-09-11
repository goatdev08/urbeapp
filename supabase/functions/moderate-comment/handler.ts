// supabase/functions/moderate-comment/handler.ts
// STUB — fase RED, subtarea 289.6. El contrato completo (orden de orquestación,
// mapeo de errores, seam de admin_jwt) está fijado en types.ts y verificado por
// handler.test.ts. GREEN implementa la lógica real aquí (calco estructural de
// moderate-property/handler.ts); este archivo NO se toca en el RED salvo para
// dejarlo compilando.

import type { ModerateCommentDeps } from "./types.ts";

export function handler(
  _req: Request,
  _deps?: ModerateCommentDeps,
): Promise<Response> {
  throw new Error("not_implemented");
}
