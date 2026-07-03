// supabase/functions/update-lead-note/handler.ts
// STUB mínimo (fase RED, subtareas 29.2/29.3). La orquestación real (parse,
// validación, CallerVerifier, NoteUpdater, mapeo a HTTP) se implementa en el
// GREEN de la subtarea 29.4. Este stub existe solo para que handler.test.ts
// compile e importe; debe FALLAR por aserción, nunca por import.

import type { UpdateLeadNoteDeps } from "./types.ts";

export function handler(
  _req: Request,
  _deps?: UpdateLeadNoteDeps,
): Promise<Response> {
  return Promise.resolve(new Response("stub", { status: 500 }));
}
