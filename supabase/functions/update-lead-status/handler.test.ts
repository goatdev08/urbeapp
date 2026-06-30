// supabase/functions/update-lead-status/handler.test.ts
// Tests RED — subtarea 15.6
// Edge Function: update-lead-status/handler.ts
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net supabase/functions/update-lead-status/handler.test.ts
//         (desde el repo raíz, con import map de supabase/functions/deno.json)
//
// EDGE CASES (RED) — 15.6:
//
// ### Happy path
// - new→contacted sin note → 200 con lead actualizado
// - contacted→in_progress sin note → 200
// - in_progress→visit_scheduled sin note → 200
// - visit_scheduled→closed_won sin note → 200
// - new→discarded sin note → 200
// - note opcional presente → 200, updater recibe note en params
// - updater llamado exactamente una vez en happy path
// - respuesta 200 contiene lead con nuevo status
//
// ### Shape exacto (riesgo mock-vs-prod)
// - updater recibe lead_id correcto
// - updater recibe new_status correcto
// - updater recibe user_id del caller verificado (no del payload)
// - updater recibe note cuando está presente en body
// - updater recibe note=undefined cuando ausente del body
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
// - lead_id ausente → 400 INVALID_INPUT
// - new_status ausente → 400 INVALID_INPUT
// - lead_id cadena vacía → 400 INVALID_INPUT
//
// ### Validación new_status (enum lead_status real de la DB — migración 0001)
// - new_status='qualified' → 400 INVALID_INPUT (no pertenece al enum real)
// - new_status='closed' → 400 INVALID_INPUT (es property_status, no lead_status)
// - new_status='unknown_xyz' → 400 INVALID_INPUT
// - new_status=número (42) → 400 INVALID_INPUT
//
// ### Transiciones inválidas (updater devuelve INVALID_TRANSITION → handler → 400)
// - updater retorna INVALID_TRANSITION → handler responde 400 INVALID_TRANSITION
// - updater llamado exactamente una vez cuando rechaza transición
//
// ### Auth — CallerVerifier DI
// - Sin Authorization header → 401 UNAUTHENTICATED
// - JWT inválido (verifier falla) → 401 UNAUTHENTICATED
// - updater NO llamado si caller sin auth
//
// ### Ownership — LeadStatusUpdater DI
// - Caller no es agent del lead (updater→UNAUTHORIZED_AGENT) → 403
// - updater fue llamado cuando retorna UNAUTHORIZED_AGENT
//
// ### Not found
// - lead_id inexistente (updater→LEAD_NOT_FOUND) → 404
// - updater fue llamado exactamente una vez antes del 404
//
// ### DB failure → 500
// - Updater falla (DB_ERROR) → 500 con { error: { code, message } }
//
// ### Forma del error
// - Toda respuesta de error tiene forma { error: { code: string, message: string } }
// - 401 tiene forma { error: { code, message } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  LeadStatusEnum,
  LeadStatusUpdater,
  UpdateLeadStatusDeps,
  UpdateLeadStatusParams,
  UpdateLeadStatusResult,
  UpdatedLead,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENT_ID = "00000000-0000-0000-0000-000000000001";
const LEAD_ID = "00000000-0000-0000-0000-000000000002";
const OTRO_USUARIO_ID = "00000000-0000-0000-0000-000000000099";

const LEAD_CONTACTADO: UpdatedLead = {
  id: LEAD_ID,
  status: "contacted",
  internal_notes: null,
};

const LEAD_EN_PROGRESO: UpdatedLead = {
  id: LEAD_ID,
  status: "in_progress",
  internal_notes: null,
};

const LEAD_VISITA_PROGRAMADA: UpdatedLead = {
  id: LEAD_ID,
  status: "visit_scheduled",
  internal_notes: null,
};

const LEAD_GANADO: UpdatedLead = {
  id: LEAD_ID,
  status: "closed_won",
  internal_notes: null,
};

const LEAD_DESCARTADO: UpdatedLead = {
  id: LEAD_ID,
  status: "discarded",
  internal_notes: null,
};

const LEAD_CON_NOTA: UpdatedLead = {
  id: LEAD_ID,
  status: "contacted",
  internal_notes: "Primera llamada exitosa",
};

// ── Factories de fakes — CallerVerifier ───────────────────────────────────────

