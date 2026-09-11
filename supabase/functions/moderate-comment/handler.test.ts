// supabase/functions/moderate-comment/handler.test.ts
//
// Tests RED — subtarea 289.6 (moderación de comentarios: EF moderate-comment,
// tarea #289). SEAM bajo test: el contrato HTTP de handler.ts (request → status
// + body) vía DI — ninguna de estas fakes toca Postgres real. handler.ts es un
// STUB que SIEMPRE lanza `not_implemented` (fase RED): TODOS los tests de abajo
// fallan por EXCEPCIÓN, nunca por import/compilación (deno test type-checkea
// por defecto y esto compila limpio contra types.ts, ya GREEN de types en este
// mismo commit RED).
//
// Framework: Deno.test + @std/assert (nativo Deno), mismo patrón que
// moderate-property/handler.test.ts y report_resolution.test.ts.
// Runner: deno test --allow-env --allow-net moderate-comment/
//
// ════════════════════════════════════════════════════════════════════════════
// DECISIONES fijadas por el test-author (ver también types.ts, cabecera):
//   - Orden de orquestación: OPTIONS → método → parse JSON → validar payload
//     en-memoria → adminVerifier.verify_caller → resolutionWriter.resolve
//     (calco de moderate-property: el payload se valida ANTES de verificar al
//     caller — un payload inválido responde 400 SIN llamar a adminVerifier).
//   - adminVerifier reusado de ../_shared/admin_auth.ts (AdminVerifier), MISMO
//     verificador que moderate-property. Su error_code 'FORBIDDEN' se REMAPEA
//     al código de respuesta 'ADMIN_REQUIRED' (homologado con el literal que
//     levanta la RPC resolve_comment_reports_atomic) — 'UNAUTHENTICATED' pasa
//     tal cual.
//   - resolutionWriter recibe SIEMPRE { comment_id, action, reason, admin_jwt }
//     — admin_jwt es el header Authorization COMPLETO ("Bearer …"), reenviado
//     tal cual (nunca decodificado en el handler).
//   - Mapeo de errores del resolutionWriter: ADMIN_REQUIRED→403 ADMIN_REQUIRED,
//     COMMENT_NOT_FOUND→404 COMMENT_NOT_FOUND, INVALID_ACTION→400 INVALID_ACTION,
//     cualquier otro código (incluido DB_ERROR)→500 DB_ERROR con mensaje
//     GENÉRICO — el `message` crudo del writer NUNCA se refleja en la respuesta
//     (puede traer detalle de Postgres con datos reales, criterio EC25 de
//     post-comment/handler.ts aplicado aquí).
//   - comment_id se valida con el mismo UUID_REGEX manual (8-4-4-4-12 hex,
//     case-insensitive) que contact-agent/post-comment — sin Zod.
//   - reason es OPCIONAL: ausente → resolutionWriter recibe `reason: null`
//     (nunca `undefined`); si se envía, debe ser string no vacía/no-solo-espacios.
//
// ════════════════════════════════════════════════════════════════════════════
// EDGE CASES (RED) — 289.6:
//
// ### Happy path — 3 acciones
// - (EC-1) restore → 200 {ok:true, comment_id, action:'restore'}, resolutionWriter
//   llamado con {comment_id, action:'restore', reason, admin_jwt}
// - (EC-2) keep_hidden → 200 {ok:true, comment_id, action:'keep_hidden'}
// - (EC-3) delete_comment → 200 {ok:true, comment_id, action:'delete_comment'}
// - (EC-4) reason ausente → resolutionWriter recibe reason:null
// - (EC-5) reason presente → resolutionWriter recibe el string tal cual
// - (EC-6) admin_jwt reenviado = el header Authorization COMPLETO ("Bearer …"),
//   no solo el token pelado
//
// ### CORS / método
// - (EC-7) OPTIONS → 200 + headers CORS, resolutionWriter/adminVerifier NUNCA
// - (EC-8) GET → 405 METHOD_NOT_ALLOWED, resolutionWriter/adminVerifier NUNCA
//
// ### Auth (adminVerifier)
// - (EC-9) sin Authorization header → 401 UNAUTHENTICATED, resolutionWriter nunca
// - (EC-10) adminVerifier FORBIDDEN (no-admin) → 403 ADMIN_REQUIRED (código
//   REMAPEADO, no 'FORBIDDEN'), resolutionWriter nunca
//
// ### Boundary / error de payload (400 INVALID_INPUT) — todos ANTES de adminVerifier
// - (EC-11) JSON inválido → 400 INVALID_INPUT, adminVerifier NUNCA llamado
// - (EC-12) comment_id ausente → 400 INVALID_INPUT
// - (EC-13) comment_id no-uuid ('abc') → 400 INVALID_INPUT
// - (EC-14) comment_id no-string (number) → 400 INVALID_INPUT
// - (EC-15) action fuera del set ('approve', del vocabulario de moderate-property
//   pero ajeno aquí) → 400 INVALID_INPUT
// - (EC-16) action ausente → 400 INVALID_INPUT
// - (EC-17) reason no-string (number) → 400 INVALID_INPUT
// - (EC-18) reason vacío/solo-espacios → 400 INVALID_INPUT
// - (EC-19) body no-objeto (array JSON) → 400 INVALID_INPUT
// - (EC-20) orden: payload inválido + SIN Authorization → 400 INVALID_INPUT
//   (nunca 401 — el parseo gana), adminVerifier NUNCA llamado
// - (EC-21) comment_id UUID en MAYÚSCULAS → aceptado (case-insensitive, mismo
//   criterio que post-comment/contact-agent), 200
//
// ### Mapeo de errores del resolutionWriter (defensa en profundidad tras el
//     adminVerifier ya OK — la RPC vuelve a verificar de forma independiente)
// - (EC-22) resolutionWriter ADMIN_REQUIRED → 403 ADMIN_REQUIRED
// - (EC-23) resolutionWriter COMMENT_NOT_FOUND → 404 COMMENT_NOT_FOUND
// - (EC-24) resolutionWriter INVALID_ACTION → 400 INVALID_ACTION (código
//   DISTINTO de INVALID_INPUT — solo lo emite este mapeo, nunca el parser)
// - (EC-25) resolutionWriter DB_ERROR → 500 DB_ERROR, mensaje GENÉRICO (nunca
//   el `message` crudo del writer, puede traer datos reales)
// - (EC-26) resolutionWriter con código DESCONOCIDO (no está en el mapa) →
//   500 DB_ERROR igual (fail-closed, nunca un 2xx ni un código sin mapear)
// ════════════════════════════════════════════════════════════════════════════

