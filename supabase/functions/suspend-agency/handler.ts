// supabase/functions/suspend-agency/handler.ts
// Handler PURO con dependencias inyectables (subtarea #211.1). No importa
// supabase-js — eso vive en index.ts + _shared/clients.ts. Mismo patrón que
// moderate-ad/handler.ts: el index se mantiene delgado a propósito porque un
// index.ts con lógica propia es lógica sin cobertura (riesgo visto en 73.4).
//
// Orquestación:
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros → 405)
//   3. Parsear JSON → 400 INVALID_INPUT
//   4. Validar payload en memoria → 400 INVALID_INPUT
//   5. adminVerifier.verify_caller(authHeader) → 401 / 403
//   6. agencyStatusWriter.set_status(...) → 200 o traducción del código a HTTP
//
// 🔴 LA VALIDEZ DE LA TRANSICIÓN NO SE DECIDE AQUÍ. El trigger
// `handle_agency_status_change()` es la única autoridad: valida el grafo,
// cascada sobre `ads` y escribe `admin_actions` en la misma transacción. Este
// handler manda el UPDATE (vía la RPC) y traduce la negativa. Por eso NO hay
// un mapa de estados en este archivo — buscarlo y no encontrarlo es lo
// correcto.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  AgencyStatusErrorCode,
  SuspendAgencyAction,
  SuspendAgencyDeps,
  SuspendAgencyInput,
} from "./types.ts";

// `suspend`/`reactivate` son las únicas acciones sobre una organización.
// `approve`/`reject` existen para ANUNCIOS (moderate-ad); un copy-paste entre
// EFs de moderación no debe colarlas aquí (EC-18).
const VALID_ACTIONS = new Set<SuspendAgencyAction>(["suspend", "reactivate"]);

const NEXT_STATUS: Record<SuspendAgencyAction, "active" | "suspended"> = {
  suspend: "suspended",
  reactivate: "active",
};

/**
 * Traducción código-de-negocio → HTTP. `INVALID_STATUS_TRANSITION` es 409, no
 * 400: el request estaba bien formado; lo que no permite la operación es el
 * estado actual del recurso (p.ej. una organización pending_approval que aún
 * no fue aprobada no puede suspenderse).
 */
const HTTP_STATUS: Record<AgencyStatusErrorCode, number> = {
  AGENCY_NOT_FOUND: 404,
  INVALID_STATUS_TRANSITION: 409,
  DB_ERROR: 500,
};

/**
 * Mensajes accionables para el admin. Deliberadamente NO se reenvía el texto
 * de Postgres: trae el nombre de la función PL/pgSQL, su línea y el esquema
 * (fuga de implementación hacia un cliente móvil). EC-11 lo fija.
 */
const MESSAGES: Record<AgencyStatusErrorCode, string> = {
  AGENCY_NOT_FOUND: "La organización no existe o fue eliminada.",
  INVALID_STATUS_TRANSITION:
    "La organización no está en un estado que permita esta acción.",
  DB_ERROR: "No pudimos completar la operación. Intenta de nuevo.",
};

// ── Validación del payload ───────────────────────────────────────────────────

type ParseResult =
  | { ok: true; data: SuspendAgencyInput }
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

  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action as SuspendAgencyAction)) {
    return { ok: false };
  }

  return { ok: true, data: { agency_id, action: action as SuspendAgencyAction } };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handler(req: Request, deps: SuspendAgencyDeps): Promise<Response> {
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
      "Payload inválido: se requieren agency_id y action ('suspend' | 'reactivate').",
      400,
    );
  }

  // La autorización va DESPUÉS del parseo a propósito (mismo orden que
  // moderate-ad/moderate-property): un payload basura no amerita gastar una
  // verificación de JWT contra la base.
  const auth = await deps.adminVerifier.verify_caller(req.headers.get("Authorization"));
  if (!auth.ok) {
    return auth.error_code === "UNAUTHENTICATED"
      ? error_response("UNAUTHENTICATED", "Se requiere autenticación.", 401)
      : error_response("FORBIDDEN", "Solo un administrador puede suspender organizaciones.", 403);
  }

  const { agency_id, action } = parsed.data;
  const result = await deps.agencyStatusWriter.set_status({
    agency_id,
    next_status: NEXT_STATUS[action],
    admin_id: auth.user_id,
  });

  if (!result.ok) {
    return error_response(
      result.error_code,
      MESSAGES[result.error_code],
      HTTP_STATUS[result.error_code],
    );
  }

  return json_response({ status: result.status }, 200);
}
