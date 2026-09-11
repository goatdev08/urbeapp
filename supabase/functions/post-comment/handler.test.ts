// supabase/functions/post-comment/handler.test.ts
// Tests RED — subtarea 289.5 (tarea #289, PRD filtro determinista mínimo de comentarios).
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-env --allow-net supabase/functions/post-comment/handler.test.ts
//
// SEAM bajo test: el contrato HTTP público de POST /post-comment (request → status
// code → body), vía DI con fakes (patrón calcado de contact-agent/update-lead-note).
// handler.ts es un STUB que SIEMPRE LANZA `not_implemented` en fase RED — cada caso
// de abajo falla por la excepción no atrapada al hacer `await handler(...)` (no por
// import ni por tipos).
//
// Orden de orquestación fijado por este RED (ver types.ts, cabecera):
//   OPTIONS → método → JWT (callerVerifier) → parse body → validación en-memoria →
//   propertyFetcher → classify_comment(configReader) → commentWriter → 201
// (JWT ANTES del body, mismo orden que contact-agent — NO el de update-lead-note.)
//
// EDGE CASES (RED):
//
// ### CORS / Métodos HTTP
// - EC-1: OPTIONS → 200 con headers CORS
// - EC-2: GET → 405 METHOD_NOT_ALLOWED
// - EC-3: DELETE → 405 METHOD_NOT_ALLOWED
//
// ### Auth — verificado ANTES de tocar el body (orden fijado, como contact-agent)
// - EC-4: sin Authorization header → 401 UNAUTHENTICATED; propertyFetcher/commentWriter
//   NUNCA se llaman (assert de spy en 0)
// - EC-5: JWT inválido (callerVerifier → ok:false) → 401 UNAUTHENTICATED
// - EC-6: sin auth + body JSON inválido → 401 (auth gana; el body inválido nunca se evalúa)
//
// ### Body / parse (solo se llega aquí con JWT válido)
// - EC-7: JSON inválido → 400 INVALID_INPUT
// - EC-8: falta property_id → 400 INVALID_INPUT
// - EC-9: property_id no es UUID (formato) → 400 INVALID_INPUT
// - EC-10: falta body → 400 INVALID_INPUT
// - EC-11: body = "" (vacío) → 400 INVALID_INPUT
// - EC-12: body = "   " (solo espacios) → 400 INVALID_INPUT
// - EC-13: body = ">500 chars" (501 caracteres) → 400 INVALID_INPUT
// - EC-14: body en el límite exacto (500 chars) → NO 400 por longitud (pasa a
//   propertyFetcher — se verifica con propertyFetcher invocado, no con el 201 completo)
//
// ### Regla no obvia — body con espacios en los bordes se acepta SIN recortar
// - EC-15: body = "  hola vecino  " → 201, commentWriter.insert recibe el string
//   EXACTO " hola vecino " con los espacios de borde intactos (sin trim)
//
// ### Regla no obvia — user_id SIEMPRE del JWT, nunca del body
// - EC-16: body incluye user_id de otro usuario → commentWriter.insert recibe el
//   user_id del callerVerifier (JWT), NUNCA el del payload
//
// ### Propiedad
// - EC-17: propertyFetcher → PROPERTY_NOT_FOUND → 404 PROPERTY_NOT_FOUND
// - EC-18: propertyFetcher → property.status='paused' (no activa) → 409 PROPERTY_NOT_ACTIVE
// - EC-19: propertyFetcher → DB_ERROR → 500 DB_ERROR
//
// ### Filtro determinista — wiring del handler hacia classify_comment/commentWriter
// (usa el classify_comment REAL, no un fake — valida la integración end-to-end del
// seam HTTP; en RED classify.ts también lanza, así que estos casos fallan igual por
// excepción hasta que 289.5 GREEN implemente ambos archivos)
// - EC-20: body con teléfono ("Llámame al 33 1234 5678") → 201, comment.status
//   'held_for_review', commentWriter.insert recibe status:'held_for_review'
// - EC-21: body limpio ("Me encanta esta propiedad, muy bien ubicada") → 201,
//   comment.status 'visible'
// - EC-22: configReader.get_filter_words() resuelve una palabra prohibida y el body
//   la contiene → 201, comment.status 'held_for_review' (confirma que el handler
//   pasa el resultado de configReader a classify_comment)
//
// ### Fail-open de configReader (falla o falta → lista vacía, NUNCA 500 por esto)
// - EC-23: configReader.get_filter_words() rechaza (Promise.reject) → 201 (NO 500),
//   con body limpio → comment.status 'visible' (el filtro base sigue vivo, solo la
//   lista de palabras queda vacía)
// - EC-24: deps.configReader === undefined (falta la dependencia) → 201, mismo criterio
//
// ### DB failure en el insert → 500, sin PII en el mensaje de error
// - EC-25: commentWriter.insert → DB_ERROR → 500 DB_ERROR; el mensaje de error NO
//   contiene el texto del comentario (nada de PII del usuario en la respuesta)
//
// ### Happy path — forma exacta del body de éxito
// - EC-26: éxito → 201 { comment: { id, property_id, user_id, body, status,
//   created_at } } — valores tomados literal del fixture de commentWriter (fuente
//   independiente, no recomputados)

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  CommentRecord,
  CommentWriteParams,
  CommentWriteResult,
  CommentWriter,
  ConfigReader,
  PostCommentDeps,
  PropertyFetchResult,
  PropertyFetcher,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000001";
