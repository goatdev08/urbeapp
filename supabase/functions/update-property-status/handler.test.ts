// supabase/functions/update-property-status/handler.test.ts
// Tests RED — subtarea 17.5
// Edge Function: update-property-status/handler.ts
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net supabase/functions/update-property-status/handler.test.ts
//         (desde el repo raíz, con DENO_DIR resuelto por el deno.json en supabase/functions/)
//
// EDGE CASES (RED) — 17.5:
//
// ### Happy path
// - draft→active sin closed_reason → 200 con propiedad actualizada
// - active→paused sin closed_reason → 200
// - paused→active sin closed_reason → 200
// - active→closed con closed_reason='rented' → 200
// - paused→closed con closed_reason='sold' → 200
// - updater llamado exactamente una vez en happy path
// - respuesta 200 contiene propiedad con nuevo status
// - respuesta 200 de cierre contiene closed_reason en la propiedad
//
// ### Shape exacto (riesgo #8 mock-vs-prod)
// - active→paused: updater recibe property_id exacto
// - active→paused: updater recibe new_status='paused'
// - active→paused: updater recibe closed_reason=null (no cierre → sin reason)
// - active→paused: updater recibe user_id del caller verificado
//
// ### CORS / Métodos HTTP
// - OPTIONS → 200 con header Access-Control-Allow-Origin
// - OPTIONS → header Access-Control-Allow-Methods presente
// - GET → 405
// - PUT → 405
//
// ### Body / parse
// - Body no-JSON → 400 INVALID_INPUT
// - Payload vacío {} → 400 INVALID_INPUT
// - property_id ausente → 400 INVALID_INPUT
// - new_status ausente → 400 INVALID_INPUT
// - property_id cadena vacía → 400 INVALID_INPUT
//
// ### Validación new_status (solo draft|active|paused|closed aceptados por esta EF)
// - new_status='pending_review' → 400 INVALID_INPUT (moderación; no manejable por esta EF)
// - new_status='suspended' → 400 INVALID_INPUT (moderación; no manejable por esta EF)
// - new_status='needs_changes' → 400 INVALID_INPUT (moderación; no manejable por esta EF)
//
// ### Invariante 🔒 closed_reason (migración 0005: property_closed_requires_reason)
// - new_status='closed' sin closed_reason → 400 (MISSING_CLOSED_REASON; no llama al updater)
// - new_status='closed' con closed_reason null explícito → 400 (MISSING_CLOSED_REASON)
// - new_status='closed' con closed_reason inválido ('abandonada') → 400 INVALID_INPUT
// - closed_reason presente cuando new_status!='closed' (active→paused con reason) → 400 INVALID_INPUT
//   [DECISIÓN: rechazar (400), no ignorar silenciosamente — indica confusión del caller]
//
// ### Transiciones inválidas (updater devuelve INVALID_TRANSITION → handler→400)
// - Transición inválida (closed→active): updater retorna INVALID_TRANSITION → 400
// - Transición inválida (draft→paused): updater retorna INVALID_TRANSITION → 400
// - Transición inválida (paused→draft): updater retorna INVALID_TRANSITION → 400
// - updater no es llamado cuando la validación in-memory falla (missing closed_reason)
//
// ### Auth — CallerVerifier DI
// - Sin Authorization header → 401 UNAUTHENTICATED
// - JWT inválido → 401 UNAUTHENTICATED
// - updater NO llamado si caller sin auth
//
// ### Ownership — PropertyStatusUpdater DI
// - Caller no es owner (updater→UNAUTHORIZED_OWNER) → 403
// - Caller no es owner: updater fue llamado (handler delegó, updater rechazó)
//
// ### Not found
// - property_id inexistente (updater→PROPERTY_NOT_FOUND) → 404
// - property_not_found: updater fue llamado exactamente una vez
//
// ### DB failure → 500
// - Updater falla (DB_ERROR) → 500 con { error: { code, message } }
// - Updater falla: updater fue llamado (distingue de validación/auth bloqueado)
//
// ### Forma del error
// - Toda respuesta de error tiene la forma { error: { code: string, message: string } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  ClosedReasonEnum,
  PropertyStatusEnum,
  PropertyStatusUpdater,
  UpdatePropertyStatusDeps,
  UpdatePropertyStatusParams,
  UpdatePropertyStatusResult,
  UpdatedProperty,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const PROPERTY_ID = "00000000-0000-0000-0000-000000000002";
