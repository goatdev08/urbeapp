// supabase/functions/update-lead-note/handler.test.ts
// Tests RED — subtareas 29.2/29.3 (fusionadas)
// Edge Function: update-lead-note/handler.ts
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net --allow-env supabase/functions/update-lead-note/handler.test.ts
//
// Mirror directo de update-lead-status/handler.test.ts, pero SIN validación de
// new_status/transiciones: solo lead_id + note. note="" es válido (limpia la nota).
//
// EDGE CASES (RED) — 29.2/29.3:
//
// ### CORS / Métodos HTTP
// - EC-1: OPTIONS → 200 con headers CORS
// - EC-2: GET/PUT/DELETE → 405
//
// ### Body / parse
// - EC-3: JSON inválido en body → 400
// - EC-4: falta lead_id → 400
// - EC-5: lead_id vacío "" → 400
// - EC-6: falta note (key ausente) → 400
// - EC-7: note no es string (número) → 400
//
// ### Edge case del PRD — nota vacía permitida
// - EC-8: note="" PERMITIDO → 200 (NO 400; limpia la nota)
//
// ### Auth — CallerVerifier DI
// - EC-9: sin Authorization header → 401 UNAUTHENTICATED
//
// ### Ownership / not-found — NoteUpdater DI
// - EC-10: agente no autorizado (noteUpdater → UNAUTHORIZED_AGENT) → 403
// - EC-11: lead no encontrado (noteUpdater → LEAD_NOT_FOUND) → 404
//
// ### DB failure → 500
// - EC-12: noteUpdater → DB_ERROR → 500
//
// ### Happy path
// - EC-13: éxito → 200 con body { lead: { id, internal_notes } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  NoteUpdater,
  UpdateLeadNoteDeps,
  UpdateLeadNoteParams,
  UpdateLeadNoteResult,
  UpdatedLead,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENT_ID = "00000000-0000-0000-0000-000000000001";
const LEAD_ID = "00000000-0000-0000-0000-000000000002";
const OTRO_USUARIO_ID = "00000000-0000-0000-0000-000000000099";

const LEAD_CON_NOTA: UpdatedLead = {
  id: LEAD_ID,
  internal_notes: "Cliente interesado, llamar la próxima semana",
};

const LEAD_SIN_NOTA: UpdatedLead = {
  id: LEAD_ID,
  internal_notes: null,
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

// ── Factories de fakes — NoteUpdater ──────────────────────────────────────────

interface FakeNoteUpdater extends NoteUpdater {
  calls: UpdateLeadNoteParams[];
}

function updater_ok(lead: UpdatedLead): FakeNoteUpdater {
  return {
    calls: [],
    update(params: UpdateLeadNoteParams): Promise<UpdateLeadNoteResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: true, lead });
    },
  } as FakeNoteUpdater;
}

function updater_no_agent(): FakeNoteUpdater {
  return {
    calls: [],
    update(params: UpdateLeadNoteParams): Promise<UpdateLeadNoteResult> {
      this.calls.push({ ...params });
      return Promise.resolve({
        ok: false,
        error_code: "UNAUTHORIZED_AGENT",
        message: "El caller no es el agente dueño del lead",
      });
    },
  } as FakeNoteUpdater;
}

function updater_not_found(): FakeNoteUpdater {
  return {
    calls: [],
    update(params: UpdateLeadNoteParams): Promise<UpdateLeadNoteResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: false, error_code: "LEAD_NOT_FOUND" });
    },
  } as FakeNoteUpdater;
}

function updater_db_error(): FakeNoteUpdater {
  return {
    calls: [],
    update(params: UpdateLeadNoteParams): Promise<UpdateLeadNoteResult> {
      this.calls.push({ ...params });
      return Promise.resolve({
        ok: false,
        error_code: "DB_ERROR",
        message: "Error de base de datos",
      });
    },
  } as FakeNoteUpdater;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_auth(body: unknown): Request {
  return new Request("http://localhost/update-lead-note", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-agent-jwt",
    },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/update-lead-note", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/update-lead-note", { method });
}

function deps(
  updater: NoteUpdater = updater_ok(LEAD_CON_NOTA),
  verifier: CallerVerifier = verifier_ok(),
): UpdateLeadNoteDeps {
  return { callerVerifier: verifier, noteUpdater: updater };
}

// ── Payloads base ─────────────────────────────────────────────────────────────

