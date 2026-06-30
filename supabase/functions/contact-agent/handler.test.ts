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
import type {
  CallerVerifier,
  CallerVerifyResult,
  ContactAgentDeps,
  PropertyResolver,
  PropertyResolveResult,
  PropertyWithAgent,
} from "./types.ts";

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

// ── 14.3 — Constantes de agente ──────────────────────────────────────────────

const AGENT_ID = "00000000-0000-0000-0000-000000000002";
const AGENT_PHONE = "+5215512345678";

// ── 14.3 — PropertyWithAgent factory ─────────────────────────────────────────

function make_property_with_agent(
  overrides: Partial<PropertyWithAgent> = {},
): PropertyWithAgent {
  return {
    id: PROPERTY_ID,
    address: "Av. Insurgentes Sur 1234, Col. Del Valle, CDMX",
    price: 2_000_000, // MXN $2,000,000.00
    status: "active",
    owner_user_id: USER_ID,
    agent_id: AGENT_ID,
    agent_phone: AGENT_PHONE,
    ...overrides,
  };
}

// ── 14.3 — FakePropertyResolver factories ────────────────────────────────────

interface FakePropertyResolver extends PropertyResolver {
  calls: string[];
}

function resolver_property_found(
  property: PropertyWithAgent = make_property_with_agent(),
): FakePropertyResolver {
  return {
    calls: [],
    resolve(propertyId: string): Promise<PropertyResolveResult> {
      this.calls.push(propertyId);
      return Promise.resolve({ ok: true, data: property });
    },
  } as FakePropertyResolver;
}

function resolver_property_not_found(): FakePropertyResolver {
  return {
    calls: [],
    resolve(propertyId: string): Promise<PropertyResolveResult> {
      this.calls.push(propertyId);
      return Promise.resolve({ ok: false, error_code: "PROPERTY_NOT_FOUND" });
    },
  } as FakePropertyResolver;
}

function resolver_db_error(): FakePropertyResolver {
  return {
    calls: [],
    resolve(propertyId: string): Promise<PropertyResolveResult> {
      this.calls.push(propertyId);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR" });
    },
  } as FakePropertyResolver;
}

// ── Factory helper ────────────────────────────────────────────────────────────
//
// Segundo parámetro (14.3+): propertyResolver con default happy → los 21 tests de
// 14.2 no necesitan cambiarse (el handler aún no llama al resolver en el stub).

function make_handler(
  verifier: CallerVerifier = verifier_ok(),
  resolver: PropertyResolver = resolver_property_found(),
): (req: Request) => Promise<Response> {
  const deps: ContactAgentDeps = {
    callerVerifier: verifier,
    propertyResolver: resolver,
  };
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

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS 14.3 — Property + Agent retrieval con validación
//
// EDGE CASES:
// ### Happy path
// - Resolver llamado exactamente una vez con el propertyId del input
// ### Propiedad no encontrada → 404 NOT_FOUND
// - Resolver devuelve PROPERTY_NOT_FOUND → 404
// - body.error.code === "NOT_FOUND"
// ### Propiedad inactiva → 400 INVALID_PROPERTY_STATE
// - status 'draft' → 400
// - status 'paused' → 400
// - status 'closed' → 400
// - body.error.code === "INVALID_PROPERTY_STATE"
// ### Agente sin teléfono → 400 AGENT_PHONE_MISSING (invariante de contactabilidad)
// - agent_phone NULL → 400
// - agent_phone cadena vacía → 400
// - body.error.code === "AGENT_PHONE_MISSING"
// ### Boundary / error
// - Resolver devuelve DB_ERROR → 500
// ═══════════════════════════════════════════════════════════════════════════════

// ── Happy path 14.3 ──────────────────────────────────────────────────────────

Deno.test("happy_14_3_resolver_llamado_con_property_id_correcto", async () => {
  // El handler debe pasar el propertyId del input al resolver, no otro valor.
  // En RED: el handler aún no llama al resolver → resolver.calls.length === 0 → FALLA.
  const resolver = resolver_property_found(make_property_with_agent());
  const h = make_handler(verifier_ok(), resolver);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    resolver.calls.length,
    1,
    "propertyResolver.resolve() debe llamarse exactamente una vez en happy path",
  );
  assertEquals(
    resolver.calls[0],
    PROPERTY_ID,
    "propertyResolver.resolve() debe recibir el propertyId exacto del input",
  );
});

// ── Propiedad no encontrada → 404 NOT_FOUND ──────────────────────────────────

Deno.test("propiedad_no_encontrada_retorna_404", async () => {
  // Resolver devuelve PROPERTY_NOT_FOUND → handler debe responder 404.
  // En RED: handler devuelve 200 (placeholder) → FALLA.
  const h = make_handler(verifier_ok(), resolver_property_not_found());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 404, "propiedad inexistente debe devolver 404");
});