const OTRO_USUARIO_ID = "00000000-0000-0000-0000-000000000099";

const PROPIEDAD_ACTIVA: UpdatedProperty = {
  id: PROPERTY_ID,
  status: "active",
  closed_reason: null,
};

const PROPIEDAD_PAUSADA: UpdatedProperty = {
  id: PROPERTY_ID,
  status: "paused",
  closed_reason: null,
};

const PROPIEDAD_CERRADA: UpdatedProperty = {
  id: PROPERTY_ID,
  status: "closed",
  closed_reason: "rented",
};

// ── Factories de fakes — CallerVerifier ───────────────────────────────────────

interface FakeCallerVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = OWNER_ID): FakeCallerVerifier {
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

// ── Factories de fakes — PropertyStatusUpdater ────────────────────────────────

interface FakePropertyStatusUpdater extends PropertyStatusUpdater {
  calls: UpdatePropertyStatusParams[];
}

function updater_ok(property: UpdatedProperty): FakePropertyStatusUpdater {
  return {
    calls: [],
    update(params: UpdatePropertyStatusParams): Promise<UpdatePropertyStatusResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true, property });
    },
  } as FakePropertyStatusUpdater;
}

function updater_no_owner(): FakePropertyStatusUpdater {
  return {
    calls: [],
    update(params: UpdatePropertyStatusParams): Promise<UpdatePropertyStatusResult> {
      this.calls.push(params);
      return Promise.resolve({
        ok: false,
        error_code: "UNAUTHORIZED_OWNER",
        message: "El caller no es el dueño de la propiedad",
      });
    },
  } as FakePropertyStatusUpdater;
}

function updater_not_found(): FakePropertyStatusUpdater {
  return {
    calls: [],
    update(params: UpdatePropertyStatusParams): Promise<UpdatePropertyStatusResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code: "PROPERTY_NOT_FOUND" });
    },
  } as FakePropertyStatusUpdater;
}

function updater_transicion_invalida(): FakePropertyStatusUpdater {
  return {
    calls: [],
    update(params: UpdatePropertyStatusParams): Promise<UpdatePropertyStatusResult> {
      this.calls.push(params);
      return Promise.resolve({
        ok: false,
        error_code: "INVALID_TRANSITION",
        message: "Transición de estado no permitida",
      });
    },
  } as FakePropertyStatusUpdater;
}

function updater_db_error(): FakePropertyStatusUpdater {
  return {
    calls: [],
    update(params: UpdatePropertyStatusParams): Promise<UpdatePropertyStatusResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code: "DB_ERROR", message: "Error de base de datos" });
    },
  } as FakePropertyStatusUpdater;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_auth(body: unknown): Request {
  return new Request("http://localhost/update-property-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-owner-jwt",
    },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/update-property-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/update-property-status", { method });
}

function deps(
  updater: PropertyStatusUpdater = updater_ok(PROPIEDAD_ACTIVA),
  verifier: CallerVerifier = verifier_ok(),
): UpdatePropertyStatusDeps {
  return { callerVerifier: verifier, propertyStatusUpdater: updater };
}

// ── Payloads base ─────────────────────────────────────────────────────────────

const PAYLOAD_A_ACTIVE = { property_id: PROPERTY_ID, new_status: "active" };
const PAYLOAD_A_PAUSED = { property_id: PROPERTY_ID, new_status: "paused" };
const PAYLOAD_A_CLOSED = {
  property_id: PROPERTY_ID,
  new_status: "closed",
  closed_reason: "rented",
};

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_draft_a_active_sin_closed_reason_retorna_200", async () => {
  const res = await handler(post_auth(PAYLOAD_A_ACTIVE), deps(updater_ok(PROPIEDAD_ACTIVA)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_active_a_paused_sin_closed_reason_retorna_200", async () => {
  const res = await handler(post_auth(PAYLOAD_A_PAUSED), deps(updater_ok(PROPIEDAD_PAUSADA)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_paused_a_active_sin_closed_reason_retorna_200", async () => {
  // Simula paused→active: updater devuelve propiedad con status=active
  const res = await handler(post_auth(PAYLOAD_A_ACTIVE), deps(updater_ok(PROPIEDAD_ACTIVA)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_active_a_closed_con_reason_rented_retorna_200", async () => {
  const cerrada: UpdatedProperty = { id: PROPERTY_ID, status: "closed", closed_reason: "rented" };
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "closed", closed_reason: "rented" }),
    deps(updater_ok(cerrada)),
  );
  assertEquals(res.status, 200);
});

Deno.test("happy_path_paused_a_closed_con_reason_sold_retorna_200", async () => {
  const cerrada: UpdatedProperty = { id: PROPERTY_ID, status: "closed", closed_reason: "sold" };
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "closed", closed_reason: "sold" }),
    deps(updater_ok(cerrada)),
  );
  assertEquals(res.status, 200);
});

