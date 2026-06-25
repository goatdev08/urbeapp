// Tests RED — subtarea 7.4
// Edge Function: admin-create-agency/handler.ts
// Framework: Deno.test + @std/assert (nativo Deno)
// Runner: deno test --allow-net supabase/functions/admin-create-agency/handler.test.ts
//
// EDGE CASES (RED):
// ### Happy path
// - POST admin válido + payload válido + creator OK → 201 { agency_id }
// - creator.create_atomic invocado con name, slug y user_id del admin correcto
//
// ### CORS / Método HTTP
// - OPTIONS → 200 con header Access-Control-Allow-Origin
// - OPTIONS → header Access-Control-Allow-Methods presente
// - OPTIONS → header Access-Control-Allow-Headers presente
// - GET → 405; PUT → 405; DELETE → 405
//
// ### Body / parse
// - Body no-JSON → 400 INVALID_INPUT
// - Payload vacío {} → 400 INVALID_INPUT
// - Payload array [] → 400 INVALID_INPUT
//
// ### Validación del payload — parse_create_agency_input (§7.4)
// - name ausente → 400 INVALID_INPUT
// - name < 2 chars → 400 INVALID_INPUT
// - slug ausente → 400 INVALID_INPUT
// - slug con mayúsculas → 400 INVALID_INPUT (slug lowercase/guiones obligatorio)
// - slug con espacios → 400 INVALID_INPUT
// - slug con caracteres inválidos (_, !) → 400 INVALID_INPUT
// - contact_email inválido si presente → 400 INVALID_INPUT
//
// ### Auth — AdminVerifier DI (nuevo _shared/admin_auth.ts)
// - Sin Authorization header: verifier llamado con null → 401 UNAUTHENTICATED
// - Verifier devuelve UNAUTHENTICATED → 401, error.code = 'UNAUTHENTICATED'
// - role='agent' (FORBIDDEN) → 403, error.code = 'FORBIDDEN'
// - role='user' (FORBIDDEN) → 403, error.code = 'FORBIDDEN'
// - No-admin: creator NO es llamado (0 calls)
//
// ### AgencyCreator errores DI (nuevo _shared/agency.ts)
// - creator devuelve SLUG_DUPLICATE → 409, error.code = 'SLUG_DUPLICATE'
// - creator devuelve NAME_DUPLICATE → 409, error.code = 'NAME_DUPLICATE'
// - creator devuelve DB_ERROR genérico → 500
//
// ### Forma del error
// - Cualquier error tiene { error: { code: string, message: string } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type { AdminCreateAgencyDeps } from "./handler.ts";
import type { AdminVerifier, AdminVerifyResult } from "../_shared/admin_auth.ts";
import type {
  AgencyCreateParams,
  AgencyCreateResult,
  AgencyCreator,
} from "../_shared/agency.ts";

// ── Constantes ───────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "00000000-0000-0000-0000-000000000002";

const PAYLOAD_VALIDO = {
  name: "Inmobiliaria Urbea SA de CV",
  slug: "inmobiliaria-urbea",
  contact_email: "contacto@urbea.mx",
  contact_name: "Director Comercial",
  contact_phone: "+52 55 1234 5678",
};

// ── Factories de fakes ────────────────────────────────────────────────────────

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

interface FakeCreator extends AgencyCreator {
  calls: AgencyCreateParams[];
}

function creator_ok(): FakeCreator {
  return {
    calls: [],
    create_atomic(params: AgencyCreateParams): Promise<AgencyCreateResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true, agency_id: AGENCY_ID });
    },
  } as FakeCreator;
}

function creator_error(error_code: string): FakeCreator {
  return {
    calls: [],
    create_atomic(params: AgencyCreateParams): Promise<AgencyCreateResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code });
    },
  } as FakeCreator;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_admin(
  body: unknown,
  extra_headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/admin-create-agency", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-admin-jwt",
      ...extra_headers,
    },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/admin-create-agency", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/admin-create-agency", { method });
}

function deps_admin(
  verifier: AdminVerifier = verifier_admin_ok(),
  creator: AgencyCreator = creator_ok(),
): AdminCreateAgencyDeps {
  return { adminVerifier: verifier, agencyCreator: creator };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_admin_crea_agencia_retorna_201_con_agency_id", async () => {
  const res = await handler(post_admin(PAYLOAD_VALIDO), deps_admin());
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.agency_id, AGENCY_ID);
});

Deno.test("happy_path_creator_recibe_name_slug_y_admin_user_id", async () => {
  const verifier = verifier_admin_ok();
  const creator = creator_ok();
  await handler(post_admin(PAYLOAD_VALIDO), deps_admin(verifier, creator));
  assertEquals(creator.calls.length, 1);
  assertEquals(creator.calls[0].name, PAYLOAD_VALIDO.name);
  assertEquals(creator.calls[0].slug, PAYLOAD_VALIDO.slug);
  assertEquals(creator.calls[0].created_by_user_id, ADMIN_ID);
});

// ── CORS / Métodos HTTP ───────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status >= 200 && res.status <= 204, true);
});

Deno.test("cors_options_tiene_header_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Falta header Access-Control-Allow-Origin",
  );
});

Deno.test("cors_options_tiene_header_allow_methods", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Methods"),
    "Falta header Access-Control-Allow-Methods",
  );
});

Deno.test("cors_options_tiene_header_allow_headers", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Headers"),
    "Falta header Access-Control-Allow-Headers",
  );
});