const OTRO_USUARIO_ID = "00000000-0000-0000-0000-000000000099";
const PROPERTY_ID = "00000000-0000-0000-0000-0000000000aa";

const PROPERTY_ACTIVA: PropertyFetchResult = {
  ok: true,
  property: { id: PROPERTY_ID, status: "active" },
};

const COMMENT_FIXTURE: CommentRecord = {
  id: "00000000-0000-0000-0000-0000000000cc",
  property_id: PROPERTY_ID,
  user_id: USER_ID,
  body: "Me encanta esta propiedad, muy bien ubicada",
  status: "visible",
  created_at: "2026-09-11T12:00:00.000Z",
};

// ── Fakes de dependencias ───────────────────────────────────────────────────────

function verifier_ok(user_id = USER_ID): CallerVerifier {
  return {
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      return Promise.resolve({ ok: true, user_id });
    },
  };
}

function verifier_unauthenticated(): CallerVerifier {
  return {
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  };
}

interface SpyPropertyFetcher extends PropertyFetcher {
  calls: string[];
}

function property_fetcher_stub(result: PropertyFetchResult): SpyPropertyFetcher {
  const calls: string[] = [];
  return {
    calls,
    fetch(property_id: string) {
      calls.push(property_id);
      return Promise.resolve(result);
    },
  };
}

interface SpyCommentWriter extends CommentWriter {
  calls: CommentWriteParams[];
}

function comment_writer_stub(result: CommentWriteResult): SpyCommentWriter {
  const calls: CommentWriteParams[] = [];
  return {
    calls,
    insert(params: CommentWriteParams) {
      calls.push(params);
      return Promise.resolve(result);
    },
  };
}

function comment_writer_echo(): SpyCommentWriter {
  const calls: CommentWriteParams[] = [];
  return {
    calls,
    insert(params: CommentWriteParams) {
      calls.push(params);
      return Promise.resolve({
        ok: true,
        comment: {
          id: COMMENT_FIXTURE.id,
          property_id: params.property_id,
          user_id: params.user_id,
          body: params.body,
          status: params.status,
          created_at: COMMENT_FIXTURE.created_at,
        },
      });
    },
  };
}

function config_reader_words(words: string[]): ConfigReader {
  return { get_filter_words: () => Promise.resolve(words) };
}

function config_reader_rejects(): ConfigReader {
  return { get_filter_words: () => Promise.reject(new Error("app_config caído")) };
}

