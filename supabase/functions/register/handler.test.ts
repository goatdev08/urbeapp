// supabase/functions/register/handler.test.ts
//
// Tests RED — subtarea 93.2 (Edge Function `register`, POST público sin JWT).
// Framework: Deno.test + std/assert. DI puro (mirror de
// ../redeem-invitation/{index.test.ts,redeem_flow.test.ts}): fakes de
// RegisterAuthAdmin/RegisterAtomicRunner como funciones simples que graban
// llamadas — sin supabase-js, sin red.
//
// Contrato bajo test (fijado por el orquestador, PRD §5.1 y §5.5, y por el
// contrato de 93.1 register_user_atomic — append-only, NO idempotente):
//   POST { email, password, first_name, last_name, phone, date_of_birth,
//          state_id, municipality_id } — TODOS obligatorios.
//   Happy path: authAdmin.createUser(...) con user_metadata EXACTA a lo que
//   lee handle_new_user (first_name, last_name, phone, date_of_birth,
//   state_id, municipality_id) y email_confirm:true → registrar.register_atomic
//   (user_id, ip) EXACTAMENTE UNA VEZ → 200 { user_id }.
//   Si register_atomic falla → compensación deleteUser(user_id); si la
//   compensación también falla, el error ORIGINAL de register_atomic sigue
//   subiendo (no se enmascara).
//   Mapeo sanitizado de errores de createUser/RPC → nunca teléfono/email/
//   nombre de índice/detail crudo de Postgres en el body de la respuesta
//   (hueco 2 de la tarea #93 — ⭐ assert central).
//
// Runner: cd supabase/functions && deno test --allow-net register/handler.test.ts
//
// EDGE CASES ENUMERADOS (todos deben FALLAR en rojo hasta que el agente
// supabase implemente handler.ts real en la fase GREEN):
//
// ### Happy path
// - POST payload completo válido → 200 { user_id } Content-Type application/json
// - createUser llamado 1 vez con user_metadata EXACTA (first_name, last_name,
//   phone, date_of_birth, state_id, municipality_id) + email_confirm:true
// - register_atomic llamado EXACTAMENTE 1 vez con { user_id, ip }
// - deleteUser NO se llama en happy path
//
// ### Validación de entrada (§5.1 — TODOS los campos obligatorios)
// - payload vacío → 400 INVALID_INPUT, createUser NO se llama
// - email ausente / malformado → 400 INVALID_INPUT
// - password ausente / < 8 caracteres → 400 INVALID_INPUT
// - first_name ausente/vacío → 400 INVALID_INPUT
// - last_name ausente/vacío → 400 INVALID_INPUT
// - phone ausente → 400 INVALID_INPUT
// - phone sin prefijo +52 (10 dígitos crudos) → 400 INVALID_INPUT
// - phone con lada extranjera (+1...) → 400 INVALID_INPUT
// - phone con longitud incorrecta (11 dígitos tras +52) → 400 INVALID_INPUT
// - date_of_birth ausente → 400 INVALID_INPUT
// - date_of_birth con formato incorrecto (DD/MM/YYYY) → 400 INVALID_INPUT
// - date_of_birth con string no-fecha → 400 INVALID_INPUT
// - state_id ausente → 400 INVALID_INPUT
// - state_id con longitud incorrecta (1 o 3 dígitos) → 400 INVALID_INPUT
// - state_id no numérico → 400 INVALID_INPUT
// - municipality_id ausente → 400 INVALID_INPUT
// - municipality_id con longitud incorrecta (4 o 6 dígitos) → 400 INVALID_INPUT
// - municipality_id cuyo prefijo NO coincide con state_id (coherencia cvegeo,
//   mismo criterio que el CHECK users_municipio_del_estado) → 400 INVALID_INPUT
// - Para TODO caso de validación inválida: createUser NUNCA se llama
// - Campos extra en el payload son ignorados (no rompe la validación)
//
// ### CORS — ramas de reglas no obvias
// - OPTIONS → 200-204 con Access-Control-Allow-Origin/Methods/Headers
//
// ### Método HTTP
// - GET / PUT / DELETE → 405
//
// ### Orquestación y compensación (mirror redeem_flow.test.ts)
// - register_atomic falla FIELDS_INCOMPLETE → 500 + compensación deleteUser(user_id)
// - register_atomic falla NO_ACTIVE_TERMS → 500 + compensación
// - register_atomic falla NO_ACTIVE_PRIVACY → 500 + compensación
// - createUser falla → register_atomic NUNCA se llama; deleteUser NUNCA se llama
//   (no hay usuario que compensar)
// - register_atomic falla Y deleteUser también falla (rechaza) → el error
//   ORIGINAL de register_atomic sigue subiendo igual (no se enmascara)
//
// ### Mapeo sanitizado de errores de createUser
// - mensaje crudo "User already registered" → EMAIL_ALREADY_EXISTS, 409
// - mensaje crudo con el índice users_phone_unique_active → PHONE_TAKEN, 409
// - mensaje crudo con el constraint users_mayoria_de_edad → UNDERAGE, 422
// - mensaje crudo desconocido/inesperado → 500, código genérico (no expone el mensaje)
//
// ### ⭐ ASSERT CENTRAL (hueco 2) — no-contención de datos sensibles en errores
// - Body de PHONE_TAKEN NO contiene el teléfono en conflicto
// - Body de PHONE_TAKEN NO contiene el nombre del índice "users_phone_unique_active"
// - Body de EMAIL_ALREADY_EXISTS NO contiene el email
// - Body de UNDERAGE NO contiene el nombre del constraint "users_mayoria_de_edad"
// - Body de UNDERAGE NO contiene el detail crudo de la fila (fecha de nacimiento
//   ni el email que Postgres reporta en el DETAIL de la violación de CHECK)
// - Body de un error 500 genérico de createUser NO contiene el mensaje crudo
//   de Postgres tal cual llegó
//
// ### IP del cliente (mismo criterio que redeem-invitation)
// - x-forwarded-for con una sola IP → se pasa esa IP a register_atomic
// - x-forwarded-for con lista CSV → se pasa SOLO la primera IP, recortada
// - sin header x-forwarded-for → se pasa ip: null a register_atomic
//
// ### Forma del error
// - Toda respuesta de error tiene forma { error: { code, message } } con
//   code y message de tipo string

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CreateUserParams,
  CreateUserResponse,
  RegisterAtomicParams,
  RegisterAtomicResult,
  RegisterAtomicRunner,
  RegisterAuthAdmin,
} from "./types.ts";

