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
  FindActiveLeadResult,
  IncrementContactCountResult,
  InsertLeadResult,
  InsertOriginResult,
  LeadRecord,
  LeadRepo,
  OriginRepo,
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
    operation_type: "sale",    // 14.6: default venta; tests de renta pasan override
    owner_user_id: USER_ID,
    agent_id: AGENT_ID,
    agent_name: "Agente Demo", // 14.6: default para tests existentes (no usan este campo)
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

// ── 14.4 — Constantes de lead ─────────────────────────────────────────────────
//
// CALLER_ID: el usuario autenticado que contacta al agente (distinto de AGENT_ID).
// Para self-contact se usa verifier_ok(AGENT_ID) — caller == owner.
// LEAD_ID_NUEVO: UUID del lead recién insertado.
// LEAD_ID_EXISTENTE: UUID del lead ya existente (segundo contacto / race condition).

const CALLER_ID = "00000000-0000-0000-0000-000000000003";
const LEAD_ID_NUEVO = "11111111-1111-1111-1111-111111111111";
const LEAD_ID_EXISTENTE = "22222222-2222-2222-2222-222222222222";

// ── 14.4 — FakeLeadRepo ───────────────────────────────────────────────────────

interface FakeLeadRepo extends LeadRepo {
  find_calls: [string, string][]; // [agent_id, user_id] por cada invocación
  insert_calls: [string, string][]; // [agent_id, user_id] por cada invocación
}

// Primer contacto: find retorna not_found; insert retorna lead nuevo.
function lead_repo_not_found_then_inserted(): FakeLeadRepo {
  const lead: LeadRecord = {
    id: LEAD_ID_NUEVO,
    status: "new",
    first_contact_at: "2026-06-29T10:00:00Z",
  };
  return {
    find_calls: [],
    insert_calls: [],
    find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult> {
      this.find_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: true, found: false });
    },
    insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult> {
      this.insert_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: true, lead });
    },
  } as FakeLeadRepo;
}

// Segundo contacto: find retorna lead existente; insert no debería llamarse.
function lead_repo_found_existing(): FakeLeadRepo {
  const lead: LeadRecord = {
    id: LEAD_ID_EXISTENTE,
    status: "new",
    first_contact_at: "2026-06-28T10:00:00Z",
  };
  return {
    find_calls: [],
    insert_calls: [],
    find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult> {
      this.find_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: true, found: true, lead });
    },
    insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult> {
      this.insert_calls.push([agent_id, user_id]);
      // No debería llamarse; si se llama, devuelve lead para no enmascarar el bug
      return Promise.resolve({ ok: true, lead });
    },
  } as FakeLeadRepo;
}

// Race condition: primera find → not_found; insert → CONFLICT_23505; segunda find → lead existente.
// El contador es local al closure para simular estado entre llamadas.
function lead_repo_race_conflict(): FakeLeadRepo {
  let find_count = 0;
  const existing: LeadRecord = {
    id: LEAD_ID_EXISTENTE,
    status: "new",
    first_contact_at: "2026-06-29T09:59:00Z",
  };
  return {
    find_calls: [],
    insert_calls: [],
    find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult> {
      this.find_calls.push([agent_id, user_id]);
      find_count++;
      if (find_count === 1) {
        // Primera llamada: la request concurrente todavía no terminó
        return Promise.resolve({ ok: true, found: false });
      }
      // Segunda llamada: tras el 23505, el lead ya existe
      return Promise.resolve({ ok: true, found: true, lead: existing });
    },
    insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult> {
      this.insert_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: false, error_code: "CONFLICT_23505" });
    },
  } as FakeLeadRepo;
}

// DB_ERROR en find_active_lead → handler debe propagar 500.
function lead_repo_find_db_error(): FakeLeadRepo {
  return {
    find_calls: [],
    insert_calls: [],
    find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult> {
      this.find_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR" });
    },
    insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult> {
      this.insert_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: true, lead: { id: "unused", status: "new", first_contact_at: "" } });
    },
  } as FakeLeadRepo;
}

// DB_ERROR en insert_lead (find retorna not_found, insert falla con DB_ERROR) → 500.
function lead_repo_insert_db_error(): FakeLeadRepo {
  return {
    find_calls: [],
    insert_calls: [],
    find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult> {
      this.find_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: true, found: false });
    },
    insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult> {
      this.insert_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR" });
    },
  } as FakeLeadRepo;
}

// No-op: para tests de 14.2/14.3 que no necesitan LeadRepo.
// El handler no lo llama (aún no hay impl), así que cualquier respuesta sirve.
function lead_repo_noop(): FakeLeadRepo {
  return {
    find_calls: [],
    insert_calls: [],
    find_active_lead(agent_id: string, user_id: string): Promise<FindActiveLeadResult> {
      this.find_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: true, found: false });
    },
    insert_lead(agent_id: string, user_id: string): Promise<InsertLeadResult> {
      this.insert_calls.push([agent_id, user_id]);
      return Promise.resolve({ ok: true, lead: { id: "noop", status: "new", first_contact_at: "" } });
    },
  } as FakeLeadRepo;
}

// ── 14.4 — Helpers de propiedad para tests sin self-contact ──────────────────
//
// Para que el handler llegue al step de lead creation, la propiedad debe:
//   status='active', agent_phone presente, y owner_user_id !== caller.
// En los tests de 14.4, el caller es CALLER_ID y el owner es AGENT_ID.

function resolver_property_owner(): FakePropertyResolver {
  return resolver_property_found(
    make_property_with_agent({ owner_user_id: AGENT_ID, agent_id: AGENT_ID }),
  );
}

// verifier que devuelve CALLER_ID (distinto de AGENT_ID → no self-contact).
function verifier_caller(): FakeCallerVerifier {
  return verifier_ok(CALLER_ID);
}

// ── 14.5 — Constante de video ─────────────────────────────────────────────────

