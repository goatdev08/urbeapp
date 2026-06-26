// Tests RED — subtareas 7.4 + 7.5 + 7.6
// Edge Function: admin-create-agency/handler.ts
// Framework: Deno.test + @std/assert (nativo Deno)
// Runner: deno test --allow-net supabase/functions/admin-create-agency/handler.test.ts
//
// EDGE CASES (RED) — 7.6 (token inicial + admin_actions):
// ### Happy path
// - 201 incluye plain_token de 8 chars alfanuméricos [A-Za-z0-9]
// - 201 incluye token_id (devuelto por la RPC)
// - create_atomic recibe token_hash = sha256_hex(plain_token) — contrato hash≠plano
// - plain_token tiene longitud 8; token_hash (sha256 hex) tiene longitud 64
// ### Edge cases del PRD (§7.6)
// - plain_token NO es igual al token_hash enviado a create_atomic (plano nunca se persiste)
// ### Ramas de reglas no obvias
// - generate_invitation_code(8) genera 8 chars alfanuméricos [A-Za-z0-9] (stub lanza en RED)
// - sha256_hex determinismo: mismo input → mismo output en dos llamadas (ya implementado)
//
// EDGE CASES (RED) — 7.4:
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
//
// EDGE CASES (RED) — 7.5 (owner vía Auth Admin invite):
// ### Happy path con owner
// - POST admin + payload con owner fields + invite OK + creator OK → 201 con agency_id, owner_user_id, invite_action_link
// - create_atomic recibe owner_user_id en sus params
//
// ### Edge cases del PRD (decisión 7.5)
// - owner_email duplicado → 409 EMAIL_ALREADY_EXISTS; creator NO es llamado
// - owner_email formato inválido → 400 INVALID_INPUT
// - owner_first_name ausente → 400 INVALID_INPUT
// - owner_last_name ausente → 400 INVALID_INPUT
// - owner_email ausente → 400 INVALID_INPUT
//
// ### Ramas de reglas no obvias
// - RPC falla tras crear owner → deleteUser(owner_user_id) llamado; respuesta no es 201
// - owner ya con membresía activa (ALREADY_ACTIVE_MEMBER) → deleteUser llamado; 409

import { assertEquals, assertExists } from "@std/assert";
import { generate_invitation_code, sha256_hex } from "../_shared/crypto.ts";
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
const OWNER_ID = "00000000-0000-0000-0000-000000000003";
const TOKEN_ID = "00000000-0000-0000-0000-000000000004";
const INVITE_LINK = "https://url.supabase.co/auth/v1/verify?token=tok_abc123&type=invite";

// PAYLOAD_VALIDO incluye campos owner (7.5). Los tests de 7.4 que solo usan
// slug/name siguen pasando porque el handler stub ignora campos extra del payload.
const PAYLOAD_VALIDO = {
  name: "Inmobiliaria Urbea SA de CV",
  slug: "inmobiliaria-urbea",
  contact_email: "contacto@urbea.mx",
  contact_name: "Director Comercial",
  contact_phone: "+52 55 1234 5678",
  owner_email: "owner@inmobiliaria-urbea.mx",
  owner_first_name: "Ana",
  owner_last_name: "García",
};

// ── Tipos provisionales para fakes de Auth Admin 7.5 ─────────────────────────
// Estos tipos se mueven a _shared/auth_user.ts en la fase GREEN.

interface GenInviteLinkParams {
  email: string;
  data?: Record<string, unknown>;
}

interface GenInviteLinkResponse {
  data: { user: { id: string }; action_link: string } | null;
  error: { message: string } | null;
}

// ── Factories de fakes — AdminVerifier ───────────────────────────────────────

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

// ── Factories de fakes — AgencyCreator ───────────────────────────────────────

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

// ── Factories de fakes — AuthAdmin (7.5) ─────────────────────────────────────

interface FakeAuthAdmin {
  invite_calls: GenInviteLinkParams[];
  delete_calls: string[];
  generateInviteLink(params: GenInviteLinkParams): Promise<GenInviteLinkResponse>;
  deleteUser(uid: string): Promise<void>;
  // createUser presente para satisfacer AuthAdminClient en GREEN
  createUser(params: unknown): Promise<unknown>;
}

function auth_admin_invite_ok(): FakeAuthAdmin {
  return {
    invite_calls: [],
    delete_calls: [],
    generateInviteLink(params: GenInviteLinkParams): Promise<GenInviteLinkResponse> {
      this.invite_calls.push(params);
      return Promise.resolve({
        data: { user: { id: OWNER_ID }, action_link: INVITE_LINK },
        error: null,
      });
    },
    deleteUser(uid: string): Promise<void> {
      this.delete_calls.push(uid);
      return Promise.resolve();
    },
    createUser(_params: unknown): Promise<unknown> {
      return Promise.resolve({ data: null, error: { message: "not used in 7.5" } });
    },
  };
}

