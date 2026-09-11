// supabase/functions/moderate-comment/types.ts
// Tipos y contratos DI para la Edge Function moderate-comment (subtarea 289.6,
// tarea #289, PRD comentarios/moderación). Solo interfaces + tipos; sin imports
// de supabase-js (eso vive en _shared/clients.ts / index.ts — patrón
// moderate-property/post-comment).
//
// Decisión de Abraham (ver prompt de la subtarea 289.6): EF NUEVA, NO extiende
// moderate-property (aunque la ESTRUCTURA se calca de ella: handler DI puro,
// parse→validate→auth→writer, mismo `_shared/response.ts`/`cors.ts`).
//
// Contrato HTTP (fijado en el RED, handler.test.ts lo verifica):
//   POST /moderate-comment, JWT de admin obligatorio.
//   Body: { comment_id: string (uuid); action: 'restore'|'keep_hidden'|'delete_comment';
//           reason?: string }
//   Éxito → 200 { ok: true, comment_id, action }.
//   Errores (mismo shape { error: { code, message } } de _shared/response.ts):
//     401 UNAUTHENTICATED — sin Authorization / JWT inválido (adminVerifier)
//     403 ADMIN_REQUIRED  — autenticado pero no-admin. 🔴 Código DISTINTO del
//                            'FORBIDDEN' que usa moderate-property: aquí se
//                            homologa con el literal que la RPC
//                            resolve_comment_reports_atomic (20260910200001)
//                            levanta vía RAISE ('ADMIN_REQUIRED', P0001) —
//                            mismo código tanto si lo detecta el adminVerifier
//                            en el borde de la EF como si lo detecta la RPC
//                            (defensa en profundidad, ver resolutionWriter
//                            abajo). Decisión del test-author, fijada en el RED.
//     400 INVALID_INPUT   — JSON inválido, comment_id no-uuid/ausente, action
//                            fuera del set {restore,keep_hidden,delete_comment},
//                            reason no-string/vacío-solo-espacios cuando se envía.
//     404 COMMENT_NOT_FOUND — mapeado desde el error COMMENT_NOT_FOUND de la RPC.
//     400 INVALID_ACTION  — mapeado desde el error INVALID_ACTION de la RPC
//                            (defensa en profundidad: el parseo local YA filtra
//                            acciones fuera del set con INVALID_INPUT; este
//                            código es DISTINTO y solo lo emite el mapeo del
//                            resolutionWriter, nunca el parser).
//     500 DB_ERROR        — resolutionWriter falla con cualquier otro código
//                            (incluido código desconocido) → mensaje GENÉRICO,
//                            NUNCA el `message` crudo del writer (puede traer
//                            detalle de Postgres con datos reales).
//     405 METHOD_NOT_ALLOWED — método distinto de POST/OPTIONS.
//
// Orden de orquestación (calco textual de moderate-property/handler.ts:
// CORS → método → parse JSON → validar payload en-memoria → adminVerifier →
// escritura). 🔴 SUPUESTO para GREEN, fijado aquí por el test-author: el
// parseo/validación del payload ocurre ANTES de verificar al caller — un
// payload inválido responde 400 SIN llamar a adminVerifier, igual que en
// moderate-property (NO es el orden de post-comment, que verifica el JWT
// primero). Ver EC "orden: payload inválido + sin Authorization → 400, nunca
// 401" en handler.test.ts.
//
// El JWT crudo del caller (header Authorization completo, con "Bearer ") viaja
// hasta el resolutionWriter como `admin_jwt` — la RPC resolve_comment_reports_atomic
// NO recibe p_admin_id (decisión (d) de la migración 20260910200001): el actor
// es SIEMPRE auth.uid(), así que la escritura real (GREEN) debe invocar la RPC
// con un cliente autenticado con ESE JWT (patrón `user_client(authHeader)` de
// _shared/clients.ts:153, NO `service_client()` + un p_admin_id como hace
// make_reports_resolution_writer para property). Fijado aquí como el contrato
// que GREEN debe cumplir; el adminVerifier (que SÍ usa service_role para leer
// public.users.role) es un chequeo de UX/fail-fast en el borde de la EF —
// la RPC vuelve a verificar `private.is_admin()` de forma independiente.

// ── Payload ────────────────────────────────────────────────────────────────────

export type CommentModerationAction = "restore" | "keep_hidden" | "delete_comment";

export interface ModerateCommentInput {
  comment_id: string;
  action: CommentModerationAction;
  reason?: string;
}

// ── CommentResolutionWriter ───────────────────────────────────────────────────
// UNA llamada a resolve_comment_reports_atomic (20260910200001): guard de admin
// + guard de acción + guard de origen (status='hidden', no-op si no) + transición
// + cierre de comment_reports + admin_actions, todo en la MISMA transacción.
// admin_jwt = el header Authorization COMPLETO del caller (con "Bearer "),
// reenviado tal cual a user_client() en el adaptador real — NUNCA se decodifica
// ni se valida aquí, solo se reenvía.

export interface CommentResolutionWriteParams {
  comment_id: string;
  action: CommentModerationAction;
  reason: string | null;
  admin_jwt: string;
}

export type CommentResolutionErrorCode =
  | "ADMIN_REQUIRED"
  | "COMMENT_NOT_FOUND"
  | "INVALID_ACTION"
  | "DB_ERROR";

export type CommentResolutionWriteResult =
  | { ok: true }
  | { ok: false; error_code: CommentResolutionErrorCode; message?: string };

export interface CommentResolutionWriter {
  resolve(
    params: CommentResolutionWriteParams,
  ): Promise<CommentResolutionWriteResult>;
}

// ── Deps inyectables del handler ──────────────────────────────────────────────

export interface ModerateCommentDeps {
  adminVerifier: import("../_shared/admin_auth.ts").AdminVerifier;
  resolutionWriter: CommentResolutionWriter;
}

// ── Respuesta de éxito (contrato observable) ───────────────────────────────────

export interface ModerateCommentSuccessBody {
  ok: true;
  comment_id: string;
  action: CommentModerationAction;
}