interface FakeCallerVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = AGENT_ID): FakeCallerVerifier {
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

// ── Factories de fakes — LeadStatusUpdater ────────────────────────────────────

interface FakeLeadStatusUpdater extends LeadStatusUpdater {
  calls: UpdateLeadStatusParams[];
}

function updater_ok(lead: UpdatedLead): FakeLeadStatusUpdater {
  return {
    calls: [],
    update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: true, lead });
    },
  } as FakeLeadStatusUpdater;
}

function updater_no_agent(): FakeLeadStatusUpdater {
  return {
    calls: [],
    update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult> {
      this.calls.push({ ...params });
      return Promise.resolve({
        ok: false,
        error_code: "UNAUTHORIZED_AGENT",
        message: "El caller no es el agente dueño del lead",
      });
    },
  } as FakeLeadStatusUpdater;
}

function updater_not_found(): FakeLeadStatusUpdater {
  return {
    calls: [],
    update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: false, error_code: "LEAD_NOT_FOUND" });
    },
  } as FakeLeadStatusUpdater;
}

function updater_transicion_invalida(): FakeLeadStatusUpdater {
  return {
    calls: [],
    update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult> {
      this.calls.push({ ...params });
      return Promise.resolve({
        ok: false,
        error_code: "INVALID_TRANSITION",
        message: "Transición de estado no permitida",
      });
    },
  } as FakeLeadStatusUpdater;
}

function updater_db_error(): FakeLeadStatusUpdater {
  return {
    calls: [],
    update(params: UpdateLeadStatusParams): Promise<UpdateLeadStatusResult> {
      this.calls.push({ ...params });
      return Promise.resolve({
        ok: false,
        error_code: "DB_ERROR",
        message: "Error de base de datos",
      });
    },
  } as FakeLeadStatusUpdater;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_auth(body: unknown): Request {
  return new Request("http://localhost/update-lead-status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-agent-jwt",
    },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/update-lead-status", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/update-lead-status", { method });
}

function deps(
  updater: LeadStatusUpdater = updater_ok(LEAD_CONTACTADO),
  verifier: CallerVerifier = verifier_ok(),
): UpdateLeadStatusDeps {
  return { callerVerifier: verifier, leadStatusUpdater: updater };
}

// ── Payloads base ─────────────────────────────────────────────────────────────