function auth_admin_invite_email_duplicate(): FakeAuthAdmin {
  return {
    invite_calls: [],
    delete_calls: [],
    generateInviteLink(params: GenInviteLinkParams): Promise<GenInviteLinkResponse> {
      this.invite_calls.push(params);
      return Promise.resolve({
        data: null,
        error: { message: "User already been registered" },
      });
    },
    deleteUser(uid: string): Promise<void> {
      this.delete_calls.push(uid);
      return Promise.resolve();
    },
    createUser(_params: unknown): Promise<unknown> {
      return Promise.resolve({ data: null, error: { message: "not used" } });
    },
  };
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

// deps_admin: helpers de 7.4 (sin authAdmin — handler stub no lo usa aún)
function deps_admin(
  verifier: AdminVerifier = verifier_admin_ok(),
  creator: AgencyCreator = creator_ok(),
): AdminCreateAgencyDeps {
  return { adminVerifier: verifier, agencyCreator: creator };
}

// deps_con_auth: helper de 7.5 — incluye authAdmin con generateInviteLink
// Se castea a unknown porque AdminCreateAgencyDeps no tiene authAdmin aún (stub RED).
function deps_con_auth(
  verifier: AdminVerifier = verifier_admin_ok(),
  creator: AgencyCreator = creator_ok(),
  auth: FakeAuthAdmin = auth_admin_invite_ok(),
): AdminCreateAgencyDeps {
  return {
    adminVerifier: verifier,
    agencyCreator: creator,
    // deno-lint-ignore no-explicit-any
    authAdmin: auth as any,
  };
}

// ── Happy path (7.4) ──────────────────────────────────────────────────────────

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

// ── Validación del payload (7.4) ──────────────────────────────────────────────

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

// ── Auth — AdminVerifier (7.4) ────────────────────────────────────────────────

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

// ── AgencyCreator errores (7.4) ───────────────────────────────────────────────

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

// ── Forma del error (7.4) ─────────────────────────────────────────────────────

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

// ── Happy path con owner (7.5) ────────────────────────────────────────────────

Deno.test(
  "happy_path_crea_agencia_con_owner_retorna_201_con_owner_user_id_e_invite_action_link",
  async () => {
    const auth = auth_admin_invite_ok();
    const creator = creator_ok();
    const res = await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    assertEquals(res.status, 201);
    const body = await res.json();
    assertEquals(body.agency_id, AGENCY_ID);
    // owner_user_id y invite_action_link deben estar en la respuesta 7.5
    assertEquals(
      body.owner_user_id,
      OWNER_ID,
      "owner_user_id debe estar en la respuesta 201",
    );
    assertEquals(
      body.invite_action_link,
      INVITE_LINK,
      "invite_action_link debe estar en la respuesta 201",
    );
  },
);

Deno.test(
  "happy_path_create_atomic_recibe_owner_user_id_en_params",
  async () => {
    const auth = auth_admin_invite_ok();
    const creator = creator_ok();
    await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    assertEquals(creator.calls.length, 1, "create_atomic debe ser llamado exactamente una vez");
    // owner_user_id debe llegar al create_atomic para la inserción de agency_members
    assertEquals(
      // deno-lint-ignore no-explicit-any
      (creator.calls[0] as any).owner_user_id,
      OWNER_ID,
      "create_atomic debe recibir owner_user_id en sus params",
    );
  },
);

// ── owner_email duplicado (7.5) ───────────────────────────────────────────────

Deno.test(
  "owner_email_duplicado_retorna_409_email_already_exists",
  async () => {
    const auth = auth_admin_invite_email_duplicate();
    const creator = creator_ok();
    const res = await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error.code, "EMAIL_ALREADY_EXISTS");
  },
);

Deno.test(
  "owner_email_duplicado_rpc_no_es_llamada",
  async () => {
    // Si el owner_email ya existe en Auth, la RPC NO debe ser llamada
    // (no se crea una agencia huérfana sin owner)
    const auth = auth_admin_invite_email_duplicate();
    const creator = creator_ok();
    await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    assertEquals(
      creator.calls.length,
      0,
      "create_atomic NO debe ser llamado cuando owner_email ya existe en Auth",
    );
  },
);

// ── Compensación: RPC falla tras crear owner (7.5) ────────────────────────────

Deno.test(
  "rpc_falla_despues_de_crear_owner_deleteUser_llamado_compensacion",
  async () => {
    // Flujo: invite OK → RPC DB_ERROR → deleteUser(owner_user_id) best-effort
    const auth = auth_admin_invite_ok();
    const creator = creator_error("DB_ERROR");
    await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    // La compensación debe haber sido llamada con el owner_user_id correcto
    assertEquals(
      auth.delete_calls.length,
      1,
      "deleteUser debe ser llamado exactamente una vez como compensación",
    );
    assertEquals(
      auth.delete_calls[0],
      OWNER_ID,
      "deleteUser debe recibir el owner_user_id del usuario creado en Auth",
    );
  },
);