const PAYLOAD_CON_NOTA = { lead_id: LEAD_ID, note: "Cliente interesado, llamar la próxima semana" };
const PAYLOAD_NOTA_VACIA = { lead_id: LEAD_ID, note: "" };

// ── EC-1/EC-2: CORS / Métodos HTTP ────────────────────────────────────────────

Deno.test("EC-1_cors_options_preflight_retorna_200_con_headers", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(
    res.status >= 200 && res.status <= 204,
    true,
    "OPTIONS debe retornar 2xx (200 o 204)",
  );
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Falta header Access-Control-Allow-Origin en preflight OPTIONS",
  );
});

Deno.test("EC-2_metodo_get_retorna_405", async () => {
  const res = await handler(method_request("GET"));
  assertEquals(res.status, 405);
});

Deno.test("EC-2_metodo_put_retorna_405", async () => {
  const res = await handler(method_request("PUT"));
  assertEquals(res.status, 405);
});

Deno.test("EC-2_metodo_delete_retorna_405", async () => {
  const res = await handler(method_request("DELETE"));
  assertEquals(res.status, 405);
});

// ── EC-3..EC-7: Body / parse ──────────────────────────────────────────────────

Deno.test("EC-3_body_no_json_retorna_400", async () => {
  const req = new Request("http://localhost/update-lead-note", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: "esto no es json{{{",
  });
  const res = await handler(req, deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("EC-4_lead_id_ausente_retorna_400", async () => {
  const res = await handler(post_auth({ note: "una nota" }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("EC-5_lead_id_cadena_vacia_retorna_400", async () => {
  const res = await handler(post_auth({ lead_id: "", note: "una nota" }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("EC-6_note_ausente_key_no_presente_retorna_400", async () => {
  const res = await handler(post_auth({ lead_id: LEAD_ID }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("EC-7_note_no_es_string_numero_retorna_400", async () => {
  const res = await handler(post_auth({ lead_id: LEAD_ID, note: 42 }), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── EC-8: nota vacía "" PERMITIDA (limpia la nota) — NO es 400 ───────────────

Deno.test("EC-8_note_vacia_permitida_retorna_200_no_400", async () => {
  const res = await handler(post_auth(PAYLOAD_NOTA_VACIA), deps(updater_ok(LEAD_SIN_NOTA)));
  assertEquals(
    res.status,
    200,
    "note='' debe ser aceptada por el handler (limpia la nota), NUNCA 400",
  );
});

// ── EC-9: Auth — CallerVerifier ───────────────────────────────────────────────

Deno.test("EC-9_sin_authorization_header_retorna_401", async () => {
  const v = verifier_unauthenticated();
  const res = await handler(
    post_sin_auth(PAYLOAD_CON_NOTA),
    { callerVerifier: v, noteUpdater: updater_ok(LEAD_CON_NOTA) },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

// ── EC-10: Ownership — NoteUpdater DI ────────────────────────────────────────

Deno.test("EC-10_agente_no_autorizado_retorna_403", async () => {
  const u = updater_no_agent();
  const v = verifier_ok(OTRO_USUARIO_ID);
  const res = await handler(
    post_auth(PAYLOAD_CON_NOTA),
    { callerVerifier: v, noteUpdater: u },
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHORIZED_AGENT");
});

// ── EC-11: Not found ──────────────────────────────────────────────────────────

Deno.test("EC-11_lead_no_encontrado_retorna_404", async () => {
  const u = updater_not_found();
  const res = await handler(post_auth(PAYLOAD_CON_NOTA), deps(u));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "LEAD_NOT_FOUND");
});

// ── EC-12: DB failure → 500 ───────────────────────────────────────────────────

Deno.test("EC-12_noteUpdater_db_error_retorna_500", async () => {
  const u = updater_db_error();
  const res = await handler(post_auth(PAYLOAD_CON_NOTA), deps(u));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "DB_ERROR");
});

// ── EC-13: Happy path — éxito 200 con body { lead: { id, internal_notes } } ──

Deno.test("EC-13_exito_retorna_200_con_lead_id_e_internal_notes", async () => {
  const res = await handler(post_auth(PAYLOAD_CON_NOTA), deps(updater_ok(LEAD_CON_NOTA)));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.lead, "respuesta debe tener campo 'lead'");
  assertEquals(body.lead.id, LEAD_ID);
  assertEquals(
    body.lead.internal_notes,
    "Cliente interesado, llamar la próxima semana",
  );
});