import { assertEquals, assertNotEquals } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CommentModerationAction,
  CommentResolutionErrorCode,
  CommentResolutionWriteParams,
  CommentResolutionWriteResult,
  CommentResolutionWriter,
  ModerateCommentDeps,
} from "./types.ts";
import type { AdminVerifier, AdminVerifyResult } from "../_shared/admin_auth.ts";

// ── Constantes ───────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const COMMENT_ID = "00000000-0000-0000-0000-0000000000c1";
const AUTH_HEADER = "Bearer admin.jwt.token";

// ── Fakes — AdminVerifier (mismo contrato que ../_shared/admin_auth.ts) ───────

interface FakeVerifier extends AdminVerifier {
  calls: (string | null)[];
}

function verifier_admin_ok(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<AdminVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id: ADMIN_ID });
    },
  } as FakeVerifier;
}

function verifier_unauthenticated(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<AdminVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeVerifier;
}

function verifier_forbidden(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<AdminVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "FORBIDDEN" });
    },
  } as FakeVerifier;
}

// ── Fakes — CommentResolutionWriter ───────────────────────────────────────────

interface FakeWriter extends CommentResolutionWriter {
  calls: CommentResolutionWriteParams[];
}

function writer_ok(): FakeWriter {
  return {
    calls: [],
    resolve(
      params: CommentResolutionWriteParams,
    ): Promise<CommentResolutionWriteResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true });
    },
  } as FakeWriter;
}

function writer_error(
  error_code: CommentResolutionErrorCode,
  message = "detalle interno con posible PII: fila 42, usuario x@correo.com",
): FakeWriter {
  return {
    calls: [],
    resolve(
      params: CommentResolutionWriteParams,
    ): Promise<CommentResolutionWriteResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code, message });
    },
  } as FakeWriter;
}

// Código deliberadamente FUERA del union `CommentResolutionErrorCode` — simula
// que la RPC devuelve algo no contemplado por el mapa de errores (fail-closed).
function writer_unknown_error(): FakeWriter {
  return {
    calls: [],
    resolve(
      params: CommentResolutionWriteParams,
    ): Promise<CommentResolutionWriteResult> {
      this.calls.push(params);
      return Promise.resolve({
        ok: false,
        error_code: "SOME_UNMAPPED_CODE" as CommentResolutionErrorCode,
        message: "boom",
      });
    },
  } as FakeWriter;
}

// ── Helpers de request ─────────────────────────────────────────────────────────