Deno.test("happy_path_updater_llamado_exactamente_una_vez", async () => {
  const u = updater_ok(PROPIEDAD_ACTIVA);
  await handler(post_auth(PAYLOAD_A_ACTIVE), deps(u));
  assertEquals(u.calls.length, 1, "updater debe ser llamado exactamente una vez en el happy path");
});

Deno.test("happy_path_respuesta_contiene_propiedad_con_nuevo_status", async () => {
  const res = await handler(post_auth(PAYLOAD_A_PAUSED), deps(updater_ok(PROPIEDAD_PAUSADA)));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.property, "respuesta debe tener campo 'property'");
  assertEquals(body.property.status, "paused", "property.status debe ser el nuevo status");
});

Deno.test("happy_path_respuesta_cierre_contiene_closed_reason", async () => {
  const res = await handler(post_auth(PAYLOAD_A_CLOSED), deps(updater_ok(PROPIEDAD_CERRADA)));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.property.closed_reason, "rented", "property.closed_reason debe estar en la respuesta al cerrar");
});

// ── Shape exacto (riesgo #8: mock pasa, prod falla) ──────────────────────────
//
// Al hacer active→paused, el updater debe recibir exactamente:
//   property_id, user_id del caller, new_status='paused', closed_reason=null.
// Este grupo de tests protege contra divergencia mock/prod en el UPDATE shape.

Deno.test("shape_active_a_paused_updater_recibe_property_id_correcto", async () => {
  const u = updater_ok(PROPIEDAD_PAUSADA);
  const v = verifier_ok(OWNER_ID);
  await handler(post_auth(PAYLOAD_A_PAUSED), { callerVerifier: v, propertyStatusUpdater: u });
  assertEquals(u.calls.length, 1, "updater debe ser llamado");
  assertEquals(u.calls[0].property_id, PROPERTY_ID, "property_id debe llegar intacto al updater");
});

Deno.test("shape_active_a_paused_updater_recibe_new_status_paused", async () => {
  const u = updater_ok(PROPIEDAD_PAUSADA);
  await handler(post_auth(PAYLOAD_A_PAUSED), deps(u));
  assertEquals(
    u.calls[0].new_status,
    "paused" as PropertyStatusEnum,
    "new_status debe ser 'paused' en el update param — error aquí = handler no pasa bien el campo",
  );
});

Deno.test("shape_active_a_paused_updater_recibe_closed_reason_null", async () => {
  const u = updater_ok(PROPIEDAD_PAUSADA);
  await handler(post_auth(PAYLOAD_A_PAUSED), deps(u));
  assertEquals(
    u.calls[0].closed_reason,
    null,
    "closed_reason debe ser null para transición no-cierre — el handler no debe inyectar un valor por defecto",
  );
});