const VIDEO_ID = "99999999-9999-9999-9999-999999999999";

// ── 14.5 — FakeOriginRepo ─────────────────────────────────────────────────────
//
// Puerto DI para insert_origin + increment_contact_count.
// insert_calls: [lead_id, property_id, property_video_id | undefined]
// increment_calls: property_id[]

interface FakeOriginRepo extends OriginRepo {
  insert_calls: [string, string, string | undefined][];
  increment_calls: string[];
}

// No-op: insert devuelve no-op (no fila nueva); increment accesible pero no debería llamarse.
// Se usa como default en make_handler para que los 47 tests anteriores no cambien.
function origin_repo_noop(): FakeOriginRepo {
  return {
    insert_calls: [],
    increment_calls: [],
    insert_origin(
      lead_id: string,
      property_id: string,
      property_video_id?: string,
    ): Promise<InsertOriginResult> {
      this.insert_calls.push([lead_id, property_id, property_video_id]);
      return Promise.resolve({ ok: true, inserted: false });
    },
    increment_contact_count(property_id: string): Promise<IncrementContactCountResult> {
      this.increment_calls.push(property_id);
      return Promise.resolve({ ok: true });
    },
  } as FakeOriginRepo;
}

// ── Factory helper ────────────────────────────────────────────────────────────
//
// Cuarto parámetro (14.5+): originRepo con default noop → los 47 tests de
// 14.2/14.3/14.4 no necesitan cambiarse.

function make_handler(
  verifier: CallerVerifier = verifier_ok(),
  resolver: PropertyResolver = resolver_property_found(),
  lead_repo: LeadRepo = lead_repo_noop(),
  origin_repo: OriginRepo = origin_repo_noop(),
): (req: Request) => Promise<Response> {
  const deps: ContactAgentDeps = {
    callerVerifier: verifier,
    propertyResolver: resolver,
    leadRepo: lead_repo,
    originRepo: origin_repo,
  };
  return make_contact_agent_handler(deps);
}

// ── Payload base ──────────────────────────────────────────────────────────────

const PAYLOAD_VALIDO = { propertyId: PROPERTY_ID };

// ── 14.5 — Más factories OriginRepo ──────────────────────────────────────────

// insert_origin devuelve fila nueva (inserted=true); increment ok.
function origin_repo_insert_new(): FakeOriginRepo {
  return {
    insert_calls: [],
    increment_calls: [],
    insert_origin(
      lead_id: string,
      property_id: string,
      property_video_id?: string,
    ): Promise<InsertOriginResult> {
      this.insert_calls.push([lead_id, property_id, property_video_id]);
      return Promise.resolve({ ok: true, inserted: true });
    },
    increment_contact_count(property_id: string): Promise<IncrementContactCountResult> {
      this.increment_calls.push(property_id);
      return Promise.resolve({ ok: true });
    },
  } as FakeOriginRepo;
}

// insert_origin devuelve no-op (conflicto — ON CONFLICT DO NOTHING, inserted=false).
// increment no debería llamarse; si se llama, lo registra para aserción.
function origin_repo_no_op(): FakeOriginRepo {
  return {
    insert_calls: [],
    increment_calls: [],
    insert_origin(
      lead_id: string,
      property_id: string,
      property_video_id?: string,
    ): Promise<InsertOriginResult> {
      this.insert_calls.push([lead_id, property_id, property_video_id]);
      return Promise.resolve({ ok: true, inserted: false });
    },
    increment_contact_count(property_id: string): Promise<IncrementContactCountResult> {
      this.increment_calls.push(property_id);
      return Promise.resolve({ ok: true });
    },
  } as FakeOriginRepo;
}

// insert_origin falla con DB_ERROR → handler debe devolver 500.
function origin_repo_insert_db_error(): FakeOriginRepo {
  return {
    insert_calls: [],
    increment_calls: [],
    insert_origin(
      lead_id: string,
      property_id: string,
      property_video_id?: string,
    ): Promise<InsertOriginResult> {
      this.insert_calls.push([lead_id, property_id, property_video_id]);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR" });
    },
    increment_contact_count(property_id: string): Promise<IncrementContactCountResult> {
      this.increment_calls.push(property_id);
      return Promise.resolve({ ok: true });
    },
  } as FakeOriginRepo;
}

// insert_origin ok (fila nueva), pero increment falla con DB_ERROR → 500.
function origin_repo_increment_db_error(): FakeOriginRepo {
  return {
    insert_calls: [],
    increment_calls: [],
    insert_origin(
      lead_id: string,
      property_id: string,
      property_video_id?: string,
    ): Promise<InsertOriginResult> {
      this.insert_calls.push([lead_id, property_id, property_video_id]);
      return Promise.resolve({ ok: true, inserted: true });
    },
    increment_contact_count(property_id: string): Promise<IncrementContactCountResult> {
      this.increment_calls.push(property_id);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR" });
    },
  } as FakeOriginRepo;
}

// ── 14.5 — PropertyResolver con video_id ─────────────────────────────────────

function resolver_property_owner_with_video(): FakePropertyResolver {
  return resolver_property_found(
    make_property_with_agent({
      owner_user_id: AGENT_ID,
      agent_id: AGENT_ID,
      video_id: VIDEO_ID,
    }),
  );
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_post_jwt_valido_uuid_valido_retorna_200", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 200);
});

