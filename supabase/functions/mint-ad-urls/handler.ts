// supabase/functions/mint-ad-urls/handler.ts
// GREEN — subtarea 169.5. Orquestación HTTP pura, calco de
// mint-poster-urls/handler.ts (CORS → método → auth → parse+validación de
// input → llama al AdUrlMinter → pasa el resultado tal cual). TODA la lógica
// de negocio (auth por-item agencia-o-anuncio-activo, selección del creativo,
// firma) vive en el AdUrlMinter inyectado (adapter real: make_ad_url_minter
// en _shared/clients.ts). Fail-closed: cualquier excepción no controlada
// (deps ausente, minter que lanza) se traduce a 500 INTERNAL_ERROR, nunca se
// propaga cruda. Ver types.ts para el contrato completo y handler.test.ts
// para los edge cases (SEAMS).

import type { MintAdUrlsDeps } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";

export async function handler(req: Request, deps?: MintAdUrlsDeps): Promise<Response> {
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
    // body. Fail-closed antes de tocar el minter.
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

    // 5. Validar input: objeto con creative_ids array de strings no vacíos
    // ([] SÍ es válido, mismo criterio que mint-poster-urls).
    if (
      typeof raw !== "object" ||
      raw === null ||
      !Array.isArray((raw as Record<string, unknown>).creative_ids)
    ) {
      return error_response("INVALID_INPUT", "creative_ids debe ser un arreglo de cadenas", 400);
    }

    const { creative_ids } = raw as { creative_ids: unknown[] };

    for (const id of creative_ids) {
      if (typeof id !== "string" || id === "") {
        return error_response(
          "INVALID_INPUT",
          "Cada elemento de creative_ids debe ser una cadena no vacía",
          400,
        );
      }
    }

    // 6. Minter → pass-through exacto (el minter ya filtró por-item)
    const urls = await deps!.adUrlMinter.mint_ad_urls(creative_ids as string[], caller.user_id);
    return json_response({ urls }, 200);
  } catch {
    return error_response("INTERNAL_ERROR", "Error interno al generar las URLs firmadas", 500);
  }
}