const PAYLOAD_A_CONTACTED = { lead_id: LEAD_ID, new_status: "contacted" };
const PAYLOAD_A_IN_PROGRESS = { lead_id: LEAD_ID, new_status: "in_progress" };
const PAYLOAD_A_VISIT_SCHEDULED = { lead_id: LEAD_ID, new_status: "visit_scheduled" };
const PAYLOAD_A_CLOSED_WON = { lead_id: LEAD_ID, new_status: "closed_won" };
const PAYLOAD_A_DISCARDED = { lead_id: LEAD_ID, new_status: "discarded" };
const PAYLOAD_CON_NOTE = {
  lead_id: LEAD_ID,
  new_status: "contacted",
  note: "Primera llamada exitosa",
};

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_new_a_contacted_sin_note_retorna_200", async () => {
  const res = await handler(post_auth(PAYLOAD_A_CONTACTED), deps(updater_ok(LEAD_CONTACTADO)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_contacted_a_in_progress_sin_note_retorna_200", async () => {
  const res = await handler(post_auth(PAYLOAD_A_IN_PROGRESS), deps(updater_ok(LEAD_EN_PROGRESO)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_in_progress_a_visit_scheduled_sin_note_retorna_200", async () => {
  const res = await handler(
    post_auth(PAYLOAD_A_VISIT_SCHEDULED),
    deps(updater_ok(LEAD_VISITA_PROGRAMADA)),
  );
  assertEquals(res.status, 200);
});

Deno.test("happy_path_visit_scheduled_a_closed_won_sin_note_retorna_200", async () => {
  const res = await handler(post_auth(PAYLOAD_A_CLOSED_WON), deps(updater_ok(LEAD_GANADO)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_new_a_discarded_sin_note_retorna_200", async () => {
  const res = await handler(post_auth(PAYLOAD_A_DISCARDED), deps(updater_ok(LEAD_DESCARTADO)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_note_opcional_presente_retorna_200", async () => {
  const res = await handler(post_auth(PAYLOAD_CON_NOTE), deps(updater_ok(LEAD_CON_NOTA)));
  assertEquals(res.status, 200);
});

Deno.test("happy_path_updater_llamado_exactamente_una_vez", async () => {
  const u = updater_ok(LEAD_CONTACTADO);
  await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
  assertEquals(
    u.calls.length,
    1,
    "updater debe ser llamado exactamente una vez en el happy path",
  );
});

Deno.test("happy_path_respuesta_contiene_lead_con_nuevo_status", async () => {
  const res = await handler(post_auth(PAYLOAD_A_CONTACTED), deps(updater_ok(LEAD_CONTACTADO)));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.lead, "respuesta debe tener campo 'lead'");
  assertEquals(
    body.lead.status,
    "contacted",
    "lead.status debe ser el nuevo status",
  );
});

// ── Shape exacto (riesgo mock-vs-prod) ───────────────────────────────────────
//
// Al hacer new→contacted, el updater debe recibir exactamente:
//   lead_id, user_id del caller verificado, new_status='contacted', note=undefined.
// Este grupo protege contra divergencia mock/prod en el UPDATE shape.

Deno.test("shape_updater_recibe_lead_id_correcto", async () => {
  const u = updater_ok(LEAD_CONTACTADO);
  const v = verifier_ok(AGENT_ID);
  await handler(post_auth(PAYLOAD_A_CONTACTED), { callerVerifier: v, leadStatusUpdater: u });
  assertEquals(u.calls.length, 1, "updater debe ser llamado");
  assertEquals(
    u.calls[0].lead_id,
    LEAD_ID,
    "lead_id debe llegar intacto al updater",
  );
});

Deno.test("shape_updater_recibe_new_status_correcto", async () => {
  const u = updater_ok(LEAD_CONTACTADO);
  await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
  assertEquals(
    u.calls[0].new_status,
    "contacted" as LeadStatusEnum,
    "new_status debe ser 'contacted' — error aquí = handler no pasa bien el campo",
  );
});

Deno.test("shape_updater_recibe_user_id_del_caller_verificado", async () => {
  const u = updater_ok(LEAD_CONTACTADO);
  const v = verifier_ok(AGENT_ID);
  await handler(post_auth(PAYLOAD_A_CONTACTED), { callerVerifier: v, leadStatusUpdater: u });
  assertEquals(
    u.calls[0].user_id,
    AGENT_ID,
    "user_id debe ser auth.uid() del caller verificado — nunca del payload ni hardcoded",
  );
});

Deno.test("shape_updater_recibe_note_cuando_presente_en_body", async () => {
  const u = updater_ok(LEAD_CON_NOTA);
  await handler(post_auth(PAYLOAD_CON_NOTE), deps(u));
  assertEquals(
    u.calls[0].note,
    "Primera llamada exitosa",
    "note debe llegar al updater cuando está en el body",
  );
});

Deno.test("shape_updater_recibe_note_undefined_cuando_ausente_del_body", async () => {
  const u = updater_ok(LEAD_CONTACTADO);
  await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
  assertEquals(
    u.calls[0].note,
    undefined,
    "note debe ser undefined cuando no está en el body — no null ni cadena vacía",
  );
});

// ── CORS / Métodos HTTP ───────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(
    res.status >= 200 && res.status <= 204,
    true,
    "OPTIONS debe retornar 2xx (200 o 204)",
  );
});

Deno.test("cors_options_tiene_header_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Falta header Access-Control-Allow-Origin en preflight OPTIONS",
  );
});