// CONTRATO ACTUALIZADO en 14.6: la respuesta final usa { success:true, phone, message, ... }
// en lugar del placeholder { ok:true } de 14.2. El nombre del test se conserva para que
// el guardian pueda matchear la historia del test. En RED (ahora): body.success===undefined
// → falla. En GREEN (tras 14.6): body.success===true → pasa.
Deno.test("happy_path_respuesta_contiene_ok_true", async () => {
  const h = make_handler(verifier_ok());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true, "14.6: respuesta final debe tener { success:true } (no { ok:true })");
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

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS 14.4 — Creación idempotente del lead con guard de self-contact
//
// EDGE CASES:
//
// ### Happy path (primer contacto)
// - find_active_lead llamado exactamente una vez con agent_id=property.owner_user_id y user_id=caller
// - insert_lead llamado cuando find retorna not_found
// - insert_lead llamado con los argumentos correctos (agent_id=owner, user_id=caller)
//
// ### Idempotencia (segundo contacto — lead ya existe)
// - find retorna lead existente → insert NO llamado
//
// ### Race condition (INSERT viola constraint 23505 de leads_agent_user_unique_active)
// - insert retorna CONFLICT_23505 → handler NO devuelve 500
// - Después del 23505: find llamado por segunda vez para recuperar el lead
// - find_calls.length == 2 en total (antes y después del conflict)
//
// ### Self-contact (caller == property.owner_user_id)
// - 400 CANNOT_CONTACT_SELF ANTES de llamar a leadRepo
// - body.error.code === 'CANNOT_CONTACT_SELF'
// - find_active_lead y insert_lead NO llamados
//
// ### Boundary / error
// - find_active_lead retorna DB_ERROR → 500
// - insert_lead retorna DB_ERROR (sin CONFLICT_23505) → 500
//
// Diseño DI: LeadRepo con find_active_lead/insert_lead; callerVerifier ya expone user_id.
// El handler detecta self-contact comparando auth_result.user_id con property.owner_user_id.
// ═══════════════════════════════════════════════════════════════════════════════

// ── Happy path 14.4 — primer contacto ────────────────────────────────────────

Deno.test("lead_14_4_primer_contacto_find_activo_llamado_exactamente_una_vez", async () => {
  // El handler debe llamar find_active_lead una sola vez para comprobar idempotencia.
  // RED: handler no llama leadRepo → find_calls.length === 0, no 1 → FALLA.
  const repo = lead_repo_not_found_then_inserted();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    repo.find_calls.length,
    1,
    "find_active_lead debe llamarse exactamente una vez en el primer contacto",
  );
});

Deno.test("lead_14_4_primer_contacto_find_llamado_con_agent_id_owner_user_id", async () => {
  // agent_id del lead = property.owner_user_id (AGENT_ID en el fixture de 14.4).
  // RED: handler no llama leadRepo → find_calls vacío → la primera aserción FALLA.
  const repo = lead_repo_not_found_then_inserted();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(repo.find_calls.length, 1, "find_active_lead debe llamarse una vez");
  assertEquals(
    repo.find_calls[0][0],
    AGENT_ID,
    "primer arg de find_active_lead debe ser agent_id = property.owner_user_id",
  );
});

Deno.test("lead_14_4_primer_contacto_find_llamado_con_user_id_caller", async () => {
  // user_id del lead = el caller autenticado (CALLER_ID, extraído del JWT).
  // RED: handler no llama leadRepo → find_calls vacío → la primera aserción FALLA.
  const repo = lead_repo_not_found_then_inserted();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(repo.find_calls.length, 1, "find_active_lead debe llamarse una vez");
  assertEquals(
    repo.find_calls[0][1],
    CALLER_ID,
    "segundo arg de find_active_lead debe ser user_id = caller autenticado",
  );
});

Deno.test("lead_14_4_primer_contacto_insert_llamado_cuando_not_found", async () => {
  // Cuando find retorna not_found, el handler debe llamar insert_lead.
  // RED: handler no llama leadRepo → insert_calls.length === 0, no 1 → FALLA.
  const repo = lead_repo_not_found_then_inserted();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    repo.insert_calls.length,
    1,
    "insert_lead debe llamarse exactamente una vez cuando find retorna not_found",
  );
});

Deno.test("lead_14_4_primer_contacto_insert_con_agent_id_owner_user_id_correcto", async () => {
  // insert_lead debe recibir agent_id = property.owner_user_id.
  // RED: handler no llama leadRepo → insert_calls vacío → primera aserción FALLA.
  const repo = lead_repo_not_found_then_inserted();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(repo.insert_calls.length, 1, "insert_lead debe llamarse una vez");
  assertEquals(
    repo.insert_calls[0][0],
    AGENT_ID,
    "primer arg de insert_lead debe ser agent_id = property.owner_user_id",
  );
});

Deno.test("lead_14_4_primer_contacto_insert_con_user_id_caller_correcto", async () => {
  // insert_lead debe recibir user_id = caller autenticado.
  // RED: handler no llama leadRepo → insert_calls vacío → primera aserción FALLA.
  const repo = lead_repo_not_found_then_inserted();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(repo.insert_calls.length, 1, "insert_lead debe llamarse una vez");
  assertEquals(
    repo.insert_calls[0][1],
    CALLER_ID,
    "segundo arg de insert_lead debe ser user_id = caller autenticado",
  );
});

// ── Idempotencia — segundo contacto ──────────────────────────────────────────

Deno.test("lead_14_4_segundo_contacto_find_llamado_y_insert_no_llamado", async () => {
  // Cuando ya existe un lead activo para (agent_id, user_id), el handler reutiliza
  // el existente y NO crea uno nuevo. find debe llamarse 1 vez, insert 0 veces.
  // RED: handler no llama leadRepo → find_calls.length === 0 (no 1) → FALLA.
  const repo = lead_repo_found_existing();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    repo.find_calls.length,
    1,
    "find_active_lead debe llamarse exactamente una vez en el segundo contacto",
  );
  assertEquals(
    repo.insert_calls.length,
    0,
    "insert_lead NO debe llamarse cuando el lead ya existe",
  );
});

// ── Race condition — 23505 ────────────────────────────────────────────────────

Deno.test("lead_14_4_race_condition_insert_intentado", async () => {
  // El handler debe intentar insert aunque find retornó not_found.
  // RED: handler no llama leadRepo → insert_calls.length === 0 (no 1) → FALLA.
  const repo = lead_repo_race_conflict();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    repo.insert_calls.length,
    1,
    "insert_lead debe intentarse cuando find retornó not_found (antes del conflict 23505)",
  );
});