// ── Constantes ──────────────────────────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000099";

const PAYLOAD_VALIDO = {
  email: "usuario@correo.mx",
  password: "secreto123",
  first_name: "Ana",
  last_name: "García",
  phone: "+523312345678",
  date_of_birth: "1990-05-15",
  state_id: "14", // Jalisco (catálogo INEGI mx_states)
  municipality_id: "14039", // Guadalajara — prefijo '14' == state_id
};

// ── Helpers de request ─────────────────────────────────────────────────────

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/register", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/register", { method });
}

// ── Fakes de dependencias (DI) ──────────────────────────────────────────────

interface FakeAuthAdmin extends RegisterAuthAdmin {
  create_calls: CreateUserParams[];
  delete_calls: string[];
}

function admin_ok(user_id: string = USER_ID): FakeAuthAdmin {
  return {
    create_calls: [],
    delete_calls: [],
    createUser(params: CreateUserParams): Promise<CreateUserResponse> {
      this.create_calls.push(params);
      return Promise.resolve({ data: { user: { id: user_id } }, error: null });
    },
    deleteUser(uid: string): Promise<void> {
      this.delete_calls.push(uid);
      return Promise.resolve();
    },
  } as FakeAuthAdmin;
}

function admin_create_error(message: string): FakeAuthAdmin {
  return {
    create_calls: [],
    delete_calls: [],
    createUser(params: CreateUserParams): Promise<CreateUserResponse> {
      this.create_calls.push(params);
      return Promise.resolve({ data: null, error: { message } });
    },
    deleteUser(uid: string): Promise<void> {
      this.delete_calls.push(uid);
      return Promise.resolve();
    },
  } as FakeAuthAdmin;
}

function admin_ok_but_delete_fails(user_id: string = USER_ID): FakeAuthAdmin {
  return {
    create_calls: [],
    delete_calls: [],
    createUser(params: CreateUserParams): Promise<CreateUserResponse> {
      this.create_calls.push(params);
      return Promise.resolve({ data: { user: { id: user_id } }, error: null });
    },
    deleteUser(uid: string): Promise<void> {
      this.delete_calls.push(uid);
      return Promise.reject(new Error("delete_user_boom"));
    },
  } as FakeAuthAdmin;
}

