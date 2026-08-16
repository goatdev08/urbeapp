// supabase/functions/mint-ad-upload-url/handler.ts
// STUB — fase RED (subtarea 169.4). Solo la firma pública del handler; el GREEN
// implementa la lógica descrita en types.ts (calco de mint-upload-url/handler.ts
// con las dos diferencias documentadas: maxDurationSeconds=30 y concurrencia
// scoped por agency_id sobre ad_creatives). Sin lógica de negocio a propósito:
// cualquier test que invoque handler() falla por la excepción, no por import.

import type { MintAdUploadUrlDeps } from "./types.ts";

export async function handler(
  _req: Request,
  _deps?: MintAdUploadUrlDeps,
): Promise<Response> {
  throw new Error("not_implemented");
}