Deno.test("lead_14_4_race_condition_23505_find_recupera_lead_segunda_vez", async () => {
  // Tras recibir CONFLICT_23505, el handler debe llamar find_active_lead de nuevo
  // para obtener el lead que ganó la carrera concurrente.
  // Total find_calls esperado: 2 (primera búsqueda + recuperación tras conflict).
  // RED: handler no llama leadRepo → find_calls.length === 0 (no 2) → FALLA.
  const repo = lead_repo_race_conflict();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    repo.find_calls.length,
    2,
    "find_active_lead debe llamarse dos veces: antes del INSERT y después del CONFLICT_23505",
  );
});

Deno.test("lead_14_4_race_condition_23505_no_retorna_500", async () => {
  // Un conflict 23505 es idempotencia exitosa, NO un error de servidor.
  // Primero verificamos que insert fue intentado (falla en RED porque handler no llama leadRepo).
  // Si el primer assert pasara: verificamos que la respuesta NO es 500.
  const repo = lead_repo_race_conflict();
  const h = make_handler(verifier_caller(), resolver_property_owner(), repo);
  const res = await h(post_auth(PAYLOAD_VALIDO));
  // RED: insert_calls.length === 0 ≠ 1 → FALLA (garantiza que el test no pase trivialmente)
  assertEquals(
    repo.insert_calls.length,
    1,
    "insert_lead debe intentarse durante la race condition — si no se intenta, el test no es válido",
  );
  assertEquals(res.status, 200, "CONFLICT_23505 debe resolverse en 200, no en 500");
});

// ── Self-contact ──────────────────────────────────────────────────────────────

Deno.test("lead_14_4_self_contact_retorna_400_cannot_contact_self", async () => {
  // El caller ES el dueño de la propiedad (AGENT_ID == owner_user_id).
  // El handler debe detectar self-contact y retornar 400 ANTES de llamar al leadRepo.
  // RED: handler no implementa self-contact check → retorna 200 → FALLA.
  const verifier = verifier_ok(AGENT_ID); // caller = AGENT_ID = owner
  const h = make_handler(verifier, resolver_property_owner(), lead_repo_noop());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 400, "self-contact debe retornar 400 CANNOT_CONTACT_SELF");
});

Deno.test("lead_14_4_self_contact_body_code_cannot_contact_self", async () => {
  // El cuerpo del 400 por self-contact debe incluir error.code específico.
  // RED: handler retorna 200 { ok: true } → body.error es undefined → FALLA.
  const verifier = verifier_ok(AGENT_ID);
  const h = make_handler(verifier, resolver_property_owner(), lead_repo_noop());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  const body = await res.json();
  assertExists(body.error, "respuesta de self-contact debe tener campo 'error'");
  assertEquals(
    body.error.code,
    "CANNOT_CONTACT_SELF",
    "error.code debe ser 'CANNOT_CONTACT_SELF' cuando el caller es el dueño de la propiedad",
  );
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});

Deno.test("lead_14_4_self_contact_lead_repo_no_tocado", async () => {
  // En self-contact el handler debe cortar ANTES de llamar al leadRepo.
  // La aserción de status (400) es la que falla en RED; las de repo son documentación.
  const repo = lead_repo_noop();
  const verifier = verifier_ok(AGENT_ID);
  const h = make_handler(verifier, resolver_property_owner(), repo);
  const res = await h(post_auth(PAYLOAD_VALIDO));
  // RED: handler retorna 200 → falla aquí (400 !== 200)
  assertEquals(res.status, 400, "self-contact debe retornar 400 antes de tocar leadRepo");
  // Si pasa: verificar que el repo no fue tocado
  assertEquals(repo.find_calls.length, 0, "find_active_lead NO debe llamarse en self-contact");
  assertEquals(repo.insert_calls.length, 0, "insert_lead NO debe llamarse en self-contact");
});

// ── Boundary / error — DB_ERROR en leadRepo ───────────────────────────────────

Deno.test("lead_14_4_find_db_error_retorna_500", async () => {
  // Falla de infraestructura en find_active_lead → handler debe propagar 500.
  // RED: handler no llama leadRepo → retorna 200 (no 500) → FALLA.
  const h = make_handler(verifier_caller(), resolver_property_owner(), lead_repo_find_db_error());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 500, "DB_ERROR en find_active_lead debe devolver 500");
});

Deno.test("lead_14_4_insert_db_error_retorna_500", async () => {
  // Falla de infraestructura en insert_lead (sin CONFLICT_23505) → handler debe propagar 500.
  // RED: handler no llama leadRepo → retorna 200 (no 500) → FALLA.
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_insert_db_error(),
  );
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 500, "DB_ERROR en insert_lead debe devolver 500");
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS 14.5 — Insert lead_origin_properties + increment contact_count
//
// EDGE CASES (RED):
//
// ### Happy path (primer contacto — origin nuevo)
// - insert_origin llamado exactamente una vez en el primer contacto
// - insert_origin recibe lead_id del lead resuelto (LEAD_ID_NUEVO, del leadRepo)
// - insert_origin recibe property_id igual al input (PROPERTY_ID)
// - insert_origin retorna inserted=true → increment_contact_count llamado exactamente 1 vez
// - increment_contact_count recibe property_id correcto (PROPERTY_ID del input)
//
// ### Idempotencia — segundo contacto misma (lead, property)
// - insert_origin retorna inserted=false (ON CONFLICT DO NOTHING → no-op) →
//   increment_contact_count NO llamado (INVARIANTE: contar contactos únicos lead↔property)
//
// ### Lead existente + origin nuevo (mismo buscador, propiedad distinta)
// - Lead ya existe (find_active_lead retorna found=true) + insert_origin devuelve inserted=true
//   → increment_contact_count SÍ llamado (la propiedad es nueva para este lead)
//
// ### property_video_id
// - Propiedad con video_id: el campo se pasa como tercer arg a insert_origin (VIDEO_ID)
// - Propiedad sin video_id (undefined): undefined pasado a insert_origin (campo opcional)
//
// ### Boundary / error
// - DB_ERROR en insert_origin → 500 (falla de infraestructura antes del contador)
// - DB_ERROR en increment_contact_count → 500 (falla de infraestructura al incrementar)
// ═══════════════════════════════════════════════════════════════════════════════