interface FakeRegistrar extends RegisterAtomicRunner {
  calls: RegisterAtomicParams[];
}

function registrar_ok(): FakeRegistrar {
  return {
    calls: [],
    register_atomic(
      params: RegisterAtomicParams,
    ): Promise<RegisterAtomicResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true });
    },
  } as FakeRegistrar;
}

function registrar_error(error_code: string): FakeRegistrar {
  return {
    calls: [],
    register_atomic(
      params: RegisterAtomicParams,
    ): Promise<RegisterAtomicResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code });
    },
  } as FakeRegistrar;
}

function no_string_leak(body: unknown, forbidden: string): void {
  const serialized = JSON.stringify(body);
  assertEquals(
    serialized.includes(forbidden),
    false,
    `El body de error NO debe contener "${forbidden}", pero lo contiene: ${serialized}`,
  );
}

// ── Happy path ──────────────────────────────────────────────────────────────

Deno.test("happy_path_post_valido_responde_200_con_user_id", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 200);
  const content_type = res.headers.get("Content-Type") ?? "";
  assertEquals(content_type.includes("application/json"), true);
  const body = await res.json();
  assertEquals(body.user_id, USER_ID);
});

Deno.test("happy_path_create_user_recibe_metadata_exacta_de_handle_new_user", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(authAdmin.create_calls.length, 1);
  const call = authAdmin.create_calls[0];
  assertEquals(call.email, PAYLOAD_VALIDO.email);
  assertEquals(call.password, PAYLOAD_VALIDO.password);
  assertEquals(call.email_confirm, true);
  assertEquals(call.user_metadata.first_name, PAYLOAD_VALIDO.first_name);
  assertEquals(call.user_metadata.last_name, PAYLOAD_VALIDO.last_name);
  assertEquals(call.user_metadata.phone, PAYLOAD_VALIDO.phone);
  assertEquals(call.user_metadata.date_of_birth, PAYLOAD_VALIDO.date_of_birth);
  assertEquals(call.user_metadata.state_id, PAYLOAD_VALIDO.state_id);
  assertEquals(
    call.user_metadata.municipality_id,
    PAYLOAD_VALIDO.municipality_id,
  );
});

Deno.test("happy_path_register_atomic_se_llama_exactamente_una_vez_con_user_id", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(registrar.calls.length, 1);
  assertEquals(registrar.calls[0].user_id, USER_ID);
});

Deno.test("happy_path_no_compensa_deleteUser", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(authAdmin.delete_calls.length, 0);
});

// ── Validación de entrada (§5.1) ─────────────────────────────────────────────

Deno.test("validacion_payload_vacio_retorna_400_invalid_input", async () => {
  const res = await handler(post({}));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
  assertExists(body.error.message);
});

Deno.test("validacion_email_ausente_retorna_400", async () => {
  const { email: _omit, ...sin_email } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_email));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_email_malformado_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, email: "no-es-email" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_password_ausente_retorna_400", async () => {
  const { password: _omit, ...sin_pass } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_pass));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_password_menos_de_8_caracteres_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, password: "abc123" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_first_name_ausente_retorna_400", async () => {
  const { first_name: _omit, ...sin_nombre } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_nombre));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_first_name_cadena_vacia_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, first_name: "" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_last_name_ausente_retorna_400", async () => {
  const { last_name: _omit, ...sin_apellido } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_apellido));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_last_name_cadena_vacia_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, last_name: "" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_phone_ausente_retorna_400", async () => {
  const { phone: _omit, ...sin_phone } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_phone));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_phone_sin_prefijo_52_retorna_400", async () => {
  // 10 dígitos crudos, sin '+52' — formato que el CHECK users_phone_e164_mx rechaza.
  const res = await handler(post({ ...PAYLOAD_VALIDO, phone: "3312345678" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_phone_lada_extranjera_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, phone: "+13312345678" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_phone_longitud_incorrecta_retorna_400", async () => {
  // 11 dígitos tras +52 (uno de más) no matchea ^\+52[0-9]{10}$
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, phone: "+5233123456789" }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_date_of_birth_ausente_retorna_400", async () => {
  const { date_of_birth: _omit, ...sin_dob } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_dob));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_date_of_birth_formato_dd_mm_yyyy_retorna_400", async () => {
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: "15/05/1990" }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_date_of_birth_no_fecha_retorna_400", async () => {
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: "no-es-fecha" }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_state_id_ausente_retorna_400", async () => {
  const { state_id: _omit, ...sin_state } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_state));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_state_id_un_digito_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, state_id: "1" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_state_id_tres_digitos_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, state_id: "140" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_state_id_no_numerico_retorna_400", async () => {
  const res = await handler(post({ ...PAYLOAD_VALIDO, state_id: "JA" }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_municipality_id_ausente_retorna_400", async () => {
  const { municipality_id: _omit, ...sin_muni } = PAYLOAD_VALIDO;
  const res = await handler(post(sin_muni));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_municipality_id_cuatro_digitos_retorna_400", async () => {
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, municipality_id: "1403" }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_municipality_id_seis_digitos_retorna_400", async () => {
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, municipality_id: "140390" }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_municipality_id_prefijo_no_coincide_con_state_id_retorna_400", async () => {
  // '19039' = Monterrey (prefijo '19', Nuevo León) con state_id '14' (Jalisco).
  // Mismo criterio que el CHECK users_municipio_del_estado (migración 20260727000002).
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, state_id: "14", municipality_id: "19039" }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
});