Deno.test("metodo_get_retorna_405", async () => {
  const res = await handler(method_request("GET"));
  assertEquals(res.status, 405);
});

Deno.test("metodo_put_retorna_405", async () => {
  const res = await handler(method_request("PUT"));
  assertEquals(res.status, 405);
});

Deno.test("metodo_delete_retorna_405", async () => {
  const res = await handler(method_request("DELETE"));
  assertEquals(res.status, 405);
});

// ── Body / parse ─────────────────────────────────────────────────────────────

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const req = new Request("http://localhost/admin-create-agency", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-jwt",
    },
    body: "esto no es json{{{",
  });
  const res = await handler(req, deps_admin());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación del payload ────────────────────────────────────────────────────

Deno.test("validacion_payload_vacio_retorna_400_invalid_input", async () => {
  const res = await handler(post_admin({}), deps_admin());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_payload_array_retorna_400_invalid_input", async () => {
  const res = await handler(post_admin([]), deps_admin());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_name_ausente_retorna_400", async () => {
  const { name: _omit, ...sin_name } = PAYLOAD_VALIDO;
  const res = await handler(post_admin(sin_name), deps_admin());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_name_menor_2_caracteres_retorna_400", async () => {
  const res = await handler(
    post_admin({ ...PAYLOAD_VALIDO, name: "A" }),
    deps_admin(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_slug_ausente_retorna_400", async () => {
  const { slug: _omit, ...sin_slug } = PAYLOAD_VALIDO;
  const res = await handler(post_admin(sin_slug), deps_admin());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_slug_con_mayusculas_retorna_400", async () => {
  const res = await handler(
    post_admin({ ...PAYLOAD_VALIDO, slug: "InmobiliariaUrbea" }),
    deps_admin(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_slug_con_espacios_retorna_400", async () => {
  const res = await handler(
    post_admin({ ...PAYLOAD_VALIDO, slug: "inmobiliaria urbea" }),
    deps_admin(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_slug_con_caracteres_invalidos_retorna_400", async () => {
  // guión bajo y ! no son válidos; solo a-z, 0-9 y guión son permitidos
  const res = await handler(
    post_admin({ ...PAYLOAD_VALIDO, slug: "inmobiliaria_urbea!" }),
    deps_admin(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_contact_email_invalido_retorna_400", async () => {
  const res = await handler(
    post_admin({ ...PAYLOAD_VALIDO, contact_email: "no-es-email" }),
    deps_admin(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Auth — AdminVerifier ──────────────────────────────────────────────────────

Deno.test("sin_authorization_header_retorna_401_unauthenticated", async () => {
  const verifier = verifier_unauthenticated();
  const res = await handler(
    post_sin_auth(PAYLOAD_VALIDO),
    { adminVerifier: verifier, agencyCreator: creator_ok() },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("verifier_unauthenticated_retorna_401", async () => {
  const verifier = verifier_unauthenticated();
  const res = await handler(
    post_admin(PAYLOAD_VALIDO),
    { adminVerifier: verifier, agencyCreator: creator_ok() },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("autenticado_role_agent_retorna_403_forbidden", async () => {
  const verifier = verifier_forbidden();
  const res = await handler(
    post_admin(PAYLOAD_VALIDO),
    { adminVerifier: verifier, agencyCreator: creator_ok() },
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("autenticado_role_user_retorna_403_forbidden", async () => {
  // verifier_forbidden() cubre tanto role='user' como role='agent' (ambos son FORBIDDEN)
  const verifier = verifier_forbidden();
  const res = await handler(
    post_admin(PAYLOAD_VALIDO),
    { adminVerifier: verifier, agencyCreator: creator_ok() },
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("no_admin_creator_no_es_llamado", async () => {
  const creator = creator_ok();
  await handler(
    post_admin(PAYLOAD_VALIDO),
    { adminVerifier: verifier_forbidden(), agencyCreator: creator },
  );
  assertEquals(creator.calls.length, 0);
});

// ── AgencyCreator errores ─────────────────────────────────────────────────────

Deno.test("slug_duplicado_retorna_409_con_slug_duplicate", async () => {
  const creator = creator_error("SLUG_DUPLICATE");
  const res = await handler(
    post_admin(PAYLOAD_VALIDO),
    deps_admin(verifier_admin_ok(), creator),
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "SLUG_DUPLICATE");
});

Deno.test("name_duplicado_retorna_409_con_name_duplicate", async () => {
  const creator = creator_error("NAME_DUPLICATE");
  const res = await handler(
    post_admin(PAYLOAD_VALIDO),
    deps_admin(verifier_admin_ok(), creator),
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "NAME_DUPLICATE");
});

Deno.test("error_generico_del_creator_retorna_500", async () => {
  const creator = creator_error("DB_ERROR");
  const res = await handler(
    post_admin(PAYLOAD_VALIDO),
    deps_admin(verifier_admin_ok(), creator),
  );
  assertEquals(res.status, 500);
});

// ── Forma del error ───────────────────────────────────────────────────────────

Deno.test("error_siempre_tiene_forma_error_code_message", async () => {
  // Cualquier respuesta de error debe tener { error: { code: string, message: string } }
  const res = await handler(post_admin({}), deps_admin());
  const body = await res.json();
  assertExists(body.error, "La respuesta no contiene 'error'");
  assertExists(body.error.code, "error.code ausente");
  assertExists(body.error.message, "error.message ausente");
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
