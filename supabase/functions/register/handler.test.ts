// supabase/functions/register/handler.test.ts
//
// Tests RED v3 (mini-addendum) — subtarea 93.2 (Edge Function `register`, POST
// público sin JWT). El guardián dio PASS sobre el RED v2/GREEN con 3
// observaciones adicionales, fijadas aquí con tests ANTES de cerrar:
//   N1 (la importante): si register_atomic LANZA (no {ok:false}) DESPUÉS de
//     que createUser ya creó el usuario, la compensación deleteUser debe
//     seguir ejecutándose — hoy el catch global se salta la compensación por
//     completo y deja un usuario logueable sin los 4 consentimientos de
//     §5.5 (el hueco exacto que la tarea #93 existe para cerrar).
//   N2: el catch global de una excepción inesperada se registra con
//     console.error — hoy desaparece sin rastro.
//   N3: fechas imposibles que el regex YYYY-MM-DD deja pasar y que V8 "rola"
//     al mes siguiente en vez de devolver NaN ("2010-02-31" → parsea a
//     2010-03-03, NO NaN) deben rechazarse con 400 INVALID_INPUT sin llamar
//     createUser; un bisiesto real ("2008-02-29") NO debe rechazarse.
//
// Tests RED v2 — subtarea 93.2 (Edge Function `register`, POST público sin JWT).
// Framework: Deno.test + std/assert. DI puro (mirror de
// ../redeem-invitation/{index.test.ts,redeem_flow.test.ts}): fakes de
// RegisterAuthAdmin/RegisterAtomicRunner/phone_exists como funciones simples
// que graban llamadas — sin supabase-js, sin red.
//
// RENEGOCIACIÓN 2026-07-30 (hallazgo del guardián contra el stack local con
// deps REALES): el bloque original "mapeo sanitizado de errores de
// createUser" fijaba un contrato IMPOSIBLE. Evidencia empírica:
//   - Email duplicado real: AuthApiError con message "A user with this email
//     address has already been registered" (nótese: NO contiene la substring
//     contigua "already registered" — "been" se interpone) y, en versiones
//     nuevas de GoTrue, code "email_exists".
//   - Teléfono duplicado y menor de edad: GoTrue SIEMPRE colapsa la violación
//     del trigger handle_new_user en un 500 genérico "Database error creating
//     new user" — el nombre del índice/constraint (users_phone_unique_active,
//     users_mayoria_de_edad) JAMÁS llega en error.message. Las ramas del
//     handler que lo buscan ahí son código muerto.
// Contrato renegociado:
//   - UNDERAGE se valida en el handler ANTES de tocar createUser, a partir de
//     date_of_birth (edad >= 18 años AL DÍA DE HOY, boundary en UTC) → 422,
//     createUser NUNCA se llama.
//   - PHONE_TAKEN se resuelve con una nueva dep `phone_exists(phone)`
//     (SELECT propio, semántica del índice parcial users_phone_unique_active
//     — solo cuentas activas) consultada ANTES de createUser → 409 si existe,
//     createUser NUNCA se llama. La carrera residual cae en createUser
//     fallando con 500 AUTH_CREATE_FAILED genérico (backstop del CHECK/índice
//     de la DB, sin fuga).
//   - EMAIL_ALREADY_EXISTS reconoce AMBAS señales: code === "email_exists" O
//     message que contenga "already been registered" O "already registered".
//   - Cualquier otro error de createUser (incluido el 500 real de GoTrue
//     "Database error creating new user") → 500 AUTH_CREATE_FAILED con
//     mensaje ESTÁTICO.
// El resto de los 54 tests originales (validación §5.1 de formato, CORS,
// método HTTP, orquestación/compensación, IP, forma del error) queda igual.
//
// Contrato bajo test (PRD §5.1 y §5.5; contrato de 93.1 register_user_atomic
// — append-only, NO idempotente):
//   POST { email, password, first_name, last_name, phone, date_of_birth,
//          state_id, municipality_id } — TODOS obligatorios.
//   Happy path: authAdmin.createUser(...) con user_metadata EXACTA a lo que
//   lee handle_new_user (first_name, last_name, phone, date_of_birth,
//   state_id, municipality_id) y email_confirm:true → registrar.register_atomic
//   (user_id, ip) EXACTAMENTE UNA VEZ → 200 { user_id }.
//   Si register_atomic falla → compensación deleteUser(user_id); si la
//   compensación también falla, el error ORIGINAL de register_atomic sigue
//   subiendo (no se enmascara), y el fallo de la compensación se registra con
//   console.error (O2, sin enmascarar).
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
// ### ⭐ Validación de edad (UNDERAGE, renegociada — YA NO es mapeo de createUser)
// - date_of_birth de alguien que cumple 17 años HOY → 422 UNDERAGE,
//   createUser NUNCA se llama
// - date_of_birth de alguien que cumple EXACTAMENTE 18 años HOY → pasa la
//   validación (boundary inclusive, mismo criterio que el CHECK
//   users_mayoria_de_edad: "hace 18 años o más")
// - date_of_birth de alguien a quien le faltan 18 años MENOS UN DÍA (cumple
//   18 mañana) → 422 UNDERAGE
//
// ### ⭐ PHONE_TAKEN vía pre-check `phone_exists` (renegociado — YA NO es
//     mapeo de createUser, porque GoTrue nunca expone el índice violado)
// - phone_exists(phone) resuelve true → 409 PHONE_TAKEN, createUser NUNCA se llama
// - phone_exists(phone) resuelve false → continúa el flujo normal (createUser SÍ se llama)
// - phone_exists se consulta ANTES que createUser (orden verificado)
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
// - (O2) si deleteUser falla, el fallo se registra con console.error — sin
//   enmascarar el error original que sigue subiendo
//
// ### Mapeo sanitizado de errores de createUser (renegociado)
// - message "A user with this email address has already been registered"
//   (mensaje REAL de GoTrue) → EMAIL_ALREADY_EXISTS, 409
// - message "User already registered" (variante corta) → EMAIL_ALREADY_EXISTS, 409
// - code "email_exists" (con message NO relacionado) → EMAIL_ALREADY_EXISTS, 409
// - message "Database error creating new user" (mensaje REAL de GoTrue para
//   teléfono duplicado / menor de edad / cualquier violación del trigger) →
//   500 AUTH_CREATE_FAILED genérico
// - mensaje crudo desconocido/inesperado → 500, código genérico (no expone el mensaje)
//
// ### ⭐ ASSERT CENTRAL (hueco 2) — no-contención de datos sensibles en errores
// - Body del pre-check PHONE_TAKEN NO contiene el teléfono consultado
// - Body de EMAIL_ALREADY_EXISTS NO contiene el email
// - Body de un error 500 genérico de createUser NO contiene el mensaje crudo
//   de Postgres/GoTrue tal cual llegó
//
// ### (O1) Rama scaffold sin deps — no debe filtrar credenciales
// - handler(req) SIN deps con payload válido → el body de respuesta NO
//   contiene el password ni el payload completo serializado tal cual
//
// ### (O3) Una dependencia LANZA (en vez de devolver {error}) → no debe
//     filtrar el texto de la excepción; conserva forma {error:{code,message}}
// - authAdmin.createUser rechaza (throw) → 500 con mensaje ESTÁTICO, el texto
//   de la excepción NO aparece en el body
// - registrar.register_atomic rechaza (throw) → 500 con mensaje ESTÁTICO, el
//   texto de la excepción NO aparece en el body
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

