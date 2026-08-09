// supabase/functions/moderate-property/handler.ts
// FASE RED (subtarea 73.9): STUB que SIEMPRE devuelve 501 NOT_IMPLEMENTED.
// No importa supabase-js, no tiene lógica de negocio — solo la firma pública que
// handler.test.ts ejercita. GREEN (agente supabase) implementa la orquestación real
// (parse → validar payload → AdminVerifier → PropertyFetcher → rama suspend vs.
// approve/needs_changes/reject → PropertyUpdater/RevisionResolver → AdminActionRecorder)
// siguiendo el contrato documentado en types.ts y los casos de handler.test.ts.

import { error_response } from "../_shared/response.ts";
import type { ModeratePropertyDeps } from "./types.ts";

export async function handler(
  _req: Request,
  _deps?: ModeratePropertyDeps,
): Promise<Response> {
  return error_response("NOT_IMPLEMENTED", "moderate-property aún no implementado", 501);
}