// ── Happy path 14.5 — primer contacto, origin nuevo ──────────────────────────

Deno.test("origin_14_5_insert_origin_llamado_exactamente_una_vez_en_primer_contacto", async () => {
  // El handler debe llamar insert_origin exactamente una vez por request.
  // RED: handler no llama originRepo → insert_calls.length === 0 (no 1) → FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    origin.insert_calls.length,
    1,
    "insert_origin debe llamarse exactamente una vez por request",
  );
});

Deno.test("origin_14_5_insert_origin_recibe_lead_id_del_lead_resuelto", async () => {
  // El primer argumento de insert_origin debe ser el lead.id resuelto por leadRepo.
  // En primer contacto, lead_repo_not_found_then_inserted devuelve lead.id = LEAD_ID_NUEVO.
  // RED: handler no llama originRepo → insert_calls vacío → primera aserción FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(origin.insert_calls.length, 1, "insert_origin debe llamarse una vez");
  assertEquals(
    origin.insert_calls[0][0],
    LEAD_ID_NUEVO,
    "primer arg de insert_origin debe ser lead.id del lead resuelto (LEAD_ID_NUEVO)",
  );
});

Deno.test("origin_14_5_insert_origin_recibe_property_id_del_input", async () => {
  // El segundo argumento de insert_origin debe ser el propertyId del input validado.
  // RED: handler no llama originRepo → insert_calls vacío → primera aserción FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(origin.insert_calls.length, 1, "insert_origin debe llamarse una vez");
  assertEquals(
    origin.insert_calls[0][1],
    PROPERTY_ID,
    "segundo arg de insert_origin debe ser property_id del input (PROPERTY_ID)",
  );
});

Deno.test("origin_14_5_origin_nuevo_llama_increment_contact_count", async () => {
  // Cuando insert_origin devuelve inserted=true (fila nueva), el handler debe
  // llamar increment_contact_count exactamente una vez.
  // RED: handler no llama originRepo → increment_calls.length === 0 (no 1) → FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    origin.increment_calls.length,
    1,
    "increment_contact_count debe llamarse exactamente una vez cuando insert_origin devuelve inserted=true",
  );
});

Deno.test("origin_14_5_increment_llamado_con_property_id_del_input", async () => {
  // increment_contact_count debe recibir el propertyId del input (PROPERTY_ID).
  // RED: handler no llama originRepo → increment_calls vacío → primera aserción FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(origin.increment_calls.length, 1, "increment_contact_count debe llamarse una vez");
  assertEquals(
    origin.increment_calls[0],
    PROPERTY_ID,
    "increment_contact_count debe recibir el propertyId del input (PROPERTY_ID)",
  );
});

// ── Idempotencia — segundo contacto, misma (lead, property) ──────────────────
// INVARIANTE DEL CONTADOR: solo contar contactos únicos lead↔property.

Deno.test("origin_14_5_no_op_no_llama_increment_invariante_contador", async () => {
  // insert_origin retorna inserted=false (ON CONFLICT DO NOTHING — par ya existía) →
  // increment_contact_count NO debe llamarse. Si se llama, se doble-contaría el mismo contacto.
  // RED: handler no llama originRepo → increment_calls.length === 0 que es correcto,
  //      PERO insert_calls.length también === 0 (no 1), lo que falla primero → RED significativo.
  const origin = origin_repo_no_op();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  // La primera aserción falla en RED (insert_origin no se llama aún):
  assertEquals(
    origin.insert_calls.length,
    1,
    "insert_origin debe llamarse incluso en no-op: se llama para detectar si hubo fila nueva",
  );
  // Si el handler implementara parcialmente y llamara insert pero no respetara inserted=false:
  assertEquals(
    origin.increment_calls.length,
    0,
    "INVARIANTE: increment_contact_count NO debe llamarse cuando insert_origin devuelve inserted=false",
  );
});

// ── Lead existente + origin nuevo (mismo buscador, propiedad distinta) ────────

Deno.test("origin_14_5_lead_existente_origin_nuevo_si_incrementa_contact_count", async () => {
  // Escenario: usuario ya tiene lead con este agente (segunda propiedad que ve).
  // leadRepo.find retorna lead existente (LEAD_ID_EXISTENTE).
  // insert_origin es fila nueva (este lead nunca había contactado esta propiedad).
  // → increment_contact_count SÍ debe llamarse (contacto único para esta propiedad).
  // RED: handler no llama originRepo → insert_calls vacío → primera aserción FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_found_existing(), // lead ya existe (LEAD_ID_EXISTENTE)
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(
    origin.insert_calls.length,
    1,
    "insert_origin debe llamarse aunque el lead ya exista (puede ser propiedad nueva)",
  );
  assertEquals(
    origin.insert_calls[0][0],
    LEAD_ID_EXISTENTE,
    "insert_origin debe recibir el lead.id del lead EXISTENTE (no uno nuevo)",
  );
  assertEquals(
    origin.increment_calls.length,
    1,
    "increment_contact_count debe llamarse cuando insert_origin devuelve inserted=true (propiedad nueva para el lead existente)",
  );
});

// ── property_video_id ─────────────────────────────────────────────────────────

Deno.test("origin_14_5_property_video_id_pasado_a_insert_origin_cuando_propiedad_tiene_video", async () => {
  // Cuando la propiedad tiene video_id, debe pasarse como 3er arg a insert_origin.
  // La tabla lead_origin_properties.property_video_id registra de qué video surgió el contacto.
  // RED: handler no llama originRepo → insert_calls vacío → primera aserción FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner_with_video(), // property.video_id = VIDEO_ID
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(origin.insert_calls.length, 1, "insert_origin debe llamarse una vez");
  assertEquals(
    origin.insert_calls[0][2],
    VIDEO_ID,
    "property_video_id (VIDEO_ID) debe pasarse como tercer arg de insert_origin cuando la propiedad tiene video",
  );
});

