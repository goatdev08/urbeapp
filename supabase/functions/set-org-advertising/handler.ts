// supabase/functions/set-org-advertising/handler.ts
// Handler PURO con dependencias inyectables (subtarea #209.1). No importa
// supabase-js — eso vive en index.ts + _shared/clients.ts. Mismo patrón que
// moderate-ad: el index se mantiene delgado a propósito porque un index.ts
// con lógica propia es lógica sin cobertura (riesgo visto en 73.4).
//
// Orquestación:
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros → 405)
//   3. Parsear JSON → 400 INVALID_INPUT
//   4. Validar payload en memoria (forma, NO la regla de negocio) → 400 INVALID_INPUT
//   5. adminVerifier.verify_caller(authHeader) → 401 / 403
//   6. orgAdvertisingWriter.set(...) → 200 { ok: true } o traducción del código a HTTP
//
// 🔴 LA OBLIGATORIEDAD DE `category` CUANDO `enabled=true` NO SE DECIDE AQUÍ.
// El CHECK `agencies_categoria_requerida_para_anunciar` + el
// `raise exception ADVERTISER_CATEGORY_REQUIRED` de `set_org_advertising_atomic`
// son la única autoridad (ver types.ts). Este handler solo valida la FORMA del
// payload (tipos, presencia, que `category` sea un valor del enum si viene) y
// traduce lo que la RPC conteste.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import { ADVERTISER_CATEGORIES } from "./types.ts";
import type {
  AdvertiserCategory,
  OrgAdvertisingErrorCode,
  SetOrgAdvertisingDeps,
  SetOrgAdvertisingInput,
} from "./types.ts";

const CATEGORY_SET = new Set<string>(ADVERTISER_CATEGORIES);

/**
 * Traducción código-de-negocio → HTTP.
 * `AGENCY_NOT_FOUND` → 404 (el recurso no existe).
 * `ADVERTISER_CATEGORY_REQUIRED` → 422, no 400: el request estaba bien
 * formado en TIPOS — lo que falta es un dato de negocio (mismo criterio
 * 409-vs-400 que moderate-ad para transiciones inválidas).
 * `DB_ERROR` → 500 (cajón de todo lo demás).
 */
const HTTP_STATUS: Record<OrgAdvertisingErrorCode, number> = {
  AGENCY_NOT_FOUND: 404,
  ADVERTISER_CATEGORY_REQUIRED: 422,
  DB_ERROR: 500,
};

/**
 * Mensajes accionables para el admin. Deliberadamente NO se reenvía el texto
 * de Postgres: trae el nombre de la función PL/pgSQL, su línea y el esquema
 * (fuga de implementación). EC-20 lo fija.
 */
const MESSAGES: Record<OrgAdvertisingErrorCode, string> = {
  AGENCY_NOT_FOUND: "La organización no existe o fue eliminada.",
  ADVERTISER_CATEGORY_REQUIRED:
    "Para activar el modo comercial hay que elegir una categoría de anunciante.",
  DB_ERROR: "No pudimos actualizar el modo comercial. Intenta de nuevo.",
};

// ── Validación del payload (forma, no negocio) ──────────────────────────────

type ParseResult =
  | { ok: true; data: SetOrgAdvertisingInput }
  | { ok: false };

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false };
  }
  const body = raw as Record<string, unknown>;

  const agency_id = body.agency_id;
  if (typeof agency_id !== "string" || agency_id.trim() === "") {
    return { ok: false };
  }

  const enabled = body.enabled;
  if (typeof enabled !== "boolean") {
    return { ok: false };
  }

  // `category` es opcional en FORMA (EC-13: enabled=true sin category no es
  // un 400 — la RPC decide vía ADVERTISER_CATEGORY_REQUIRED). Si viene, debe
  // ser un string perteneciente al enum: un valor arbitrario llegando a la
  // RPC produciría un 22P02 crudo de Postgres (fuga de implementación) en vez
  // de un 400 accionable (EC-11).
  const raw_category = body.category;
  let category: AdvertiserCategory | undefined;
  if (raw_category !== undefined) {
    if (typeof raw_category !== "string" || !CATEGORY_SET.has(raw_category)) {
      return { ok: false };
    }
    category = raw_category as AdvertiserCategory;
  }

  return { ok: true, data: { agency_id, enabled, category } };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handler(req: Request, deps: SetOrgAdvertisingDeps): Promise<Response> {
  if (req.method === "OPTIONS") return handle_cors_preflight(req);
  if (req.method !== "POST") {
    return error_response("METHOD_NOT_ALLOWED", "Método no permitido.", 405);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return error_response("INVALID_INPUT", "El cuerpo debe ser JSON válido.", 400);
  }

  const parsed = parse_input(raw);
  if (!parsed.ok) {
    return error_response(
      "INVALID_INPUT",
      "Payload inválido: se requieren agency_id (string), enabled (boolean) y, " +
        "opcionalmente, category (un valor válido de advertiser_category).",
      400,
    );
  }

  // La autorización va DESPUÉS del parseo a propósito (mismo orden que
  // moderate-ad): un payload basura no amerita gastar una verificación de JWT
  // contra la base.
  const auth = await deps.adminVerifier.verify_caller(req.headers.get("Authorization"));
  if (!auth.ok) {
    return auth.error_code === "UNAUTHENTICATED"
      ? error_response("UNAUTHENTICATED", "Se requiere autenticación.", 401)
      : error_response("FORBIDDEN", "Solo un administrador puede cambiar el modo comercial.", 403);
  }

  const { agency_id, enabled, category } = parsed.data;
  const result = await deps.orgAdvertisingWriter.set({
    agency_id,
    enabled,
    category: category ?? null,
    admin_id: auth.user_id,
  });

  if (!result.ok) {
    return error_response(
      result.error_code,
      MESSAGES[result.error_code],
      HTTP_STATUS[result.error_code],
    );
  }

  return json_response({ ok: true }, 200);
}
