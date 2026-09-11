// supabase/functions/post-comment/types.ts
// Tipos y contratos DI para la Edge Function post-comment (subtarea 289.5, tarea #289).
// Solo interfaces + tipos; sin imports de supabase-js (eso vive en _shared/clients.ts /
// index.ts, patrón moderate-property / update-lead-note).
//
// Contrato HTTP (fijado en el RED, handler.test.ts lo verifica):
//   POST /post-comment, JWT de usuario autenticado obligatorio.
//   Body: { property_id: string (uuid); body: string }
//   user_id SIEMPRE viene del JWT (callerVerifier) — un user_id en el body se IGNORA.
//   Éxito → 201 { comment: CommentRecord }.
//   Errores (mismo shape que moderate-property/update-lead-note: error_response de
//   _shared/response.ts → { error: { code, message } }):
//     401 UNAUTHENTICATED        — sin JWT / JWT inválido
//     400 INVALID_INPUT          — JSON inválido, property_id no-uuid, body ausente/
//                                   vacío/solo-whitespace/>500 chars
//     404 PROPERTY_NOT_FOUND     — la propiedad no existe (o soft-deleted)
//     409 PROPERTY_NOT_ACTIVE    — la propiedad existe pero properties.status <> 'active'
//     500 DB_ERROR               — commentWriter falla
//     405 METHOD_NOT_ALLOWED     — método distinto de POST/OPTIONS
//
// Orden de orquestación (documentado aquí porque el RED lo fija; calca contact-agent
// handler.ts:6-11 — JWT ANTES que el parseo del body, NO el orden de update-lead-note):
//   1. OPTIONS → CORS preflight
//   2. método !== POST → 405
//   3. callerVerifier.verify_caller(authHeader) → 401 si falla (ANTES de tocar el body:
//      un caller sin JWT nunca debe enterarse de si su body es válido o no)
//   4. parse JSON body → 400 INVALID_INPUT si no es JSON
//   5. validar payload en-memoria (property_id uuid, body \S ≤500, SIN trim) → 400
//   6. propertyFetcher.fetch(property_id) → 404 / 409 / 500
//   7. classify_comment(body, filterWords) — filterWords viene de configReader
//      (fail-open: deps.configReader ausente o que su promesa rechace → [] y el
//      filtro base sigue aplicando; NUNCA aborta la petición)
//   8. commentWriter.insert({ property_id, user_id (del JWT), body, status }) → 500 si falla
//   9. 201 { comment }

// ── CallerVerifier ────────────────────────────────────────────────────────────
// Verifica que el JWT pertenece a un usuario autenticado y devuelve user_id.
// Contrato idéntico al de update-lead-note/contact-agent (mismo patrón inline en index.ts,
// NO existe un _shared/caller_verifier.ts compartido en este repo).

export type CallerVerifyResult =
  | { ok: true; user_id: string }
  | { ok: false; error_code: "UNAUTHENTICATED" };

export interface CallerVerifier {
  verify_caller(authHeader: string | null): Promise<CallerVerifyResult>;
}

// ── PropertyFetcher ───────────────────────────────────────────────────────────
// Trae id+status de la propiedad. 'active' es el ÚNICO status que admite comentarios
// (ver ACTIVE_PROPERTY_STATUS en handler.ts) — valor real del enum property_status
// (20260809000002), el mismo que usa moderate-property para "propiedad visible".

export interface PropertyStatusSnapshot {
  id: string;
  status: string;
}

export type PropertyFetchResult =
  | { ok: true; property: PropertyStatusSnapshot }
  | { ok: false; error_code: "PROPERTY_NOT_FOUND" | "DB_ERROR"; message?: string };

export interface PropertyFetcher {
  fetch(property_id: string): Promise<PropertyFetchResult>;
}

// ── ConfigReader (comment_filter_words, app_config) ───────────────────────────
// Lee app_config.value donde key='comment_filter_words' (jsonb array de strings,
// migración semilla 20260910400001, GREEN). Fail-open documentado: SI la dependencia
// falta (deps.configReader undefined) O get_filter_words() rechaza, el handler usa []
// y el filtro base (teléfono/email/URL) sigue aplicando — NUNCA 500 por esto.

export interface ConfigReader {
  get_filter_words(): Promise<string[]>;
}

// ── CommentWriter ──────────────────────────────────────────────────────────────
// INSERT con service_role (comments no tiene policy de INSERT para authenticated,
// ver 20260910100001_comments.sql §5-6). status = el resultado de classify_comment.

export type CommentStatus = "visible" | "held_for_review";

export interface CommentWriteParams {
  property_id: string;
  user_id: string;
  body: string;
  status: CommentStatus;
}

export interface CommentRecord {
  id: string;
  property_id: string;
  user_id: string;
  body: string;
  status: CommentStatus;
  created_at: string;
}

export type CommentWriteResult =
  | { ok: true; comment: CommentRecord }
  | { ok: false; error_code: "DB_ERROR"; message?: string };

export interface CommentWriter {
  insert(params: CommentWriteParams): Promise<CommentWriteResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────
// configReader es OPCIONAL a propósito: "falta" es uno de los dos caminos fail-open.

export interface PostCommentDeps {
  callerVerifier: CallerVerifier;
  propertyFetcher: PropertyFetcher;
  configReader?: ConfigReader;
  commentWriter: CommentWriter;
}

// ── Input validado (en memoria, antes de tocar ninguna dependencia) ───────────

export interface PostCommentInput {
  property_id: string;
  body: string;
}

// ── Respuesta de éxito (contrato observable) ──────────────────────────────────

export interface PostCommentSuccessBody {
  comment: CommentRecord;
}
