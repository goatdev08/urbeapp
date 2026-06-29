// supabase/functions/mint-video-url/handler.ts
// Edge Function: minter puro de signed URLs de video por lote de property_ids.
// Flujo: OPTIONS → método → parse → validación → minter → respuesta.

import type { MintVideoUrlDeps, MintVideoUrlInput } from "./types.ts";
import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";

export async function handler(req: Request, deps?: MintVideoUrlDeps): Promise<Response> {
  // 1. Preflight CORS
  if (req.method === "OPTIONS") {
    return handle_cors_preflight(req);
  }

  // 2. Solo POST
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido", 405);
  }

  // 3. Parse body JSON
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response("INVALID_INPUT", "El cuerpo de la solicitud no es JSON válido", 400);
  }

  // 4. Validar input: objeto con property_ids array no vacío de strings no vacíos
  if (
    typeof raw !== "object" ||
    raw === null ||
    !Array.isArray((raw as Record<string, unknown>).property_ids)
  ) {
    return error_response(
      "INVALID_INPUT",
      "property_ids debe ser un arreglo no vacío de cadenas",
      400,
    );
  }

  const { property_ids } = raw as { property_ids: unknown[] };

  if (property_ids.length === 0) {
    return error_response("INVALID_INPUT", "property_ids no puede ser un arreglo vacío", 400);
  }

  for (const id of property_ids) {
    if (typeof id !== "string" || id === "") {
      return error_response(
        "INVALID_INPUT",
        "Cada elemento de property_ids debe ser una cadena no vacía",
        400,
      );
    }
  }

  const input: MintVideoUrlInput = { property_ids: property_ids as string[] };

  // 5-6. Llamar al minter; deps undefined o minter que lanza → 500 INTERNAL_ERROR
  try {
    const videos = await deps!.videoUrlMinter.mint_signed_urls(input.property_ids);
    return json_response({ videos }, 200);
  } catch {
    return error_response(
      "INTERNAL_ERROR",
      "Error interno al generar las URLs firmadas de video",
      500,
    );
  }
}