Deno.test("origin_14_5_property_video_id_undefined_cuando_propiedad_sin_video", async () => {
  // Cuando la propiedad no tiene video_id (undefined), insert_origin se llama con undefined.
  // resolver_property_owner() NO incluye video_id → property.video_id === undefined.
  // RED: handler no llama originRepo → insert_calls vacío → primera aserción FALLA.
  const origin = origin_repo_insert_new();
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(), // property.video_id === undefined
    lead_repo_not_found_then_inserted(),
    origin,
  );
  await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(origin.insert_calls.length, 1, "insert_origin debe llamarse una vez");
  assertEquals(
    origin.insert_calls[0][2],
    undefined,
    "property_video_id debe ser undefined cuando la propiedad no tiene video",
  );
});

// ── Boundary / error ──────────────────────────────────────────────────────────

Deno.test("origin_14_5_db_error_en_insert_origin_retorna_500", async () => {
  // Falla de infraestructura en insert_origin → handler debe propagar 500.
  // RED: handler no llama originRepo → retorna 200 (placeholder) → falla con 200 !== 500.
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin_repo_insert_db_error(),
  );
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 500, "DB_ERROR en insert_origin debe devolver 500");
});

Deno.test("origin_14_5_db_error_en_increment_contact_count_retorna_500", async () => {
  // insert_origin ok (inserted=true) pero increment_contact_count falla con DB_ERROR → 500.
  // El handler no debe ignorar errores del incremento de contador.
  // RED: handler no llama originRepo → retorna 200 (placeholder) → falla con 200 !== 500.
  const h = make_handler(
    verifier_caller(),
    resolver_property_owner(),
    lead_repo_not_found_then_inserted(),
    origin_repo_increment_db_error(),
  );
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 500, "DB_ERROR en increment_contact_count debe devolver 500");
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS 14.6 — Mensaje WhatsApp pre-llenado + respuesta final
//
// CAMBIO DE CONTRATO (documentado también en Taskmaster 14.6):
//
// 1. PropertyWithAgent ahora incluye (actualizados en types.ts y en make_property_with_agent()):
//    - agent_name: string — nombre del agente (resolver: CONCAT(first_name, ' ', last_name))
//    - operation_type: string — 'rent' | 'sale' | 'both' (para sufijo '/mes')
//
// 2. Respuesta final { success:true, phone, message, lead_id, property_id }
//    reemplaza el placeholder { ok:true } de la subtarea 14.2.
//    - phone: SOLO dígitos (quita +, espacios, guiones, paréntesis); conserva código de país
//    - message: texto plano NO URL-encoded; el cliente lo encoda para el deep link en 14.7
//    - lead_id: UUID del lead resuelto (nuevo o existente)
//    - property_id: UUID de la propiedad contactada
//
// 3. Test actualizado legítimamente:
//    - happy_path_respuesta_contiene_ok_true → ahora aserta body.success === true
//      Nombre conservado para no invalidar referencias del guardian; comentario explica el cambio.
//
// EDGE CASES:
// ### Happy path — forma de respuesta
// - success:true en body (no ok)
// - phone presente y es string
// - phone contiene SOLO dígitos (/^[0-9]+$/)
// - message presente como string no vacío
// - property_id correcto en respuesta
// - lead_id correcto (LEAD_ID_NUEVO en primer contacto)
// - message NO URL-encoded (sin %)
// ### Contenido del mensaje
// - mensaje inicia con "Hola [agent_name],"
// - mensaje contiene "vi tu propiedad en Urbea"
// - mensaje contiene dirección de la propiedad
// - mensaje contiene precio con signo $ (formato MXN)
// - mensaje contiene precio numéricamente formateado (Intl.NumberFormat)
// - mensaje cierra con "más información"
// ### Precio — renta vs venta (operation_type)
// - operation_type='sale': mensaje SIN sufijo '/mes'
// - operation_type='rent': mensaje CON sufijo '/mes'
// - operation_type='both': mensaje CON sufijo '/mes'
// ### Sanitización del teléfono
// - '+52 33 1234-5678' → '523312345678'
// - '+5215512345678' → '5215512345678'
// - '(55) 1234-5678' → '5512345678'
// ### Boundary / defensivos
// - price=0: handler no crashea → 200
// - price=0: precio formateado aparece en el mensaje
// ═══════════════════════════════════════════════════════════════════════════════

// ── 14.6 — Constantes ────────────────────────────────────────────────────────

const AGENT_NAME_14_6 = "Carlos García";
// Teléfonos con distintos formatos para probar la sanitización:
const PHONE_CON_ESPACIOS_GUION = "+52 33 1234-5678"; // → "523312345678"
const PHONE_CON_PAREN = "(55) 1234-5678"; // → "5512345678"

// Formatter de precio — misma llamada que usará la implementación.
// Testear con el mismo locale evita fragilidad ante variaciones de Deno/V8.
function format_price_mxn(price: number): string {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(price);
}

// ── 14.6 — Factories de propiedad para mensaje ───────────────────────────────
// Estas usan AGENT_ID como owner_user_id + agent_id para que verifier_caller()
// (CALLER_ID = 000...003) no dispare el self-contact guard.

function make_property_venta(
  overrides: Partial<PropertyWithAgent> = {},
): PropertyWithAgent {
  return make_property_with_agent({
    owner_user_id: AGENT_ID,
    agent_id: AGENT_ID,
    agent_name: AGENT_NAME_14_6,
    operation_type: "sale",
    agent_phone: AGENT_PHONE,
    ...overrides,
  });
}

function make_property_renta(): PropertyWithAgent {
  return make_property_with_agent({
    owner_user_id: AGENT_ID,
    agent_id: AGENT_ID,
    agent_name: AGENT_NAME_14_6,
    operation_type: "rent",
    agent_phone: AGENT_PHONE,
  });
}

function make_property_both(): PropertyWithAgent {
  return make_property_with_agent({
    owner_user_id: AGENT_ID,
    agent_id: AGENT_ID,
    agent_name: AGENT_NAME_14_6,
    operation_type: "both",
    agent_phone: AGENT_PHONE,
  });
}

// ── 14.6 — Handler factory para happy path de mensaje ────────────────────────
// verifier_caller() → CALLER_ID (000...003) ≠ AGENT_ID (000...002) → no self-contact
// lead_repo_not_found_then_inserted() → LEAD_ID_NUEVO ("111...1")
// origin_repo_insert_new() → inserted=true → increment llamado

function make_handler_para_mensaje(
  property: PropertyWithAgent,
): (req: Request) => Promise<Response> {
  return make_handler(
    verifier_caller(),
    resolver_property_found(property),
    lead_repo_not_found_then_inserted(),
    origin_repo_insert_new(),
  );
}

// ── 14.6 — Happy path: forma de respuesta ────────────────────────────────────

Deno.test("respuesta_14_6_success_true", async () => {
  // La respuesta final tiene success:true (no ok:true).
  // RED: handler aún devuelve { ok:true } → body.success===undefined ≠ true → FALLA.
  const h = make_handler_para_mensaje(make_property_venta());
  const res = await h(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true, "14.6: respuesta final debe tener success:true (no ok)");
});

Deno.test("respuesta_14_6_phone_presente_y_es_string", async () => {
  // El campo phone debe estar presente y ser string.
  // RED: body.phone===undefined → typeof===undefined ≠ 'string' → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.phone, "string", "14.6: body.phone debe ser string");
});

Deno.test("respuesta_14_6_phone_contiene_solo_digitos", async () => {
  // phone debe contener SOLO dígitos (/^[0-9]+$/): nada de +, espacios ni guiones.
  // RED: body.phone===undefined → /^[0-9]+$/.test(undefined) → false → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(
    typeof body.phone === "string" && /^[0-9]+$/.test(body.phone),
    true,
    `14.6: phone debe ser solo dígitos, recibido: ${body.phone}`,
  );
});