Deno.test("propiedad_no_encontrada_body_code_not_found", async () => {
  // El cuerpo del 404 debe incluir error.code === "NOT_FOUND".
  // En RED: handler devuelve { ok: true } → FALLA al buscar body.error.
  const h = make_handler(verifier_ok(), resolver_property_not_found());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  const body = await res.json();
  assertExists(body.error, "respuesta de propiedad no encontrada debe tener campo 'error'");
  assertEquals(
    body.error.code,
    "NOT_FOUND",
    "error.code debe ser 'NOT_FOUND' para propiedad inexistente",
  );
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});

// ── Propiedad inactiva → 400 INVALID_PROPERTY_STATE ──────────────────────────

Deno.test("propiedad_status_draft_retorna_400_invalid_property_state", async () => {
  // Una propiedad en borrador no puede ser contactada.
  // En RED: handler devuelve 200 (no valida status) → FALLA.
  const prop = make_property_with_agent({ status: "draft" });
  const h = make_handler(verifier_ok(), resolver_property_found(prop));
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 400, "propiedad 'draft' debe devolver 400");
});

Deno.test("propiedad_status_paused_retorna_400_invalid_property_state", async () => {
  // Propiedad pausada por el agente — no contactable.
  const prop = make_property_with_agent({ status: "paused" });
  const h = make_handler(verifier_ok(), resolver_property_found(prop));
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 400, "propiedad 'paused' debe devolver 400");
});

Deno.test("propiedad_status_closed_retorna_400_invalid_property_state", async () => {
  // Propiedad cerrada (rentada/vendida/retirada) — no contactable.
  const prop = make_property_with_agent({ status: "closed" });
  const h = make_handler(verifier_ok(), resolver_property_found(prop));
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 400, "propiedad 'closed' debe devolver 400");
});

Deno.test("propiedad_inactiva_body_code_invalid_property_state", async () => {
  // El cuerpo del 400 por propiedad inactiva debe identificar la razón.
  // En RED: handler devuelve { ok: true } → FALLA.
  const prop = make_property_with_agent({ status: "paused" });
  const h = make_handler(verifier_ok(), resolver_property_found(prop));
  const res = await h(post_auth(PAYLOAD_VALIDO));
  const body = await res.json();
  assertExists(body.error, "respuesta de propiedad inactiva debe tener campo 'error'");
  assertEquals(
    body.error.code,
    "INVALID_PROPERTY_STATE",
    "error.code debe ser 'INVALID_PROPERTY_STATE' para propiedad no active",
  );
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});

// ── Agente sin teléfono → 400 AGENT_PHONE_MISSING ────────────────────────────

Deno.test("agente_phone_null_retorna_400_agent_phone_missing", async () => {
  // Agente sin número registrado → no se puede abrir WhatsApp → no se puede contactar.
  // En RED: handler devuelve 200 (no valida phone) → FALLA.
  const prop = make_property_with_agent({ agent_phone: null });
  const h = make_handler(verifier_ok(), resolver_property_found(prop));
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 400, "agente sin phone (null) debe devolver 400");
});

Deno.test("agente_phone_cadena_vacia_retorna_400_agent_phone_missing", async () => {
  // Cadena vacía también es inválida — el deep link de WhatsApp fallaría.
  const prop = make_property_with_agent({ agent_phone: "" });
  const h = make_handler(verifier_ok(), resolver_property_found(prop));
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 400, "agente con phone vacío debe devolver 400");
});

Deno.test("agente_sin_phone_body_code_agent_phone_missing", async () => {
  // El cuerpo del 400 por ausencia de teléfono debe ser específico.
  // En RED: handler devuelve { ok: true } → FALLA.
  const prop = make_property_with_agent({ agent_phone: null });
  const h = make_handler(verifier_ok(), resolver_property_found(prop));
  const res = await h(post_auth(PAYLOAD_VALIDO));
  const body = await res.json();
  assertExists(body.error, "respuesta de agente sin phone debe tener campo 'error'");
  assertEquals(
    body.error.code,
    "AGENT_PHONE_MISSING",
    "error.code debe ser 'AGENT_PHONE_MISSING' cuando el agente no tiene teléfono",
  );
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});

// ── Boundary: DB_ERROR → 500 ──────────────────────────────────────────────────

Deno.test("resolver_db_error_retorna_500", async () => {
  // Falla de infraestructura en el resolver → handler debe propagar 500.
  // En RED: handler devuelve 200 (no maneja DB_ERROR) → FALLA.
  const h = make_handler(verifier_ok(), resolver_db_error());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 500, "error de DB en el resolver debe devolver 500");
});