function make_deps(overrides: Partial<PostCommentDeps> = {}): PostCommentDeps {
  return {
    callerVerifier: verifier_ok(),
    propertyFetcher: property_fetcher_stub(PROPERTY_ACTIVA),
    configReader: config_reader_words([]),
    commentWriter: comment_writer_stub({ ok: true, comment: COMMENT_FIXTURE }),
    ...overrides,
  };
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_auth(body: unknown): Request {
  return new Request("http://localhost/post-comment", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/post-comment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function post_auth_raw(rawBody: string): Request {
  return new Request("http://localhost/post-comment", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: rawBody,
  });
}

const PAYLOAD_VALIDO = { property_id: PROPERTY_ID, body: "Comentario válido de prueba" };

// ── EC-1/2/3: CORS / métodos ────────────────────────────────────────────────────

Deno.test("EC1_options_retorna_200_con_headers_cors", async () => {
  const req = new Request("http://localhost/post-comment", { method: "OPTIONS" });
  const res = await handler(req, make_deps());
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("EC2_get_retorna_405_method_not_allowed", async () => {
  const req = new Request("http://localhost/post-comment", { method: "GET" });
  const res = await handler(req, make_deps());
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error.code, "METHOD_NOT_ALLOWED");
});

Deno.test("EC3_delete_retorna_405_method_not_allowed", async () => {
  const req = new Request("http://localhost/post-comment", { method: "DELETE" });
  const res = await handler(req, make_deps());
  assertEquals(res.status, 405);
});

// ── EC-4/5/6: Auth ANTES del body ───────────────────────────────────────────────

Deno.test("EC4_sin_authorization_header_retorna_401_y_no_toca_property_ni_writer", async () => {
  const propertyFetcher = property_fetcher_stub(PROPERTY_ACTIVA);
  const commentWriter = comment_writer_stub({ ok: true, comment: COMMENT_FIXTURE });
  const res = await handler(
    post_sin_auth(PAYLOAD_VALIDO),
    make_deps({ callerVerifier: verifier_unauthenticated(), propertyFetcher, commentWriter }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(propertyFetcher.calls.length, 0);
  assertEquals(commentWriter.calls.length, 0);
});

Deno.test("EC5_jwt_invalido_retorna_401_unauthenticated", async () => {
  const res = await handler(
    post_auth(PAYLOAD_VALIDO),
    make_deps({ callerVerifier: verifier_unauthenticated() }),
  );
  assertEquals(res.status, 401);
});

Deno.test("EC6_sin_auth_con_body_invalido_retorna_401_no_400", async () => {
  const res = await handler(
    post_auth_raw("esto no es json{{{"),
    make_deps({ callerVerifier: verifier_unauthenticated() }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

// ── EC-7..14: validación del body ───────────────────────────────────────────────

Deno.test("EC7_json_invalido_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth_raw("{no-es-json"), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("EC8_falta_property_id_retorna_400", async () => {
  const res = await handler(post_auth({ body: "hola" }), make_deps());
  assertEquals(res.status, 400);
});

Deno.test("EC9_property_id_no_es_uuid_retorna_400", async () => {
  const res = await handler(
    post_auth({ property_id: "no-es-un-uuid", body: "hola vecino" }),
    make_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("EC10_falta_body_retorna_400", async () => {
  const res = await handler(post_auth({ property_id: PROPERTY_ID }), make_deps());
  assertEquals(res.status, 400);
});

Deno.test("EC11_body_vacio_retorna_400", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "" }),
    make_deps(),
  );
  assertEquals(res.status, 400);
});

Deno.test("EC12_body_solo_espacios_retorna_400", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "   " }),
    make_deps(),
  );
  assertEquals(res.status, 400);
});

Deno.test("EC13_body_mas_de_500_caracteres_retorna_400", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "a".repeat(501) }),
    make_deps(),
  );
  assertEquals(res.status, 400);
});

Deno.test("EC14_body_exactamente_500_caracteres_no_es_400_por_longitud", async () => {
  const propertyFetcher = property_fetcher_stub(PROPERTY_ACTIVA);
  await handler(
    post_auth({ property_id: PROPERTY_ID, body: "a".repeat(500) }),
    make_deps({ propertyFetcher }),
  );
  // Si el 400 fuera por longitud, propertyFetcher jamás se llamaría.
  assertEquals(propertyFetcher.calls.length, 1);
});

// ── EC-15: sin trim en los bordes ───────────────────────────────────────────────

Deno.test("EC15_body_con_espacios_de_borde_se_inserta_sin_recortar", async () => {
  const commentWriter = comment_writer_echo();
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "  hola vecino  " }),
    make_deps({ commentWriter }),
  );
  assertEquals(res.status, 201);
  assertEquals(commentWriter.calls[0].body, "  hola vecino  ");
});