Deno.test(
  "rpc_falla_despues_de_crear_owner_respuesta_no_es_201",
  async () => {
    // El error de la RPC debe traducirse en una respuesta de error (no 201)
    const auth = auth_admin_invite_ok();
    const creator = creator_error("DB_ERROR");
    const res = await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    assertEquals(
      res.status >= 400,
      true,
      "Cuando la RPC falla después de crear el owner, el status debe ser >= 400",
    );
  },
);

// ── owner ya con membresía activa (7.5) ──────────────────────────────────────

Deno.test(
  "owner_ya_con_membresia_activa_retorna_409_already_active_member",
  async () => {
    // RPC devuelve ALREADY_ACTIVE_MEMBER → handler debe mapear a 409
    const auth = auth_admin_invite_ok();
    const creator = creator_error("ALREADY_ACTIVE_MEMBER");
    const res = await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error.code, "ALREADY_ACTIVE_MEMBER");
  },
);

Deno.test(
  "owner_ya_con_membresia_activa_deleteUser_llamado_compensacion",
  async () => {
    // ALREADY_ACTIVE_MEMBER también requiere compensar al owner recién creado en Auth
    const auth = auth_admin_invite_ok();
    const creator = creator_error("ALREADY_ACTIVE_MEMBER");
    await handler(post_admin(PAYLOAD_VALIDO), deps_con_auth(
      verifier_admin_ok(),
      creator,
      auth,
    ));
    assertEquals(
      auth.delete_calls.length,
      1,
      "deleteUser debe ser llamado como compensación para ALREADY_ACTIVE_MEMBER",
    );
    assertEquals(
      auth.delete_calls[0],
      OWNER_ID,
      "deleteUser debe recibir el owner_user_id correcto",
    );
  },
);

// ── Validación de owner fields (7.5) ─────────────────────────────────────────

