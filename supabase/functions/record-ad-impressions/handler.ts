// supabase/functions/record-ad-impressions/handler.ts
// STUB — fase RED, subtarea 170.6. Sin lógica: lanza para que la suite en
// handler.test.ts falle por excepción (no por import). Implementación real
// (GREEN): orquestación HTTP + auth + validación de input + elegibilidad
// (ad existe, status='active', deps.now() BETWEEN starts_at/ends_at) +
// derivación del id (#193) + recálculo de zona + escritura por-item
// fail-closed. Contrato completo en types.ts y handler.test.ts.

import type { RecordAdImpressionsDeps } from "./types.ts";

export function handler(_req: Request, _deps?: RecordAdImpressionsDeps): Promise<Response> {
  throw new Error("not_implemented");
}