function make_request(
  method: string,
  body?: unknown,
  authHeader: string | null = AUTH_HEADER,
): Request {
  const headers = new Headers();
  if (authHeader !== null) headers.set("Authorization", authHeader);
  if (body !== undefined) headers.set("Content-Type", "application/json");
  return new Request("https://x.test/moderate-comment", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function make_invalid_json_request(authHeader: string | null = AUTH_HEADER): Request {
  const headers = new Headers();
  if (authHeader !== null) headers.set("Authorization", authHeader);
  headers.set("Content-Type", "application/json");
  return new Request("https://x.test/moderate-comment", {
    method: "POST",
    headers,
    body: "{ esto no es json válido",
  });
}

function payload(
  action: string,
  reason?: string,
  comment_id: string = COMMENT_ID,
) {
  const p: Record<string, unknown> = { comment_id, action };
  if (reason !== undefined) p.reason = reason;
  return p;
}

interface Deps extends ModerateCommentDeps {
  adminVerifier: FakeVerifier;
  resolutionWriter: FakeWriter;
}

function build_deps(overrides: Partial<Deps> = {}): Deps {
  return {
    adminVerifier: verifier_admin_ok(),
    resolutionWriter: writer_ok(),
    ...overrides,
  };
}

const ACTIONS: CommentModerationAction[] = ["restore", "keep_hidden", "delete_comment"];

// ════════════════════════════════════════════════════════════════════════════
// Happy path
// ════════════════════════════════════════════════════════════════════════════

for (const action of ACTIONS) {
  Deno.test(`(EC-1/2/3) ${action}: 200 {ok:true, comment_id, action}, resolutionWriter llamado con el contrato exacto`, async () => {
    const deps = build_deps();
    const res = await handler(
      make_request("POST", payload(action, "Contenido revisado")),
      deps,
    );

    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body, { ok: true, comment_id: COMMENT_ID, action });

    assertEquals(deps.resolutionWriter.calls, [
      {
        comment_id: COMMENT_ID,
        action,
        reason: "Contenido revisado",
        admin_jwt: AUTH_HEADER,
      },
    ]);
  });
}

Deno.test("(EC-4) restore sin reason → resolutionWriter recibe reason:null (nunca undefined)", async () => {
  const deps = build_deps();
  const res = await handler(make_request("POST", payload("restore")), deps);

  assertEquals(res.status, 200);
  assertEquals(deps.resolutionWriter.calls, [
    {
      comment_id: COMMENT_ID,
      action: "restore",
      reason: null,
      admin_jwt: AUTH_HEADER,
    },
  ]);
});

Deno.test("(EC-5) delete_comment con reason → resolutionWriter recibe el string tal cual", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", payload("delete_comment", "Spam confirmado")),
    deps,
  );

  assertEquals(res.status, 200);
  assertEquals(deps.resolutionWriter.calls[0]?.reason, "Spam confirmado");
});

Deno.test("(EC-6) admin_jwt reenviado es el header Authorization COMPLETO ('Bearer …'), no el token pelado", async () => {
  const deps = build_deps();
  await handler(
    make_request("POST", payload("keep_hidden"), "Bearer un.jwt.distinto"),
    deps,
  );

  assertEquals(deps.resolutionWriter.calls[0]?.admin_jwt, "Bearer un.jwt.distinto");
  assertNotEquals(deps.resolutionWriter.calls[0]?.admin_jwt, "un.jwt.distinto");
});

// ════════════════════════════════════════════════════════════════════════════
// CORS / método
// ════════════════════════════════════════════════════════════════════════════

Deno.test("(EC-7) OPTIONS → 200 con headers CORS, resolutionWriter/adminVerifier NUNCA se llaman", async () => {
  const deps = build_deps();
  const res = await handler(make_request("OPTIONS"), deps);

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(deps.adminVerifier.calls, []);
  assertEquals(deps.resolutionWriter.calls, []);
});

Deno.test("(EC-8) GET → 405 METHOD_NOT_ALLOWED, resolutionWriter/adminVerifier NUNCA se llaman", async () => {
  const deps = build_deps();
  const res = await handler(make_request("GET"), deps);

  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error.code, "METHOD_NOT_ALLOWED");
  assertEquals(deps.adminVerifier.calls, []);
  assertEquals(deps.resolutionWriter.calls, []);
});

// ════════════════════════════════════════════════════════════════════════════
// Auth (adminVerifier)
// ════════════════════════════════════════════════════════════════════════════

Deno.test("(EC-9) sin Authorization header → 401 UNAUTHENTICATED, resolutionWriter nunca se llama", async () => {
  const deps = build_deps({ adminVerifier: verifier_unauthenticated() });
  const res = await handler(make_request("POST", payload("restore"), null), deps);

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(deps.resolutionWriter.calls, []);
});