Deno.test("respuesta_14_6_message_es_string_no_vacio", async () => {
  // message debe ser string no vacío.
  // RED: body.message===undefined → typeof===undefined ≠ 'string' → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "14.6: body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.length > 0,
    true,
    "14.6: body.message no debe estar vacío",
  );
});

Deno.test("respuesta_14_6_property_id_correcto", async () => {
  // property_id en la respuesta debe ser el UUID del input.
  // RED: body.property_id===undefined ≠ PROPERTY_ID → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(
    body.property_id,
    PROPERTY_ID,
    "14.6: body.property_id debe ser el UUID de la propiedad contactada",
  );
});

Deno.test("respuesta_14_6_lead_id_correcto_primer_contacto", async () => {
  // lead_id en la respuesta debe ser el UUID del lead resuelto.
  // lead_repo_not_found_then_inserted() devuelve LEAD_ID_NUEVO en primer contacto.
  // RED: body.lead_id===undefined ≠ LEAD_ID_NUEVO → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(
    body.lead_id,
    LEAD_ID_NUEVO,
    "14.6: body.lead_id debe ser el UUID del lead resuelto (LEAD_ID_NUEVO en primer contacto)",
  );
});

Deno.test("respuesta_14_6_message_no_url_encoded", async () => {
  // El message debe ser texto plano; el cliente lo encoda para el deep link en 14.7.
  // Si la respuesta contiene '%' es señal de que el EF encodeó por error.
  // RED: body.message===undefined → .includes() lanza TypeError → falla de otra forma.
  // Para garantizar fallo por aserción: primero verificar que es string.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string para verificar encoding");
  assertEquals(
    typeof body.message === "string" && body.message.includes("%"),
    false,
    "14.6: body.message NO debe estar URL-encoded (% indica encoding incorrecto en el EF)",
  );
});

// ── 14.6 — Contenido del mensaje ─────────────────────────────────────────────

Deno.test("mensaje_14_6_inicia_con_hola_nombre_agente", async () => {
  // Template: 'Hola [Agent Name], vi tu propiedad en Urbea: ...'
  // El mensaje debe comenzar con "Hola Carlos García".
  // RED: body.message===undefined → .startsWith() lanza → falla por aserción.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.startsWith(`Hola ${AGENT_NAME_14_6}`),
    true,
    `14.6: mensaje debe empezar con "Hola ${AGENT_NAME_14_6}", recibido: ${body.message}`,
  );
});

Deno.test("mensaje_14_6_contiene_vi_tu_propiedad_en_urbea", async () => {
  // El template incluye literalmente "vi tu propiedad en Urbea:".
  // RED: body.message===undefined → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes("vi tu propiedad en Urbea"),
    true,
    `14.6: mensaje debe contener "vi tu propiedad en Urbea", recibido: ${body.message}`,
  );
});

Deno.test("mensaje_14_6_contiene_direccion_propiedad", async () => {
  // El mensaje debe incluir la dirección completa de la propiedad.
  // make_property_venta() usa address="Av. Insurgentes Sur 1234, Col. Del Valle, CDMX".
  // RED: body.message===undefined → FALLA.
  const property = make_property_venta();
  const body = await (await make_handler_para_mensaje(property)(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes(property.address),
    true,
    `14.6: mensaje debe contener la dirección "${property.address}", recibido: ${body.message}`,
  );
});

Deno.test("mensaje_14_6_contiene_precio_con_signo_pesos", async () => {
  // El precio usa formato MXN con símbolo '$'.
  // RED: body.message===undefined → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes("$"),
    true,
    `14.6: mensaje debe contener '$' (precio MXN), recibido: ${body.message}`,
  );
});

