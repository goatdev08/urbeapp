// supabase/functions/contact-agent/handler.test.ts
// Tests RED — subtarea 14.2
// Edge Function: contact-agent/handler.ts (skeleton: CORS + auth + validación de input)
// Framework: Deno.test + @std/assert
// Runner: deno test supabase/functions/contact-agent/handler.test.ts
//         (desde el repo raíz, con deno.json en supabase/functions/)
//
// EDGE CASES (RED) — 14.2:
//
// ### Happy path
// - POST + JWT válido + propertyId UUID válido → 200 con { ok: true }
// - Respuesta tiene body.ok === true (shape del placeholder 14.2)
// - Auth resolver llamado exactamente una vez en happy path
// - Auth resolver recibe el header Authorization exacto del request
//
// ### CORS / métodos HTTP
// - OPTIONS → 200-204 con header Access-Control-Allow-Origin
// - OPTIONS → header Access-Control-Allow-Methods presente
// - GET → 405
// - PUT → 405
//
// ### Auth → 401 UNAUTHENTICATED (verificado ANTES del body/input — orden (b) precede a (c))
// - POST sin Authorization header → 401 UNAUTHENTICATED
// - POST con JWT inválido (verifier rechaza) → 401 UNAUTHENTICATED
// - POST sin auth + input inválido → 401 (auth gana; validación de input no se ejecuta)
// - 401 tiene la forma { error: { code: string, message: string } }
//
// ### Validación de input → 400 INVALID_INPUT (solo si auth ok)
// - POST + JWT válido + payload vacío {} → 400 INVALID_INPUT (propertyId ausente)
// - POST + JWT válido + propertyId tipo número → 400 INVALID_INPUT (no string)
// - POST + JWT válido + propertyId cadena vacía → 400 INVALID_INPUT
// - POST + JWT válido + propertyId = "no-es-uuid" → 400 INVALID_INPUT (no formato UUID)
// - POST + JWT válido + propertyId demasiado corto (35 chars, no UUID completo) → 400 INVALID_INPUT
// - POST + JWT válido + propertyId = null → 400 INVALID_INPUT
// - POST + body no-JSON + JWT válido → 400 INVALID_INPUT
// - 400 tiene la forma { error: { code: string, message: string } }

import { assertEquals, assertExists } from "@std/assert";
import { make_contact_agent_handler } from "./handler.ts";
import type { CallerVerifier, CallerVerifyResult, ContactAgentDeps } from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000001";
// UUID válido (8-4-4-4-12 hexadecimal, case-insensitive)
const PROPERTY_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// ── Factories de fakes — CallerVerifier ───────────────────────────────────────

interface FakeCallerVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = USER_ID): FakeCallerVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id });
    },
  } as FakeCallerVerifier;
}

function verifier_unauthenticated(): FakeCallerVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeCallerVerifier;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_auth(body: unknown): Request {
  return new Request("http://localhost/contact-agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-valid-jwt",
    },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/contact-agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/contact-agent", { method });
}

// ── Factory helper ────────────────────────────────────────────────────────────

function make_handler(
  verifier: CallerVerifier = verifier_ok(),
): (req: Request) => Promise<Response> {
  const deps: ContactAgentDeps = { callerVerifier: verifier };
  return make_contact_agent_handler(deps);
}

// ── Payload base ──────────────────────────────────────────────────────────────

const PAYLOAD_VALIDO = { propertyId: PROPERTY_ID };

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_post_jwt_valido_uuid_valido_retorna_200", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_respuesta_contiene_ok_true", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.ok, true, "placeholder 14.2 debe devolver { ok: true }");
});

Deno.test("happy_path_auth_resolver_llamado_exactamente_una_vez", async () => {
  const v = verifier_ok();
  const h = make_handler(v);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(v.calls.length, 1, "auth resolver debe llamarse exactamente una vez en happy path");
});

Deno.test("happy_path_auth_resolver_recibe_authorization_header", async () => {
  const v = verifier_ok();
  const h = make_handler(v);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    v.calls[0],
    "Bearer fake-valid-jwt",
    "auth resolver debe recibir el header Authorization completo, no solo el token",
  );
});

// ── CORS / Métodos HTTP ───────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(method_request("OPTIONS"));
  assertEquals(
    res.status >= 200 && res.status <= 204,
    true,
    "OPTIONS debe retornar 200-204 (CORS preflight)",
  );
});

Deno.test("cors_options_tiene_header_access_control_allow_origin", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Preflight OPTIONS debe incluir header Access-Control-Allow-Origin",
  );
});

Deno.test("cors_options_tiene_header_access_control_allow_methods", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Methods"),
    "Preflight OPTIONS debe incluir header Access-Control-Allow-Methods",
  );
});

Deno.test("metodo_get_retorna_405", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(method_request("GET"));
  assertEquals(res.status, 405);
});

Deno.test("metodo_put_retorna_405", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(method_request("PUT"));
  assertEquals(res.status, 405);
});

// ── Auth → 401 UNAUTHENTICATED (verificado ANTES del input) ──────────────────
// El handler verifica JWT (b) antes de parsear/validar el body (c).
// Esto protege el endpoint: sin autenticación, no hay trabajo de parsing.

Deno.test("sin_authorization_header_retorna_401_unauthenticated", async () => {
  const v = verifier_unauthenticated();
  const h = make_handler(v);
  const res = await h(post_sin_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_retorna_401_unauthenticated", async () => {
  const v = verifier_unauthenticated();
  const h = make_handler(v);
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("sin_auth_con_input_invalido_retorna_401_no_400", async () => {
  // Auth (b) se chequea ANTES que input (c): 401 gana aunque el input también sea inválido.
  // Si este test falla con 400, significa que input se validó antes de auth — orden incorrecto.
  const v = verifier_unauthenticated();
  const h = make_handler(v);
  const res = await h(post_sin_auth({ propertyId: "no-es-uuid" }));
  assertEquals(res.status, 401, "401 debe ganar: auth se verifica antes que el input");
});

Deno.test("respuesta_401_tiene_forma_error_code_message", async () => {
  const v = verifier_unauthenticated();
  const h = make_handler(v);
  const res = await h(post_sin_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error, "respuesta 401 debe contener 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});

// ── Validación de input → 400 INVALID_INPUT (solo si auth ok) ────────────────

Deno.test("payload_vacio_retorna_400_invalid_input", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth({}));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_tipo_numero_retorna_400_invalid_input", async () => {
  // propertyId debe ser string; un número (aunque tenga el valor correcto) es inválido
  const h = make_handler(verifier_ok());
  const res = await h(post_auth({ propertyId: 123 }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_cadena_vacia_retorna_400_invalid_input", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth({ propertyId: "" }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_no_es_uuid_retorna_400_invalid_input", async () => {
  // String con formato incorrecto para UUID (guiones en posición incorrecta)
  const h = make_handler(verifier_ok());
  const res = await h(post_auth({ propertyId: "no-es-uuid" }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_demasiado_corto_retorna_400_invalid_input", async () => {
  // 35 chars — UUID válido tiene 36 chars (8-4-4-4-12 con guiones)
  const h = make_handler(verifier_ok());
  const res = await h(post_auth({ propertyId: "00000000-0000-0000-0000-00000000000" }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_null_retorna_400_invalid_input", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth({ propertyId: null }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const req = new Request("http://localhost/contact-agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-valid-jwt",
    },
    body: "esto no es json{{{",
  });
  const h = make_handler(verifier_ok());
  const res = await h(req);
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("respuesta_400_tiene_forma_error_code_message", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth({}));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error, "respuesta 400 debe contener 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});