// ── EC-16: user_id siempre del JWT ──────────────────────────────────────────────

Deno.test("EC16_user_id_del_body_se_ignora_se_usa_el_del_jwt", async () => {
  const commentWriter = comment_writer_echo();
  await handler(
    post_auth({
      property_id: PROPERTY_ID,
      body: "comentario normal",
      user_id: OTRO_USUARIO_ID,
    }),
    make_deps({ callerVerifier: verifier_ok(USER_ID), commentWriter }),
  );
  assertEquals(commentWriter.calls[0].user_id, USER_ID);
});

// ── EC-17/18/19: propiedad ───────────────────────────────────────────────────────

Deno.test("EC17_propiedad_no_encontrada_retorna_404", async () => {
  const res = await handler(
    post_auth(PAYLOAD_VALIDO),
    make_deps({
      propertyFetcher: property_fetcher_stub({ ok: false, error_code: "PROPERTY_NOT_FOUND" }),
    }),
  );
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "PROPERTY_NOT_FOUND");
});

Deno.test("EC18_propiedad_no_activa_retorna_409", async () => {
  const res = await handler(
    post_auth(PAYLOAD_VALIDO),
    make_deps({
      propertyFetcher: property_fetcher_stub({
        ok: true,
        property: { id: PROPERTY_ID, status: "paused" },
      }),
    }),
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "PROPERTY_NOT_ACTIVE");
});

Deno.test("EC19_property_fetcher_db_error_retorna_500", async () => {
  const res = await handler(
    post_auth(PAYLOAD_VALIDO),
    make_deps({
      propertyFetcher: property_fetcher_stub({ ok: false, error_code: "DB_ERROR" }),
    }),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
});

// ── EC-20/21/22: wiring del filtro determinista ─────────────────────────────────

Deno.test("EC20_body_con_telefono_termina_held_for_review", async () => {
  const commentWriter = comment_writer_echo();
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "Llámame al 33 1234 5678" }),
    make_deps({ commentWriter }),
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.comment.status, "held_for_review");
  assertEquals(commentWriter.calls[0].status, "held_for_review");
});

Deno.test("EC21_body_limpio_termina_visible", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "Me encanta esta propiedad, muy bien ubicada" }),
    make_deps(),
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.comment.status, "visible");
});

Deno.test("EC22_configReader_inyecta_palabra_prohibida_y_matchea", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "esto es una estafa" }),
    make_deps({ configReader: config_reader_words(["estafa"]) }),
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.comment.status, "held_for_review");
});

// ── EC-23/24: fail-open de configReader ─────────────────────────────────────────

Deno.test("EC23_configReader_que_rechaza_no_tumba_la_peticion_lista_vacia", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "Me encanta esta propiedad, muy bien ubicada" }),
    make_deps({ configReader: config_reader_rejects() }),
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.comment.status, "visible");
});

Deno.test("EC24_sin_configReader_en_deps_no_tumba_la_peticion", async () => {
  const deps = make_deps();
  delete (deps as { configReader?: ConfigReader }).configReader;
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: "Me encanta esta propiedad, muy bien ubicada" }),
    deps,
  );
  assertEquals(res.status, 201);
});

// ── EC-25: DB error en el insert, sin PII en el mensaje ─────────────────────────

Deno.test("EC25_comment_writer_db_error_retorna_500_sin_pii_del_comentario", async () => {
  const texto_privado = "mi domicilio exacto es calle secreta 123, no lo repitas";
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, body: texto_privado }),
    make_deps({
      commentWriter: comment_writer_stub({ ok: false, error_code: "DB_ERROR" }),
    }),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
  const raw = JSON.stringify(body);
  assertEquals(raw.includes(texto_privado), false);
});

// ── EC-26: forma exacta del éxito ────────────────────────────────────────────────

Deno.test("EC26_exito_retorna_201_con_la_forma_exacta_del_comentario", async () => {
  const commentWriter = comment_writer_stub({ ok: true, comment: COMMENT_FIXTURE });
  const res = await handler(post_auth(PAYLOAD_VALIDO), make_deps({ commentWriter }));
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body, { comment: COMMENT_FIXTURE });
});