Deno.test("mensaje_14_6_contiene_precio_numerico_formateado", async () => {
  // El precio debe aparecer formateado con Intl.NumberFormat('es-MX', MXN).
  // Se usa el mismo formatter en el test para evitar fragilidad ante variaciones de locale.
  // price=2_000_000 → format_price_mxn(2_000_000) (ej. "$2,000,000.00" en Deno/V8)
  // RED: body.message===undefined → FALLA.
  const property = make_property_venta();
  const expected_price_str = format_price_mxn(property.price);
  const body = await (await make_handler_para_mensaje(property)(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes(expected_price_str),
    true,
    `14.6: mensaje debe contener "${expected_price_str}", recibido: ${body.message}`,
  );
});

Deno.test("mensaje_14_6_cierre_me_gustaria_mas_informacion", async () => {
  // El template cierra con "Me gustaría recibir más información."
  // RED: body.message===undefined → FALLA.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes("más información"),
    true,
    `14.6: mensaje debe contener "más información", recibido: ${body.message}`,
  );
});

// ── 14.6 — Precio: renta vs venta (operation_type) ───────────────────────────

Deno.test("precio_14_6_venta_mensaje_sin_sufijo_mes", async () => {
  // operation_type='sale': el precio NO lleva sufijo '/mes'.
  // RED: body.message===undefined → typeof check falla primero.
  const body = await (await make_handler_para_mensaje(make_property_venta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes("/mes"),
    false,
    `14.6: propiedad en venta NO debe incluir "/mes", recibido: ${body.message}`,
  );
});

Deno.test("precio_14_6_renta_mensaje_con_sufijo_mes", async () => {
  // operation_type='rent': el precio lleva sufijo '/mes'.
  // RED: body.message===undefined → typeof check falla primero.
  const body = await (await make_handler_para_mensaje(make_property_renta())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes("/mes"),
    true,
    `14.6: propiedad en renta debe incluir "/mes", recibido: ${body.message}`,
  );
});

Deno.test("precio_14_6_both_mensaje_con_sufijo_mes", async () => {
  // operation_type='both': el precio lleva sufijo '/mes' (convención igual que renta).
  // RED: body.message===undefined → typeof check falla primero.
  const body = await (await make_handler_para_mensaje(make_property_both())(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes("/mes"),
    true,
    `14.6: operation_type='both' debe incluir "/mes", recibido: ${body.message}`,
  );
});

// ── 14.6 — Sanitización del teléfono ─────────────────────────────────────────

Deno.test("telefono_14_6_con_mas_espacios_guion_sanitizado", async () => {
  // '+52 33 1234-5678' → '523312345678': quita +, espacios y guiones; conserva código de país.
  // RED: body.phone===undefined ≠ '523312345678' → FALLA.
  const property = make_property_venta({ agent_phone: PHONE_CON_ESPACIOS_GUION });
  const body = await (await make_handler_para_mensaje(property)(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(
    body.phone,
    "523312345678",
    `14.6: '${PHONE_CON_ESPACIOS_GUION}' debe sanitizarse a '523312345678', recibido: ${body.phone}`,
  );
});

Deno.test("telefono_14_6_ya_normalizado_quita_signo_mas", async () => {
  // '+5215512345678' → '5215512345678': solo se quita el '+'.
  // RED: body.phone===undefined ≠ '5215512345678' → FALLA.
  const property = make_property_venta({ agent_phone: AGENT_PHONE }); // AGENT_PHONE = "+5215512345678"
  const body = await (await make_handler_para_mensaje(property)(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(
    body.phone,
    "5215512345678",
    `14.6: '${AGENT_PHONE}' debe sanitizarse a '5215512345678', recibido: ${body.phone}`,
  );
});

Deno.test("telefono_14_6_con_parentesis_y_espacios_sanitizado", async () => {
  // '(55) 1234-5678' → '5512345678': quita paréntesis, espacios y guiones.
  // RED: body.phone===undefined ≠ '5512345678' → FALLA.
  const property = make_property_venta({ agent_phone: PHONE_CON_PAREN });
  const body = await (await make_handler_para_mensaje(property)(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(
    body.phone,
    "5512345678",
    `14.6: '${PHONE_CON_PAREN}' debe sanitizarse a '5512345678', recibido: ${body.phone}`,
  );
});

// ── 14.6 — Boundary / defensivos ─────────────────────────────────────────────

Deno.test("precio_14_6_cero_no_crashea_retorna_200_con_success", async () => {
  // price=0 es un valor edge válido; el handler no debe crashear ni devolver 5xx.
  // Intl.NumberFormat.format(0) es estable y devuelve '$0.00' (o equivalente locale).
  // RED: handler devuelve { ok:true, no success ni message } → body.success!==true → FALLA.
  const property = make_property_venta({ price: 0 });
  const res = await make_handler_para_mensaje(property)(post_auth(PAYLOAD_VALIDO));
  assertEquals(res.status, 200, "14.6: price=0 no debe causar un crash en el handler");
  const body = await res.json();
  assertEquals(body.success, true, "14.6: price=0 debe devolver { success:true } (no crash)");
});

Deno.test("precio_14_6_cero_formateado_aparece_en_mensaje", async () => {
  // Cuando price=0, el mensaje debe contener la representación formateada del cero.
  // Se usa el mismo formatter para calcular el expected (ej. "$0.00" en Deno/V8 es-MX).
  // RED: body.message===undefined → typeof check falla.
  const property = make_property_venta({ price: 0 });
  const expected_zero = format_price_mxn(0);
  const body = await (await make_handler_para_mensaje(property)(post_auth(PAYLOAD_VALIDO))).json();
  assertEquals(typeof body.message, "string", "body.message debe ser string");
  assertEquals(
    typeof body.message === "string" && body.message.includes(expected_zero),
    true,
    `14.6: mensaje con price=0 debe contener "${expected_zero}", recibido: ${body.message}`,
  );
});
