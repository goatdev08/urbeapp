// supabase/functions/mint-r2-url/handler.ts
// Edge Function: firma presigned URLs de R2 (S3-compatible) para PUT/GET de
// avatares, logos y (lectura) archivos cold-store.
//
// Flujo: OPTIONS → método → parse → validación de forma → auth (401) →
//        autorización fail-closed (403) → minter (500 si lanza) → 200.
//
// Toda la autorización vive AQUÍ, antes de invocar al minter (que es un
// adapter puro de firma, sin lógica de negocio).

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import {
  type AssetKind,
  GET_TTL_SECONDS,
  type MintR2UrlDeps,
  type MintR2UrlInput,
  PUT_TTL_SECONDS,
  type R2Operation,
} from "./types.ts";

const VALID_KINDS: readonly AssetKind[] = ["avatar", "logo", "archive"];
const VALID_OPS: readonly R2Operation[] = ["put", "get"];

/**
 * Valida y normaliza el body crudo. Devuelve null si la forma es inválida
 * (el handler traduce eso a 400 INVALID_INPUT).
 */
function validate_input(raw: unknown): MintR2UrlInput | null {
  if (typeof raw !== "object" || raw === null) return null;

  const { kind, op, key, keys } = raw as Record<string, unknown>;

  if (typeof kind !== "string" || !VALID_KINDS.includes(kind as AssetKind)) {
    return null;
  }
  if (typeof op !== "string" || !VALID_OPS.includes(op as R2Operation)) {
    return null;
  }

  if (op === "put") {
    if (key !== undefined && (typeof key !== "string" || key === "")) {
      return null;
    }
    return { op: "put", kind: kind as AssetKind, key: key as string | undefined };
  }

  // op === "get": keys es un lote no vacío de cadenas no vacías.
  if (!Array.isArray(keys) || keys.length === 0) return null;
  for (const k of keys) {
    if (typeof k !== "string" || k === "") return null;
  }
  return { op: "get", kind: kind as AssetKind, keys: keys as string[] };
}

export async function handler(
  req: Request,
  deps?: MintR2UrlDeps,
): Promise<Response> {
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

  // 4. Validar forma del input
  const input = validate_input(raw);
  if (input === null) {
    return error_response(
      "INVALID_INPUT",
      "kind/op/key/keys no tienen una forma válida",
      400,
    );
  }

  // 5. deps ausentes → error interno (nunca llegar a firmar sin dependencias reales)
  if (!deps) {
    return error_response("INTERNAL_ERROR", "Dependencias no configuradas", 500);
  }

  // 6. Auth — JWT del solicitante (frontera de confianza, fail-closed)
  const authHeader = req.headers.get("Authorization");
  let caller;
  try {
    caller = await deps.callerVerifier.verify_caller(authHeader);
  } catch {
    return error_response("INTERNAL_ERROR", "Error al verificar el solicitante", 500);
  }
  if (!caller.ok) {
    return error_response("UNAUTHENTICATED", "Solicitante no autenticado", 401);
  }
  const user_id = caller.user_id;

  // 7. op=get: cualquier autenticado puede leer (bucket privado, assets público-a-autenticados)
  if (input.op === "get") {
    try {
      const items = await deps.r2UrlMinter.sign_get_batch(input.keys, GET_TTL_SECONDS);
      return json_response({ urls: items }, 200);
    } catch {
      return error_response("INTERNAL_ERROR", "Error interno al firmar las URLs de lectura", 500);
    }
  }

  // 8. op=put: autorización fail-closed por kind, ANTES de invocar al minter
  let key: string;
  if (input.kind === "avatar") {
    const own_prefix = `avatars/${user_id}/`;
    if (input.key !== undefined) {
      if (!input.key.startsWith(own_prefix)) {
        return error_response("FORBIDDEN", "No puedes subir a un prefix de avatar ajeno", 403);
      }
      key = input.key;
    } else {
      key = `${own_prefix}${crypto.randomUUID()}`;
    }
  } else if (input.kind === "logo") {
    const owned_agency_id = await deps.agencyOwnershipVerifier.get_owned_agency_id(user_id);
    if (owned_agency_id === null) {
      return error_response("FORBIDDEN", "No eres owner activo de ninguna agencia", 403);
    }
    const own_prefix = `logos/${owned_agency_id}/`;
    if (input.key !== undefined) {
      if (!input.key.startsWith(own_prefix)) {
        return error_response("FORBIDDEN", "No puedes subir el logo de una agencia ajena", 403);
      }
      key = input.key;
    } else {
      key = `${own_prefix}${crypto.randomUUID()}`;
    }
  } else {
    // kind === "archive": put fuera de alcance de esta subtarea (cold-store, tarea #68).
    // Fail-closed: ningún usuario final está autorizado a escribir ahí todavía.
    return error_response("FORBIDDEN", "Subida de archivo no disponible", 403);
  }

  try {
    const url = await deps.r2UrlMinter.sign_put(key, PUT_TTL_SECONDS);
    return json_response({ url, key, expires: PUT_TTL_SECONDS }, 200);
  } catch {
    return error_response("INTERNAL_ERROR", "Error interno al firmar la URL de subida", 500);
  }
}