Deno.test("validacion_campos_invalidos_nunca_llaman_create_user", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const casos = [
    {},
    { ...PAYLOAD_VALIDO, email: "no-es-email" },
    { ...PAYLOAD_VALIDO, phone: "3312345678" },
    { ...PAYLOAD_VALIDO, date_of_birth: "15/05/1990" },
    { ...PAYLOAD_VALIDO, state_id: "1" },
    { ...PAYLOAD_VALIDO, municipality_id: "19039" },
  ];
  for (const caso of casos) {
    const res = await handler(post(caso), { authAdmin, registrar });
    assertEquals(res.status, 400, `esperaba 400 para ${JSON.stringify(caso)}`);
  }
  assertEquals(authAdmin.create_calls.length, 0);
});

Deno.test("validacion_campos_extra_no_rompen_la_validacion", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, campo_extra: "valor_inesperado", otro: 42 }),
    { authAdmin, registrar },
  );
  assertEquals(res.status, 200);
});

// ── CORS preflight ────────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200_a_204", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status >= 200 && res.status <= 204, true);
});

Deno.test("cors_options_preflight_tiene_headers_cors", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
  assertExists(res.headers.get("Access-Control-Allow-Methods"));
  assertExists(res.headers.get("Access-Control-Allow-Headers"));
});

// ── Método HTTP no permitido ─────────────────────────────────────────────

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

// ── Orquestación y compensación ───────────────────────────────────────────

Deno.test("rpc_fields_incomplete_retorna_500_y_compensa_delete_user", async () => {
  const authAdmin = admin_ok(),
    registrar = registrar_error("FIELDS_INCOMPLETE");
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error.code, "FIELDS_INCOMPLETE");
  assertEquals(authAdmin.delete_calls, [USER_ID]);
});

Deno.test("rpc_no_active_terms_retorna_500_y_compensa", async () => {
  const authAdmin = admin_ok(), registrar = registrar_error("NO_ACTIVE_TERMS");
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  assertEquals(authAdmin.delete_calls, [USER_ID]);
});

Deno.test("rpc_no_active_privacy_retorna_500_y_compensa", async () => {
  const authAdmin = admin_ok(),
    registrar = registrar_error("NO_ACTIVE_PRIVACY");
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  assertEquals(authAdmin.delete_calls, [USER_ID]);
});

Deno.test("create_user_falla_no_llama_registrar_ni_delete_user", async () => {
  const authAdmin = admin_create_error("User already registered");
  const registrar = registrar_ok();
  await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(registrar.calls.length, 0);
  assertEquals(authAdmin.delete_calls.length, 0);
});

Deno.test("rpc_falla_y_delete_user_tambien_falla_sube_el_error_original", async () => {
  const authAdmin = admin_ok_but_delete_fails();
  const registrar = registrar_error("FIELDS_INCOMPLETE");
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  // El error ORIGINAL (de la RPC) sigue subiendo, no se enmascara por el fallo de deleteUser.
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error.code, "FIELDS_INCOMPLETE");
});

// ── Mapeo sanitizado de errores de createUser ─────────────────────────────