// ── Helpers de fecha (boundary de mayoría de edad, UTC) ─────────────────────
// Mismo criterio que el CHECK users_mayoria_de_edad (migración
// 20260727000002): "hace 18 años o más" evaluado con current_date. Se computa
// en UTC (mismo patrón que validate_birthdate en mobile/src/features/auth/
// validation.ts) para que el test sea determinista sin importar el huso
// horario de la máquina que lo corre.

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function format_utc_date(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${
    pad2(d.getUTCDate())
  }`;
}

/** date_of_birth de alguien que cumple `years` años HOY + `extra_days` días. */
function years_ago_utc(years: number, extra_days = 0): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear() - years,
      now.getUTCMonth(),
      now.getUTCDate() + extra_days,
    ),
  );
  return format_utc_date(d);
}

// Cumple 17 hoy → menor de edad.
const DOB_17_ANIOS_HOY = years_ago_utc(17);
// Cumple EXACTAMENTE 18 hoy → boundary inclusive, ya es mayor de edad.
const DOB_18_ANIOS_HOY = years_ago_utc(18);
// Cumplirá 18 MAÑANA (hoy tiene 17) → todavía menor de edad.
const DOB_18_ANIOS_MENOS_UN_DIA = years_ago_utc(18, 1);

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

function admin_create_error(message: string, code?: string): FakeAuthAdmin {
  return {
    create_calls: [],
    delete_calls: [],
    createUser(params: CreateUserParams): Promise<CreateUserResponse> {
      this.create_calls.push(params);
      return Promise.resolve({
        data: null,
        error: code !== undefined ? { message, code } : { message },
      });
    },
    deleteUser(uid: string): Promise<void> {
      this.delete_calls.push(uid);
      return Promise.resolve();
    },
  } as FakeAuthAdmin;
}

function admin_create_throws(message: string): FakeAuthAdmin {
  return {
    create_calls: [],
    delete_calls: [],
    createUser(params: CreateUserParams): Promise<CreateUserResponse> {
      this.create_calls.push(params);
      return Promise.reject(new Error(message));
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

function registrar_throws(message: string): FakeRegistrar {
  return {
    calls: [],
    register_atomic(
      params: RegisterAtomicParams,
    ): Promise<RegisterAtomicResult> {
      this.calls.push(params);
      return Promise.reject(new Error(message));
    },
  } as FakeRegistrar;
}

// ── Fake de la nueva dep `phone_exists` (renegociación 2026-07-30) ─────────

function phone_checker(exists: boolean): (phone: string) => Promise<boolean> {
  return (_phone: string) => Promise.resolve(exists);
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

// ── ⭐ N3 (addendum guardián): fechas imposibles que el regex deja pasar y V8
//     "rola" al mes siguiente en vez de devolver NaN — confirmado empíricamente:
//     new Date("2010-02-31T00:00:00Z") → 2010-03-03 (NO NaN). isNaN(Date.parse(...))
//     no las cacha, así que hoy pasan la validación y revientan en Postgres con
//     un 500 opaco en vez de un 400 claro.

Deno.test("validacion_date_of_birth_31_de_febrero_no_existe_retorna_400", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: "2010-02-31" }),
    { authAdmin, registrar },
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
  assertEquals(authAdmin.create_calls.length, 0);
});

Deno.test("validacion_date_of_birth_30_de_febrero_no_existe_retorna_400", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: "2027-02-30" }),
    { authAdmin, registrar },
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, "INVALID_INPUT");
  assertEquals(authAdmin.create_calls.length, 0);
});

Deno.test("validacion_date_of_birth_29_de_febrero_bisiesto_real_no_se_rechaza", async () => {
  // Control: 2008 SÍ fue bisiesto — esta fecha es válida y NO debe rechazarse
  // por "fecha imposible" (2008-02-29 ya cumple 18 años, así que el happy path
  // completo debe funcionar, no solo pasar la validación de formato).
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: "2008-02-29" }),
    { authAdmin, registrar },
  );
  assertEquals(res.status, 200);
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

// ── (O1) Rama scaffold sin deps: no debe filtrar credenciales ──────────────

Deno.test("scaffold_sin_deps_no_incluye_password_ni_el_payload_completo", async () => {
  const res = await handler(post(PAYLOAD_VALIDO));
  const body = await res.json();
  const serialized = JSON.stringify(body);
  assertEquals(
    serialized.includes(PAYLOAD_VALIDO.password),
    false,
    `El body sin deps NO debe contener el password, pero lo contiene: ${serialized}`,
  );
  assertEquals(
    serialized.includes(JSON.stringify(PAYLOAD_VALIDO)),
    false,
    "El body sin deps no debe echar el payload completo tal cual",
  );
});

// ── ⭐ Validación de edad (UNDERAGE) — renegociada, YA NO es mapeo de createUser ──
// GoTrue nunca expone el CHECK users_mayoria_de_edad violado (siempre colapsa
// en un 500 genérico), así que el handler debe rechazar ANTES de tocar
// createUser, calculando la edad de date_of_birth él mismo.

Deno.test("date_of_birth_17_anios_hoy_retorna_422_underage_sin_llamar_create_user", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: DOB_17_ANIOS_HOY }),
    { authAdmin, registrar },
  );
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "UNDERAGE");
  assertEquals(authAdmin.create_calls.length, 0);
});

Deno.test("date_of_birth_exactamente_18_anios_hoy_pasa_la_validacion_de_edad", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: DOB_18_ANIOS_HOY }),
    { authAdmin, registrar },
  );
  assertEquals(res.status, 200);
});

Deno.test("date_of_birth_18_anios_menos_un_dia_retorna_422_underage", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const res = await handler(
    post({ ...PAYLOAD_VALIDO, date_of_birth: DOB_18_ANIOS_MENOS_UN_DIA }),
    { authAdmin, registrar },
  );
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error.code, "UNDERAGE");
});

// ── ⭐ PHONE_TAKEN vía pre-check `phone_exists` — renegociado ────────────────
// GoTrue nunca expone el índice users_phone_unique_active violado, así que el
// handler consulta phone_exists ANTES de createUser en vez de parsear el
// mensaje de createUser.

Deno.test("phone_exists_true_retorna_409_phone_taken_sin_llamar_create_user", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const phone_exists = phone_checker(true);
  const res = await handler(post(PAYLOAD_VALIDO), {
    authAdmin,
    registrar,
    phone_exists,
  });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "PHONE_TAKEN");
  assertEquals(authAdmin.create_calls.length, 0);
});

Deno.test("phone_exists_false_continua_el_flujo_normal", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const phone_exists = phone_checker(false);
  const res = await handler(post(PAYLOAD_VALIDO), {
    authAdmin,
    registrar,
    phone_exists,
  });
  assertEquals(res.status, 200);
  assertEquals(authAdmin.create_calls.length, 1);
});

Deno.test("phone_exists_se_consulta_antes_que_create_user", async () => {
  const call_order: string[] = [];
  const authAdmin: RegisterAuthAdmin = {
    createUser(_params: CreateUserParams): Promise<CreateUserResponse> {
      call_order.push("create_user");
      return Promise.resolve({
        data: { user: { id: USER_ID } },
        error: null,
      });
    },
    deleteUser(_uid: string): Promise<void> {
      return Promise.resolve();
    },
  };
  const registrar = registrar_ok();
  const phone_exists = (_phone: string) => {
    call_order.push("phone_exists");
    return Promise.resolve(false);
  };
  await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar, phone_exists });
  assertEquals(call_order, ["phone_exists", "create_user"]);
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

// (O2) El fallo de la compensación se REGISTRA (console.error), no se ignora en silencio.
Deno.test("compensacion_fallida_se_registra_con_console_error_sin_enmascarar", async () => {
  const original_console_error = console.error;
  const console_error_calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    console_error_calls.push(args);
  };
  try {
    const authAdmin = admin_ok_but_delete_fails();
    const registrar = registrar_error("FIELDS_INCOMPLETE");
    const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error.code, "FIELDS_INCOMPLETE");
    assertEquals(
      console_error_calls.length > 0,
      true,
      "el fallo de deleteUser debe registrarse con console.error",
    );
  } finally {
    console.error = original_console_error;
  }
});

// ── Mapeo sanitizado de errores de createUser (renegociado 2026-07-30) ─────
// GoTrue real: email duplicado → message "A user with this email address has
// already been registered" (o code "email_exists"); CUALQUIER otra violación
// del trigger handle_new_user (teléfono duplicado, menor de edad) → SIEMPRE
// message "Database error creating new user", sin el nombre del índice/
// constraint. PHONE_TAKEN/UNDERAGE ya NO se detectan aquí (ver secciones
// dedicadas arriba).

Deno.test("create_user_email_duplicado_mensaje_real_gotrue_retorna_409", async () => {
  // Mensaje REAL verificado por el guardián contra GoTrue — nótese que NO
  // contiene la substring contigua "already registered" ("been" se interpone).
  const authAdmin = admin_create_error(
    "A user with this email address has already been registered",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "EMAIL_ALREADY_EXISTS");
});

Deno.test("create_user_email_duplicado_variante_corta_retorna_409", async () => {
  const authAdmin = admin_create_error("User already registered");
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "EMAIL_ALREADY_EXISTS");
});

Deno.test("create_user_email_duplicado_por_code_email_exists_retorna_409", async () => {
  // El message NO menciona "registered" a propósito: la detección debe
  // disparar por error.code, no solo por substring del mensaje.
  const authAdmin = admin_create_error(
    "Unable to validate email address: invalid format",
    "email_exists",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error.code, "EMAIL_ALREADY_EXISTS");
});

Deno.test("create_user_database_error_creating_new_user_retorna_500_generico", async () => {
  // Mensaje REAL que GoTrue devuelve SIEMPRE para violaciones de constraint
  // del trigger handle_new_user (teléfono duplicado, menor de edad, etc.) —
  // JAMÁS incluye el nombre del índice/constraint (evidencia del guardián).
  const authAdmin = admin_create_error("Database error creating new user");
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error.code, "AUTH_CREATE_FAILED");
});

Deno.test("create_user_error_desconocido_retorna_500", async () => {
  const authAdmin = admin_create_error("connection reset by peer");
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  assertExists((await res.json()).error.code);
});

// ── ⭐ ASSERT CENTRAL (hueco 2): no filtración de datos sensibles ─────────
// Reforzado sobre los caminos NUEVOS: el pre-check phone_exists y el 500
// genérico de createUser (ya no hay ruta de PHONE_TAKEN/UNDERAGE vía mensaje
// crudo de Postgres — GoTrue nunca lo expone).

Deno.test("phone_taken_precheck_no_expone_el_telefono_consultado", async () => {
  const authAdmin = admin_ok(), registrar = registrar_ok();
  const phone_exists = phone_checker(true);
  const res = await handler(post(PAYLOAD_VALIDO), {
    authAdmin,
    registrar,
    phone_exists,
  });
  const body = await res.json();
  no_string_leak(body, PAYLOAD_VALIDO.phone);
});

Deno.test("email_already_exists_no_expone_el_email", async () => {
  const authAdmin = admin_create_error(
    "A user with this email address has already been registered",
  );
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, PAYLOAD_VALIDO.email);
});

Deno.test(
  "database_error_creating_new_user_no_expone_el_mensaje_crudo_de_gotrue",
  async () => {
    const mensaje_crudo = "Database error creating new user";
    const authAdmin = admin_create_error(mensaje_crudo);
    const registrar = registrar_ok();
    const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
    const body = await res.json();
    // El código debe ser un código sanitizado nuestro (AUTH_CREATE_FAILED),
    // NUNCA el mensaje crudo de GoTrue reenviado como si fuera el "code".
    assertEquals(body.error.code, "AUTH_CREATE_FAILED");
    assertEquals(
      body.error.code === mensaje_crudo,
      false,
      "error.code no debe ser el mensaje crudo de GoTrue reenviado tal cual",
    );
  },
);

Deno.test("error_generico_de_create_user_no_expone_el_mensaje_crudo_de_postgres", async () => {
  // Defensa en profundidad: CUALQUIER mensaje no reconocido (no solo los
  // fixtures reales de GoTrue) nunca debe aparecer verbatim en el body.
  const mensaje_crudo_muy_especifico =
    "PGRST_INTERNAL_9f3a: connection reset by peer at socket 42";
  const authAdmin = admin_create_error(mensaje_crudo_muy_especifico);
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  const body = await res.json();
  no_string_leak(body, mensaje_crudo_muy_especifico);
});

// ── (O3) Una dependencia LANZA en vez de devolver {error} ──────────────────
// No debe filtrar el texto de la excepción; conserva forma {error:{code,message}}.

Deno.test("create_user_lanza_excepcion_retorna_500_estatico_sin_exponer_el_texto", async () => {
  const mensaje_interno_sensible =
    "ECONNRESET at pg_pool_internal.ts:88 (secret_debug_token=abc123)";
  const authAdmin = admin_create_throws(mensaje_interno_sensible);
  const registrar = registrar_ok();
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
  no_string_leak(body, mensaje_interno_sensible);
});

Deno.test("register_atomic_lanza_excepcion_retorna_500_estatico_sin_exponer_el_texto", async () => {
  const mensaje_interno_sensible =
    "connection terminated unexpectedly (pool=service_role, host=10.0.4.2)";
  const authAdmin = admin_ok();
  const registrar = registrar_throws(mensaje_interno_sensible);
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
  no_string_leak(body, mensaje_interno_sensible);
});

// ── ⭐ N1 (addendum guardián, la importante): si register_atomic LANZA
//     (después de que createUser YA creó el usuario), la compensación
//     deleteUser debe seguir ejecutándose — igual que en el camino
//     {ok:false}. Hoy el catch global se salta la compensación por completo:
//     queda un usuario logueable en auth.users SIN los 4 consentimientos de
//     §5.5 — exactamente el hueco que la tarea #93 existe para cerrar.
Deno.test("register_atomic_lanza_excepcion_igual_compensa_delete_user", async () => {
  const authAdmin = admin_ok();
  const registrar = registrar_throws("connection terminated unexpectedly");
  const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
  assertEquals(res.status, 500);
  assertEquals(
    authAdmin.delete_calls,
    [USER_ID],
    "register_atomic lanzando una excepción también debe compensar con deleteUser(user_id)",
  );
});

// ── ⭐ N2 (addendum guardián): el catch global de una excepción inesperada se
//     REGISTRA con console.error — hoy desaparece sin rastro (catch vacío que
//     solo retorna 500), mismo patrón de spy que la compensación fallida (O2).
Deno.test("catch_global_de_excepcion_inesperada_se_registra_con_console_error", async () => {
  const original_console_error = console.error;
  const console_error_calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    console_error_calls.push(args);
  };
  try {
    const authAdmin = admin_create_throws("boom_interno_inesperado");
    const registrar = registrar_ok();
    const res = await handler(post(PAYLOAD_VALIDO), { authAdmin, registrar });
    assertEquals(res.status, 500);
    assertEquals(
      console_error_calls.length > 0,
      true,
      "el catch global debe registrar la excepción inesperada con console.error",
    );
  } finally {
    console.error = original_console_error;
  }
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
