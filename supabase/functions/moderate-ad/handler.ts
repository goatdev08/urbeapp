// supabase/functions/moderate-ad/handler.ts
// Handler PURO con dependencias inyectables (subtarea #208.1). No importa
// supabase-js — eso vive en index.ts + _shared/clients.ts. Mismo patrón que
// moderate-property: el index se mantiene delgado a propósito porque un
// index.ts con lógica propia es lógica sin cobertura (riesgo visto en 73.4).
//
// Orquestación:
//   1. CORS preflight (OPTIONS → 200)
//   2. Solo POST (otros → 405)
//   3. Parsear JSON → 400 INVALID_INPUT
//   4. Validar payload en memoria → 400 INVALID_INPUT / REJECTION_REASON_REQUIRED
//   5. adminVerifier.verify_caller(authHeader) → 401 / 403
//   6. moderationWriter.moderate(...) → 200 o traducción del código a HTTP
//
// 🔴 LA VALIDEZ DE LA TRANSICIÓN NO SE DECIDE AQUÍ. El trigger
// `handle_ad_status_change()` es la única autoridad: valida el grafo, bloquea
// activar bajo organización suspendida y escribe `admin_actions` en la misma
// transacción. Este handler manda el UPDATE y traduce la negativa. Por eso NO
// hay un mapa de estados en este archivo — buscarlo y no encontrarlo es lo
// correcto.
//
// ponytail: sin capa de "servicio" intermedia entre el parseo y el writer. Son
// dos pasos y un `switch`; una clase o un orquestador aparte no compraría nada.
// Techo conocido: si algún día hay más de dos acciones (pausar, extender), el
// `switch` de traducción crece y ahí sí conviene una tabla.

import { handle_cors_preflight } from "../_shared/cors.ts";
import { error_response, json_response } from "../_shared/response.ts";
import type {
  AdModerationErrorCode,
  ModerateAdAction,
  ModerateAdDeps,
  ModerateAdInput,
} from "./types.ts";

// `suspend` se enumera para NO aceptarla: existe de verdad en
// moderate-property y un copy-paste podría colarla. Un anuncio se pausa por la
// cascada de suspensión de su organización, no por una acción de moderación.
const VALID_ACTIONS = new Set<ModerateAdAction>(["approve", "reject"]);

const NEXT_STATUS: Record<ModerateAdAction, "active" | "rejected"> = {
  approve: "active",
  reject: "rejected",
};

/**
 * Traducción código-de-negocio → HTTP. `INVALID_AD_STATUS_TRANSITION` y
 * `ORGANIZATION_SUSPENDED` son **409, no 400**: el request estaba bien formado;
 * lo que no permite la operación es el estado actual del recurso.
 */
const HTTP_STATUS: Record<AdModerationErrorCode, number> = {
  AD_NOT_FOUND: 404,
  INVALID_AD_STATUS_TRANSITION: 409,
  ORGANIZATION_SUSPENDED: 409,
  DB_ERROR: 500,
};

/**
 * Mensajes accionables para el admin. Deliberadamente NO se reenvía el texto
 * de Postgres: trae el nombre de la función PL/pgSQL, su línea y el esquema
 * (fuga de implementación hacia un cliente móvil). EC-15 lo fija.
 */
const MESSAGES: Record<AdModerationErrorCode, string> = {
  AD_NOT_FOUND: "El anuncio no existe o fue eliminado.",
  INVALID_AD_STATUS_TRANSITION:
    "El anuncio ya no está en revisión — alguien más pudo haberlo moderado.",
  ORGANIZATION_SUSPENDED:
    "La organización anunciante está suspendida: reactívala antes de aprobar su anuncio.",
  DB_ERROR: "No pudimos completar la moderación. Intenta de nuevo.",
};

// ── Validación del payload ───────────────────────────────────────────────────

type ParseResult =
  | { ok: true; data: ModerateAdInput }
  | { ok: false; code: "INVALID_INPUT" | "REJECTION_REASON_REQUIRED" };

function parse_input(raw: unknown): ParseResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, code: "INVALID_INPUT" };
  }
  const body = raw as Record<string, unknown>;

  const ad_id = body.ad_id;
  if (typeof ad_id !== "string" || ad_id.trim() === "") {
    return { ok: false, code: "INVALID_INPUT" };
  }

  const action = body.action;
  if (typeof action !== "string" || !VALID_ACTIONS.has(action as ModerateAdAction)) {
    return { ok: false, code: "INVALID_INPUT" };
  }

  // La razón solo existe para `reject`. En `approve` se DESCARTA aunque venga
  // en el body: el CHECK ads_rejection_reason_matches_status exige
  // (status='rejected') === (rejection_reason is not null), así que dejarla
  // pasar produciría un 23514 crudo en vez de una aprobación (EC-5).
  if (action === "reject") {
    const reason = body.rejection_reason;
    if (typeof reason !== "string" || reason.trim() === "") {
      return { ok: false, code: "REJECTION_REASON_REQUIRED" };
    }
    return { ok: true, data: { ad_id, action, rejection_reason: reason } };
  }

  return { ok: true, data: { ad_id, action: "approve" } };
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function handler(req: Request, deps: ModerateAdDeps): Promise<Response> {
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
    const message = parsed.code === "REJECTION_REASON_REQUIRED"
      ? "Para rechazar un anuncio hay que decir por qué."
      : "Payload inválido: se requieren ad_id y action ('approve' | 'reject').";
    return error_response(parsed.code, message, 400);
  }

  // La autorización va DESPUÉS del parseo a propósito (mismo orden que
  // moderate-property): un payload basura no amerita gastar una verificación
  // de JWT contra la base.
  const auth = await deps.adminVerifier.verify_caller(req.headers.get("Authorization"));
  if (!auth.ok) {
    return auth.error_code === "UNAUTHENTICATED"
      ? error_response("UNAUTHENTICATED", "Se requiere autenticación.", 401)
      : error_response("FORBIDDEN", "Solo un administrador puede moderar anuncios.", 403);
  }

  const { ad_id, action, rejection_reason } = parsed.data;
  const result = await deps.moderationWriter.moderate({
    ad_id,
    next_status: NEXT_STATUS[action],
    rejection_reason: rejection_reason ?? null,
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