Deno.test("(EC-10) adminVerifier FORBIDDEN (no-admin) → 403 ADMIN_REQUIRED (código REMAPEADO), resolutionWriter nunca se llama", async () => {
  const deps = build_deps({ adminVerifier: verifier_forbidden() });
  const res = await handler(make_request("POST", payload("restore")), deps);

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "ADMIN_REQUIRED");
  assertNotEquals(body.error.code, "FORBIDDEN");
  assertEquals(deps.resolutionWriter.calls, []);
});

// ════════════════════════════════════════════════════════════════════════════
// Boundary / error de payload (400 INVALID_INPUT) — SIEMPRE antes del adminVerifier
// ════════════════════════════════════════════════════════════════════════════

Deno.test("(EC-11) JSON inválido → 400 INVALID_INPUT, adminVerifier NUNCA llamado", async () => {
  const deps = build_deps();
  const res = await handler(make_invalid_json_request(), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
  assertEquals(deps.adminVerifier.calls, []);
});

Deno.test("(EC-12) comment_id ausente → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", { action: "restore" }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-13) comment_id no-uuid ('abc') → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(make_request("POST", payload("restore", undefined, "abc")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-14) comment_id no-string (number) → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", { comment_id: 12345, action: "restore" }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-15) action fuera del set ('approve', vocabulario ajeno de moderate-property) → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(make_request("POST", payload("approve")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
  assertEquals(deps.resolutionWriter.calls, []);
});

Deno.test("(EC-16) action ausente → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", { comment_id: COMMENT_ID }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-17) reason no-string (number) → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", { comment_id: COMMENT_ID, action: "restore", reason: 42 }),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-18) reason vacío/solo-espacios → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(make_request("POST", payload("restore", "   ")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-19) body no-objeto (array JSON) → 400 INVALID_INPUT", async () => {
  const deps = build_deps();
  const res = await handler(make_request("POST", [1, 2, 3]), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-20) payload inválido + SIN Authorization → 400 INVALID_INPUT (el parseo gana, nunca 401), adminVerifier NUNCA llamado", async () => {
  const deps = build_deps();
  const res = await handler(
    make_request("POST", { comment_id: "no-es-uuid", action: "restore" }, null),
    deps,
  );

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
  assertEquals(deps.adminVerifier.calls, []);
});

Deno.test("(EC-21) comment_id UUID en MAYÚSCULAS → aceptado (case-insensitive), 200", async () => {
  const deps = build_deps();
  const upper = COMMENT_ID.toUpperCase();
  const res = await handler(make_request("POST", payload("restore", undefined, upper)), deps);

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.comment_id, upper);
});

// ════════════════════════════════════════════════════════════════════════════
// Mapeo de errores del resolutionWriter (defensa en profundidad)
// ════════════════════════════════════════════════════════════════════════════

Deno.test("(EC-22) resolutionWriter ADMIN_REQUIRED → 403 ADMIN_REQUIRED", async () => {
  const deps = build_deps({ resolutionWriter: writer_error("ADMIN_REQUIRED") });
  const res = await handler(make_request("POST", payload("restore")), deps);

  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "ADMIN_REQUIRED");
});

Deno.test("(EC-23) resolutionWriter COMMENT_NOT_FOUND → 404 COMMENT_NOT_FOUND", async () => {
  const deps = build_deps({ resolutionWriter: writer_error("COMMENT_NOT_FOUND") });
  const res = await handler(make_request("POST", payload("restore")), deps);

  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "COMMENT_NOT_FOUND");
});

Deno.test("(EC-24) resolutionWriter INVALID_ACTION → 400 INVALID_ACTION (código DISTINTO de INVALID_INPUT)", async () => {
  const deps = build_deps({ resolutionWriter: writer_error("INVALID_ACTION") });
  const res = await handler(make_request("POST", payload("restore")), deps);

  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_ACTION");
  assertNotEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("(EC-25) resolutionWriter DB_ERROR → 500 DB_ERROR con mensaje GENÉRICO (nunca el message crudo del writer)", async () => {
  const leaky_message = "detalle interno con posible PII: fila 42, usuario x@correo.com";
  const deps = build_deps({ resolutionWriter: writer_error("DB_ERROR", leaky_message) });
  const res = await handler(make_request("POST", payload("restore")), deps);

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  assertNotEquals(body.error.message, leaky_message);
  assertEquals(body.error.message.includes("x@correo.com"), false);
});

Deno.test("(EC-26) resolutionWriter con código DESCONOCIDO (fuera del mapa) → 500 DB_ERROR (fail-closed, nunca un 2xx)", async () => {
  const deps = build_deps({ resolutionWriter: writer_unknown_error() });
  const res = await handler(make_request("POST", payload("restore")), deps);

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
});