Deno.test("cors_options_tiene_header_allow_methods", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Methods"),
    "Falta header Access-Control-Allow-Methods en preflight OPTIONS",
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
  const req = new Request("http://localhost/update-lead-status", {
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

Deno.test("lead_id_ausente_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth({ new_status: "contacted" }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("new_status_ausente_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth({ lead_id: LEAD_ID }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("lead_id_cadena_vacia_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth({ lead_id: "", new_status: "contacted" }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación new_status — solo valores del enum lead_status real ────────────
// La migración 0001 define: new, contacted, in_progress, visit_scheduled,
// closed_won, closed_lost, discarded.
// 'qualified', 'visit_done', 'negotiation', 'closed' NO existen en el schema.

Deno.test("new_status_qualified_retorna_400_invalid_input", async () => {
  // 'qualified' no está en el enum lead_status de la DB (está en la descripción del PRD pero
  // no fue creado en la migración 0001 — la DB es la fuente de verdad)
  const res = await handler(
    post_auth({ lead_id: LEAD_ID, new_status: "qualified" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("new_status_closed_retorna_400_invalid_input", async () => {
  // 'closed' es property_status, no lead_status
  const res = await handler(
    post_auth({ lead_id: LEAD_ID, new_status: "closed" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("new_status_unknown_xyz_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_auth({ lead_id: LEAD_ID, new_status: "unknown_xyz" }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("new_status_numero_retorna_400_invalid_input", async () => {
  const res = await handler(
    post_auth({ lead_id: LEAD_ID, new_status: 42 }),
    deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Transiciones inválidas (updater devuelve INVALID_TRANSITION → handler → 400) ──
// El updater conoce el estado actual (lo consulta en DB) y valida la transición.
// El handler mapea INVALID_TRANSITION → 400.

Deno.test("transicion_invalida_retorna_400_invalid_transition", async () => {
  // Simula que el updater rechaza la transición (e.g., closed_won→contacted)
  const u = updater_transicion_invalida();
  const res = await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_TRANSITION");
});

Deno.test("transicion_invalida_updater_fue_llamado_exactamente_una_vez", async () => {
  // El handler delegó al updater; el updater es quien rechaza la transición
  const u = updater_transicion_invalida();
  await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
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
    post_sin_auth(PAYLOAD_A_CONTACTED),
    { callerVerifier: v, leadStatusUpdater: updater_ok(LEAD_CONTACTADO) },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_retorna_401_unauthenticated", async () => {
  const v = verifier_unauthenticated();
  const res = await handler(
    post_auth(PAYLOAD_A_CONTACTED),
    { callerVerifier: v, leadStatusUpdater: updater_ok(LEAD_CONTACTADO) },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("unauthenticated_updater_no_es_llamado", async () => {
  // Sin autenticación, el updater no debe ser llamado (auth bloquea antes)
  const u = updater_ok(LEAD_CONTACTADO);
  await handler(
    post_sin_auth(PAYLOAD_A_CONTACTED),
    { callerVerifier: verifier_unauthenticated(), leadStatusUpdater: u },
  );
  assertEquals(
    u.calls.length,
    0,
    "updater NO debe ser llamado si el caller no está autenticado",
  );
});

// ── Ownership — LeadStatusUpdater DI ─────────────────────────────────────────

Deno.test("caller_no_es_agent_retorna_403_unauthorized_agent", async () => {
  // El updater detecta que user_id != agent_id y devuelve UNAUTHORIZED_AGENT
  const u = updater_no_agent();
  const v = verifier_ok(OTRO_USUARIO_ID); // usuario que no es el agente del lead
  const res = await handler(
    post_auth(PAYLOAD_A_CONTACTED),
    { callerVerifier: v, leadStatusUpdater: u },
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHORIZED_AGENT");
});

Deno.test("caller_no_es_agent_updater_fue_llamado", async () => {
  // El handler delegó al updater; el updater es quien detecta que no es agent
  const u = updater_no_agent();
  const v = verifier_ok(OTRO_USUARIO_ID);
  await handler(post_auth(PAYLOAD_A_CONTACTED), { callerVerifier: v, leadStatusUpdater: u });
  assertEquals(
    u.calls.length,
    1,
    "updater fue llamado exactamente una vez; el 403 viene del updater (ownership en DB), no del handler",
  );
});

// ── Not found ─────────────────────────────────────────────────────────────────

Deno.test("lead_inexistente_retorna_404_lead_not_found", async () => {
  const u = updater_not_found();
  const res = await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "LEAD_NOT_FOUND");
});

Deno.test("lead_not_found_updater_fue_llamado_exactamente_una_vez", async () => {
  const u = updater_not_found();
  await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
  assertEquals(u.calls.length, 1, "updater fue llamado antes de retornar 404");
});

// ── DB failure → 500 ──────────────────────────────────────────────────────────

Deno.test("fallo_del_updater_db_error_retorna_500", async () => {
  const u = updater_db_error();
  const res = await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
  assertEquals(res.status, 500);
  assertEquals(u.calls.length, 1, "updater fue llamado antes del 500");
});

Deno.test("fallo_del_updater_respuesta_tiene_forma_error_code_message", async () => {
  const u = updater_db_error();
  const res = await handler(post_auth(PAYLOAD_A_CONTACTED), deps(u));
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
    post_sin_auth(PAYLOAD_A_CONTACTED),
    { callerVerifier: verifier_unauthenticated(), leadStatusUpdater: updater_ok(LEAD_CONTACTADO) },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error, "Error 401 debe tener campo 'error'");
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
