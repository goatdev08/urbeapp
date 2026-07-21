// supabase/functions/archive-video/handler.ts
// STUB RED — subtarea 68.8. El handler real (GREEN) implementa el flujo descrito en
// types.ts (parse → auth → load → enable_download+backoff → fetch_mp4 → R2 upload →
// ordering seguro delete_video/mark_archived → 200). Este stub SOLO existe para que
// handler.test.ts compile y falle por excepción (no por import roto) — cero lógica.

import type { ArchiveVideoDeps } from "./types.ts";

export function handler(_req: Request, _deps?: ArchiveVideoDeps): Promise<Response> {
  throw new Error("not_implemented");
}
