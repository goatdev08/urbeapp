// supabase/functions/mint-poster-urls/handler.ts
// Edge Function: orquestación HTTP pura. TODA la lógica de negocio (auth
// por-item owner-o-active, selección del video, firma) vive en el
// PosterUrlMinter inyectado (adapter real: make_poster_url_minter en
// _shared/clients.ts). El handler solo: CORS → método → auth del caller →
// parse+validación de input → llama al minter → pasa el resultado tal cual.
// Fail-closed: cualquier excepción no controlada (deps ausente, minter que
// lanza) se traduce a 500 INTERNAL_ERROR, nunca se propaga cruda.

import type { MintPosterUrlsDeps } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";

export async function handler(req: Request, deps?: MintPosterUrlsDeps): Promise<Response> {
  // 1. Preflight CORS
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  try {
    // 3. Auth (frontera de confianza): el uid SIEMPRE sale del JWT, nunca del
    // body. Fail-closed antes de tocar el minter. Header ausente se corta acá
    // mismo (sin depender de que el CallerVerifier inyectado lo revise) —
    // mismo patrón que mint-thumbnail-url/handler.ts.
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return error_response("UNAUTHENTICATED", "No autenticado", 401);
    }
    const caller = await deps!.callerVerifier.verify_caller(authHeader);
    if (!caller.ok) {
      return error_response("UNAUTHENTICATED", "No autenticado", 401);
    }

    // 4. Parse body JSON
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return error_response("INVALID_INPUT", "El cuerpo de la solicitud no es JSON válido", 400);
    }

    // 5. Validar input: objeto con property_ids array de strings no vacíos
    // (a diferencia de mint-video-url, [] SÍ es válido aquí — caso 10).
    if (
      typeof raw !== "object" ||
      raw === null ||
      !Array.isArray((raw as Record<string, unknown>).property_ids)
    ) {
      return error_response("INVALID_INPUT", "property_ids debe ser un arreglo de cadenas", 400);
    }

    const { property_ids } = raw as { property_ids: unknown[] };

    for (const id of property_ids) {
      if (typeof id !== "string" || id === "") {
        return error_response(
          "INVALID_INPUT",
          "Cada elemento de property_ids debe ser una cadena no vacía",
          400,
        );
      }
    }

    // 6. Minter → pass-through exacto (el minter ya filtró por-item)
    const posters = await deps!.posterUrlMinter.mint_posters(property_ids as string[], caller.user_id);
    return json_response({ posters }, 200);
  } catch {
    return error_response("INTERNAL_ERROR", "Error interno al generar las portadas firmadas", 500);
  }
}