Deno.test("create_user_email_duplicado_retorna_409_email_already_exists", async () => {
  const authAdmin = admin_create_error("User already registered");
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "EMAIL_ALREADY_EXISTS");
});

Deno.test("create_user_telefono_duplicado_retorna_409_phone_taken", async () => {
  const authAdmin = admin_create_error(
    'duplicate key value violates unique constraint "users_phone_unique_active"\n' +
      "DETAIL:  Key (phone)=(+523312345678) already exists.",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "PHONE_TAKEN");
});

Deno.test("create_user_menor_de_edad_retorna_422_underage", async () => {
  const authAdmin = admin_create_error(
    'new row for relation "users" violates check constraint "users_mayoria_de_edad"\n' +
      "DETAIL:  Failing row contains (00000000-0000-0000-0000-000000000099, " +
      "usuario@correo.mx, +523312345678, Ana, García, 2015-01-01, ...).",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "UNDERAGE");
});

Deno.test("create_user_error_desconocido_retorna_500", async () => {
  const authAdmin = admin_create_error("connection reset by peer");
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  assertExists((await res.json()).error.code);
});

// ── ⭐ ASSERT CENTRAL (hueco 2): no filtración de datos sensibles ─────────

Deno.test("phone_taken_no_expone_el_telefono_en_conflicto", async () => {
  const authAdmin = admin_create_error(
    'duplicate key value violates unique constraint "users_phone_unique_active"\n' +
      "DETAIL:  Key (phone)=(+523312345678) already exists.",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, "+523312345678");
});

Deno.test("phone_taken_no_expone_el_nombre_del_indice", async () => {
  const authAdmin = admin_create_error(
    'duplicate key value violates unique constraint "users_phone_unique_active"\n' +
      "DETAIL:  Key (phone)=(+523312345678) already exists.",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, "users_phone_unique_active");
});

Deno.test("email_already_exists_no_expone_el_email", async () => {
  const authAdmin = admin_create_error(
    "User already registered: usuario@correo.mx",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, "usuario@correo.mx");
});

Deno.test("underage_no_expone_el_nombre_del_constraint", async () => {
  const authAdmin = admin_create_error(
    'new row for relation "users" violates check constraint "users_mayoria_de_edad"\n' +
      "DETAIL:  Failing row contains (00000000-0000-0000-0000-000000000099, " +
      "usuario@correo.mx, +523312345678, Ana, García, 2015-01-01, ...).",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, "users_mayoria_de_edad");
});

Deno.test("underage_no_expone_el_detail_crudo_de_la_fila", async () => {
  const authAdmin = admin_create_error(
    'new row for relation "users" violates check constraint "users_mayoria_de_edad"\n' +
      "DETAIL:  Failing row contains (00000000-0000-0000-0000-000000000099, " +
      "usuario@correo.mx, +523312345678, Ana, García, 2015-01-01, ...).",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, "2015-01-01");
  no_string_leak(body, "usuario@correo.mx");
  no_string_leak(body, "Failing row contains");
});

Deno.test("error_generico_de_create_user_no_expone_el_mensaje_crudo_de_postgres", async () => {
  const mensaje_crudo_muy_especifico =
    "PGRST_INTERNAL_9f3a: connection reset by peer at socket 42";
  const authAdmin = admin_create_error(mensaje_crudo_muy_especifico);
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, mensaje_crudo_muy_especifico);
});

// ── IP del cliente ─────────────────────────────────────────────────────────

Deno.test("ip_x_forwarded_for_unica_se_pasa_a_register_atomic", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  await handler(post(PAYLOAD_VALIDO, { "x-forwarded-for": "189.203.10.55" }), {
    authAdmin,
    registrar,
  });
  assertEquals(registrar.calls[0].ip, "189.203.10.55");
});

Deno.test("ip_x_forwarded_for_csv_solo_pasa_la_primera_ip", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  await handler(
    post(PAYLOAD_VALIDO, {
      "x-forwarded-for": "187.213.225.127, 99.82.166.107",
    }),
    { authAdmin, registrar },
  );
  assertEquals(registrar.calls[0].ip, "187.213.225.127");
});

Deno.test("ip_sin_header_x_forwarded_for_pasa_null", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(registrar.calls[0].ip, null);
});

// ── Forma del error ─────────────────────────────────────────────────────────

Deno.test("error_siempre_tiene_forma_error_code_message", async () => {
  const res = await handler(post({}));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
