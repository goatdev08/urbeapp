// supabase/functions/post-comment/handler.ts
// STUB — fase RED, subtarea 289.5. Lanza SIEMPRE `not_implemented` a propósito: el
// GREEN implementa la orquestación real documentada en types.ts (cabecera del
// archivo — orden OPTIONS → método → JWT → parse body → validación → propertyFetcher
// → classify_comment → commentWriter → 201). Solo firma — sin lógica.

import type { PostCommentDeps } from "./types.ts";

export async function handler(
  _req: Request,
  _deps?: PostCommentDeps,
): Promise<Response> {
  throw new Error("not_implemented");
}