Deno.test("shape_active_a_paused_updater_recibe_user_id_del_caller", async () => {
  const u = updater_ok(PROPIEDAD_PAUSADA);
  const v = verifier_ok(OWNER_ID);
  await handler(post_auth(PAYLOAD_A_PAUSED), { callerVerifier: v, propertyStatusUpdater: u });
  assertEquals(
    u.calls[0].user_id,
    OWNER_ID,
    "user_id debe ser auth.uid() del caller verificado — no del payload ni hardcoded",
  );
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
    "Falta header Access-Control-Allow-Origin en preflight",
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

// ── Body / parse ──────────────────────────────────────────────────────────────

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const req = new Request("http://localhost/update-property-status", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: "esto no es json{{{",
  });
  const res = await handler(req, deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("payload_vacio_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth({}), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_ausente_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth({ new_status: "active" }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("new_status_ausente_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth({ property_id: PROPERTY_ID }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_id_cadena_vacia_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth({ property_id: "", new_status: "active" }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación new_status — solo draft|active|paused|closed aceptados ─────────
// pending_review, needs_changes, suspended → moderación, fuera del alcance de esta EF.

Deno.test("new_status_pending_review_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "pending_review" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("new_status_suspended_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "suspended" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("new_status_needs_changes_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "needs_changes" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Invariante 🔒 closed_reason (CHECK property_closed_requires_reason, migración 0005) ─────
// La EF valida en-memoria antes de llamar al updater, para retornar error claro y no
// depender de que la DB lo rechace con un mensaje críptico de constraint.

Deno.test("closed_sin_closed_reason_retorna_400", async () => {
  // active→closed sin closed_reason: viola invariante
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "closed" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  // code puede ser MISSING_CLOSED_REASON o INVALID_INPUT; ambos son 400 válidos
  assertEquals(typeof body.error.code, "string");
  assertExists(body.error.message);
});

Deno.test("closed_con_closed_reason_null_explicito_retorna_400", async () => {
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "closed", closed_reason: null }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(typeof body.error.code, "string");
});

Deno.test("closed_reason_invalido_retorna_400_invalid_input", async () => {
  // 'abandonada' no está en el enum rented|sold|withdrawn|expired
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "closed", closed_reason: "abandonada" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("closed_reason_en_transicion_no_cierre_retorna_400_invalid_input", async () => {
  // active→paused CON closed_reason: el campo no tiene sentido fuera de cierre.
  // DECISIÓN: rechazar con 400 (no ignorar silenciosamente) — indica confusión del caller.
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "paused", closed_reason: "rented" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("closed_sin_reason_updater_no_es_llamado", async () => {
  // Validación in-memory debe bloquearse ANTES de llamar al updater
  const u = updater_ok(PROPIEDAD_CERRADA);
  await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "closed" }),
    deps(u),
  );
  assertEquals(
    u.calls.length,
    0,
    "updater NO debe ser llamado cuando falla la validación in-memory de closed_reason",
  );
});

// ── Transiciones inválidas (updater devuelve INVALID_TRANSITION → handler → 400) ──
// El updater conoce el estado actual (lo consulta en DB) y valida la transición.
// El handler mapea INVALID_TRANSITION → 400 con code='INVALID_TRANSITION'.
//
// Transiciones probadas via fake updater (simula la DB rechazando):
//   closed→active  : cerrada no puede re-abrirse
//   draft→paused   : draft solo puede ir a active (publicar)
//   paused→draft   : no se puede volver a borrador

Deno.test("transicion_invalida_closed_a_active_retorna_400_invalid_transition", async () => {
  // Simula closed→active: updater lo rechaza porque está cerrada
  const u = updater_transicion_invalida();
  const res = await handler(post_auth(PAYLOAD_A_ACTIVE), deps(u));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
});

Deno.test("transicion_invalida_draft_a_paused_retorna_400_invalid_transition", async () => {
  // Simula draft→paused: updater lo rechaza (draft solo → active)
  const u = updater_transicion_invalida();
  const res = await handler(post_auth(PAYLOAD_A_PAUSED), deps(u));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
});

Deno.test("transicion_invalida_paused_a_draft_retorna_400_invalid_transition", async () => {
  // Simula paused→draft: no se puede volver a borrador
  const u = updater_transicion_invalida();
  const res = await handler(
    post_auth({ property_id: PROPERTY_ID, new_status: "draft" }),
    deps(u),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
});

Deno.test("transicion_invalida_updater_fue_llamado_una_vez", async () => {
  // Cuando el updater rechaza una transición, el handler lo llamó (delega la validación al updater)
  const u = updater_transicion_invalida();
  await handler(post_auth(PAYLOAD_A_ACTIVE), deps(u));
  assertEquals(
    u.calls.length,
    1,
    "updater debe ser llamado exactamente una vez incluso al rechazar la transición",
  );
});

// ── Auth — CallerVerifier ─────────────────────────────────────────────────────

Deno.test("sin_authorization_header_retorna_401_unauthenticated", async () => {
  const v = verifier_unauthenticated();
  const res = await handler(
    post_sin_auth(PAYLOAD_A_ACTIVE),
    { callerVerifier: v, propertyStatusUpdater: updater_ok(PROPIEDAD_ACTIVA) },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_retorna_401_unauthenticated", async () => {
  const v = verifier_unauthenticated();
  const res = await handler(
    post_auth(PAYLOAD_A_ACTIVE),
    { callerVerifier: v, propertyStatusUpdater: updater_ok(PROPIEDAD_ACTIVA) },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("unauthenticated_updater_no_es_llamado", async () => {
  // Sin autenticación, el updater no debe ser llamado (auth bloquea antes)
  const u = updater_ok(PROPIEDAD_ACTIVA);
  await handler(
    post_sin_auth(PAYLOAD_A_ACTIVE),
    { callerVerifier: verifier_unauthenticated(), propertyStatusUpdater: u },
  );
  assertEquals(
    u.calls.length,
    0,
    "updater NO debe ser llamado si el caller no está autenticado",
  );
});

// ── Ownership — PropertyStatusUpdater DI ─────────────────────────────────────

Deno.test("caller_no_es_owner_retorna_403_unauthorized_owner", async () => {
  // El updater detecta que user_id != owner_user_id y devuelve UNAUTHORIZED_OWNER
  const u = updater_no_owner();
  const v = verifier_ok(OTRO_USUARIO_ID); // usuario que no es el dueño
  const res = await handler(
    post_auth(PAYLOAD_A_ACTIVE),
    { callerVerifier: v, propertyStatusUpdater: u },
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHORIZED_OWNER");
});

Deno.test("caller_no_es_owner_updater_fue_llamado", async () => {
  // El handler delegó al updater; el updater es quien detectó que no es owner
  const u = updater_no_owner();
  const v = verifier_ok(OTRO_USUARIO_ID);
  await handler(post_auth(PAYLOAD_A_ACTIVE), { callerVerifier: v, propertyStatusUpdater: u });
  assertEquals(
    u.calls.length,
    1,
    "updater fue llamado exactamente una vez; el 403 viene del updater (ownership en DB), no del handler",
  );
});

// ── Not found ─────────────────────────────────────────────────────────────────

Deno.test("property_inexistente_retorna_404_property_not_found", async () => {
  const u = updater_not_found();
  const res = await handler(post_auth(PAYLOAD_A_ACTIVE), deps(u));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "PROPERTY_NOT_FOUND");
});

Deno.test("property_not_found_updater_fue_llamado_exactamente_una_vez", async () => {
  const u = updater_not_found();
  await handler(post_auth(PAYLOAD_A_ACTIVE), deps(u));
  assertEquals(u.calls.length, 1, "updater fue llamado antes de retornar 404");
});

// ── DB failure → 500 ──────────────────────────────────────────────────────────

Deno.test("fallo_del_updater_db_error_retorna_500", async () => {
  const u = updater_db_error();
  const res = await handler(post_auth(PAYLOAD_A_ACTIVE), deps(u));
  assertEquals(res.status, 500);
  assertEquals(u.calls.length, 1, "updater fue llamado antes del 500");
});

Deno.test("fallo_del_updater_respuesta_tiene_forma_error_code_message", async () => {
  const u = updater_db_error();
  const res = await handler(post_auth(PAYLOAD_A_ACTIVE), deps(u));
  assertEquals(u.calls.length, 1, "updater fue llamado");
  const body = await res.json();
  assertExists(body.error, "Error 500 debe tener cuerpo { error: { code, message } }");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertExists(body.error.message, "error.message debe estar presente");
});

// ── Forma del error — invariante global ──────────────────────────────────────

Deno.test("error_respuesta_payload_vacio_tiene_forma_error_code_message", async () => {
  // Toda respuesta de error debe ser { error: { code: string, message: string } }
  const res = await handler(post_auth({}), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error, "La respuesta de error no contiene 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});

Deno.test("error_401_tiene_forma_error_code_message", async () => {
  const res = await handler(
    post_sin_auth(PAYLOAD_A_ACTIVE),
    { callerVerifier: verifier_unauthenticated(), propertyStatusUpdater: updater_ok(PROPIEDAD_ACTIVA) },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error);
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