Deno.test("validacion_owner_email_ausente_retorna_400", async () => {
  const { owner_email: _omit, ...sin_owner_email } = PAYLOAD_VALIDO;
  const res = await handler(post_admin(sin_owner_email), deps_con_auth());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_owner_email_invalido_retorna_400", async () => {
  const res = await handler(
    post_admin({ ...PAYLOAD_VALIDO, owner_email: "no-es-email" }),
    deps_con_auth(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_owner_first_name_ausente_retorna_400", async () => {
  const { owner_first_name: _omit, ...sin_first_name } = PAYLOAD_VALIDO;
  const res = await handler(post_admin(sin_first_name), deps_con_auth());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_owner_last_name_ausente_retorna_400", async () => {
  const { owner_last_name: _omit, ...sin_last_name } = PAYLOAD_VALIDO;
  const res = await handler(post_admin(sin_last_name), deps_con_auth());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Token inicial de invitación (7.6) ─────────────────────────────────────────
// Fase RED: handler aún no genera ni devuelve plain_token/token_id.
// Estos tests fallan por aserción (los campos no existen en la respuesta).

/** Factory: creator que devuelve token_id en el resultado de éxito (7.6) */
function creator_ok_con_token_id(): FakeCreator {
  return {
    calls: [],
    create_atomic(params: AgencyCreateParams): Promise<AgencyCreateResult> {
      this.calls.push(params);
      // token_id se añade al tipo AgencyCreateResult en el stub de agency.ts (7.6)
      // deno-lint-ignore no-explicit-any
      return Promise.resolve({ ok: true, agency_id: AGENCY_ID, token_id: TOKEN_ID } as any);
    },
  } as FakeCreator;
}

Deno.test(
  "token_7_6_happy_path_201_incluye_plain_token_de_8_chars_alfanumericos",
  async () => {
    const auth = auth_admin_invite_ok();
    const creator = creator_ok_con_token_id();
    const res = await handler(
      post_admin(PAYLOAD_VALIDO),
      deps_con_auth(verifier_admin_ok(), creator, auth),
    );
    assertEquals(res.status, 201);
    const body = await res.json();
    assertExists(body.plain_token, "plain_token debe estar en la respuesta 201");
    assertEquals(typeof body.plain_token, "string");
    assertEquals(
      /^[A-Za-z0-9]{8}$/.test(body.plain_token),
      true,
      "plain_token debe ser 8 chars del alfabeto [A-Za-z0-9]",
    );
  },
);

Deno.test(
  "token_7_6_happy_path_201_incluye_token_id_de_la_rpc",
  async () => {
    const auth = auth_admin_invite_ok();
    const creator = creator_ok_con_token_id();
    const res = await handler(
      post_admin(PAYLOAD_VALIDO),
      deps_con_auth(verifier_admin_ok(), creator, auth),
    );
    assertEquals(res.status, 201);
    const body = await res.json();
    assertEquals(
      body.token_id,
      TOKEN_ID,
      "token_id debe estar en la respuesta 201 con el valor devuelto por la RPC",
    );
  },
);

Deno.test(
  "token_7_6_plain_token_no_es_igual_al_token_hash_enviado_a_rpc",
  async () => {
    // Invariante: el plano se retorna al admin; el hash se persiste en BD. Nunca coinciden.
    const auth = auth_admin_invite_ok();
    const creator = creator_ok_con_token_id();
    const res = await handler(
      post_admin(PAYLOAD_VALIDO),
      deps_con_auth(verifier_admin_ok(), creator, auth),
    );
    assertEquals(res.status, 201);
    const body = await res.json();
    // deno-lint-ignore no-explicit-any
    const captured_hash = (creator.calls[0] as any).token_hash as string | undefined;
    assertExists(body.plain_token, "plain_token debe estar en la respuesta 201");
    assertExists(captured_hash, "create_atomic debe haber recibido token_hash");
    assertEquals(
      body.plain_token === captured_hash,
      false,
      "plain_token NO debe ser igual al token_hash (plano ≠ hash sha256)",
    );
  },
);

Deno.test(
  "token_7_6_create_atomic_recibe_token_hash_sha256_del_plain_token",
  async () => {
    // Contrato: hash(plano) que llega a la RPC debe ser exactamente sha256_hex(plain_token devuelto)
    const auth = auth_admin_invite_ok();
    const creator = creator_ok_con_token_id();
    const res = await handler(
      post_admin(PAYLOAD_VALIDO),
      deps_con_auth(verifier_admin_ok(), creator, auth),
    );
    assertEquals(res.status, 201);
    const body = await res.json();
    assertExists(body.plain_token, "plain_token debe estar en la respuesta 201");
    // deno-lint-ignore no-explicit-any
    const captured_hash = (creator.calls[0] as any).token_hash as string | undefined;
    assertExists(captured_hash, "create_atomic debe recibir token_hash en sus params");
    // Calcular sha256 del plain_token devuelto y comparar con el hash enviado a la RPC
    const expected_hash = await sha256_hex(body.plain_token);
    assertEquals(
      captured_hash,
      expected_hash,
      "token_hash pasado a create_atomic debe ser sha256_hex(plain_token) — contrato hash≠plano",
    );
  },
);

Deno.test(
  "token_7_6_plain_token_longitud_8_distinta_de_hash_64_chars",
  async () => {
    // sha256 hex siempre tiene 64 chars; plain_token tiene 8 — longitudes distintas confirman que son valores distintos
    const auth = auth_admin_invite_ok();
    const creator = creator_ok_con_token_id();
    const res = await handler(
      post_admin(PAYLOAD_VALIDO),
      deps_con_auth(verifier_admin_ok(), creator, auth),
    );
    assertEquals(res.status, 201);
    const body = await res.json();
    assertExists(body.plain_token, "plain_token debe estar en la respuesta 201");
    assertEquals(
      body.plain_token.length,
      8,
      "plain_token debe tener exactamente 8 caracteres",
    );
    // deno-lint-ignore no-explicit-any
    const captured_hash = (creator.calls[0] as any).token_hash as string | undefined;
    assertExists(captured_hash, "token_hash debe haber sido pasado a create_atomic");
    assertEquals(
      captured_hash.length,
      64,
      "sha256 hex tiene siempre 64 chars — longitud distinta a plain_token (8)",
    );
  },
);

Deno.test(
  "token_7_6_generate_invitation_code_genera_8_chars_alfanumericos",
  () => {
    // stub lanza not_implemented en fase RED; GREEN implementará la lógica real
    const code = generate_invitation_code(8);
    assertEquals(typeof code, "string", "generate_invitation_code debe devolver string");
    assertEquals(code.length, 8, "generate_invitation_code debe devolver 8 chars por defecto");
    assertEquals(
      /^[A-Za-z0-9]{8}$/.test(code),
      true,
      "El código debe ser 8 chars del alfabeto alfanumérico [A-Za-z0-9]",
    );
  },
);

Deno.test(
  "token_7_6_sha256_hex_determinismo_mismo_input_mismo_output",
  async () => {
    // sha256_hex ya está implementado; test documental/regresión
    const hash1 = await sha256_hex("urbea-test-token-determinismo");
    const hash2 = await sha256_hex("urbea-test-token-determinismo");
    assertEquals(hash1, hash2, "sha256_hex debe devolver el mismo hash para el mismo input");
    assertEquals(hash1.length, 64, "sha256 hex debe tener siempre 64 chars");
  },
);
