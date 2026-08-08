// supabase/functions/update-lead-note/handler.test.ts
// Tests RED — subtareas 29.2/29.3 (fusionadas) + 75.6
// Edge Function: update-lead-note/handler.ts
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net --allow-env supabase/functions/update-lead-note/handler.test.ts
//
// Mirror directo de update-lead-status/handler.test.ts, pero SIN validación de
// new_status/transiciones: solo lead_id + note + is_follow_up (75.6).
// note="" es válido (limpia la nota).
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
// - EC-6: falta note Y falta is_follow_up (ninguno de los dos) → 400
//   (75.6: este caso hoy se llama "falta note" porque note era el único campo;
//   con is_follow_up opcional, el payload de este test — solo {lead_id} — es
//   EXACTAMENTE el caso "ninguno de los dos presente" del PRD §19.7. Sigue
//   siendo el mismo test, no se duplica — INVARIANTE tras 75.6.)
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
//
// EDGE CASES (RED) — 75.6 (§19.7, bandera "en seguimiento" desde la app):
// SEAM: contrato HTTP de POST /update-lead-note (request → status code → body).
//
// ### Happy path — is_follow_up
// - EC-14: solo is_follow_up:true (SIN note) → 200, NO envía `note` al
//   noteUpdater (no toca internal_notes), body.lead.is_follow_up === true
// - EC-15 [INVARIANTE]: solo note (SIN is_follow_up, contrato v1.0.3) sigue
//   dando 200 y NO envía `is_follow_up` al noteUpdater (no-regresión)
// - EC-16: note E is_follow_up presentes → 200, ambos se envían al
//   noteUpdater y ambos aparecen en el body de respuesta
//
// ### Frontera de confianza — is_follow_up con tipo inválido
// - EC-18: is_follow_up es un string ("true") → 400 INVALID_INPUT
// - EC-19: is_follow_up es un número (1) → 400 INVALID_INPUT
//
// ### Regla no obvia — false NO es "ausente"
// - EC-20: is_follow_up:false (SIN note) → 200 (NO 400), body.lead.is_follow_up
//   es estrictamente `false` (no `undefined`, no omitido)

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

// ════════════════════════════════════════════════════════════════════════════
// 75.6 — is_follow_up (§19.7): contrato HTTP de POST /update-lead-note
// ════════════════════════════════════════════════════════════════════════════

const PAYLOAD_SOLO_FOLLOW_UP_TRUE = { lead_id: LEAD_ID, is_follow_up: true };
const PAYLOAD_SOLO_FOLLOW_UP_FALSE = { lead_id: LEAD_ID, is_follow_up: false };
const PAYLOAD_NOTE_Y_FOLLOW_UP = {
  lead_id: LEAD_ID,
  note: "Muy interesado, dar seguimiento",
  is_follow_up: true,
};
const PAYLOAD_FOLLOW_UP_STRING_INVALIDO = { lead_id: LEAD_ID, note: "x", is_follow_up: "true" };
const PAYLOAD_FOLLOW_UP_NUMERO_INVALIDO = { lead_id: LEAD_ID, note: "x", is_follow_up: 1 };

const LEAD_CON_FOLLOW_UP_TRUE: UpdatedLead = {
  id: LEAD_ID,
  internal_notes: null,
  is_follow_up: true,
};
const LEAD_CON_FOLLOW_UP_FALSE: UpdatedLead = {
  id: LEAD_ID,
  internal_notes: null,
  is_follow_up: false,
};
const LEAD_CON_NOTA_Y_FOLLOW_UP: UpdatedLead = {
  id: LEAD_ID,
  internal_notes: "Muy interesado, dar seguimiento",
  is_follow_up: true,
};

// ── EC-14: solo is_follow_up:true (SIN note) — 200, NO toca internal_notes ───

Deno.test("EC-14_solo_is_follow_up_true_sin_note_retorna_200_sin_tocar_internal_notes", async () => {
  const u = updater_ok(LEAD_CON_FOLLOW_UP_TRUE);
  const res = await handler(post_auth(PAYLOAD_SOLO_FOLLOW_UP_TRUE), deps(u));

  assertEquals(res.status, 200, "mandar solo is_follow_up:true debe ser aceptado, nunca 400");
  const body = await res.json();
  assertEquals(body.lead.is_follow_up, true);

  assertEquals(u.calls.length, 1, "el handler debe delegar al noteUpdater");
  assertEquals(
    "note" in u.calls[0],
    false,
    "sin note en el body, el handler NO debe forwardear la clave note al noteUpdater (no tocar internal_notes)",
  );
  assertEquals(u.calls[0].is_follow_up, true);
});

// ── EC-15 [INVARIANTE]: solo note (contrato v1.0.3) — 200, NO envía
//    is_follow_up al noteUpdater (no-regresión, defensa a nivel handler) ─────

Deno.test("EC-15_solo_note_contrato_v1_0_3_sigue_funcionando_sin_enviar_is_follow_up", async () => {
  const u = updater_ok(LEAD_CON_NOTA);
  const res = await handler(post_auth(PAYLOAD_CON_NOTA), deps(u));

  assertEquals(res.status, 200);
  assertEquals(u.calls.length, 1);
  assertEquals(
    "is_follow_up" in u.calls[0],
    false,
    "una app v1.0.3 que solo manda note NO debe hacer que el handler envíe is_follow_up (evita resetear la bandera sin querer)",
  );
});

// ── EC-16: note E is_follow_up presentes — 200, ambos viajan y ambos vuelven ─

Deno.test("EC-16_note_e_is_follow_up_presentes_actualiza_ambos", async () => {
  const u = updater_ok(LEAD_CON_NOTA_Y_FOLLOW_UP);
  const res = await handler(post_auth(PAYLOAD_NOTE_Y_FOLLOW_UP), deps(u));

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.lead.internal_notes, "Muy interesado, dar seguimiento");
  assertEquals(body.lead.is_follow_up, true);

  assertEquals(u.calls[0].note, "Muy interesado, dar seguimiento");
  assertEquals(u.calls[0].is_follow_up, true);
});

// ── EC-18/EC-19: is_follow_up con tipo inválido — 400 INVALID_INPUT ──────────

Deno.test("EC-18_is_follow_up_string_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth(PAYLOAD_FOLLOW_UP_STRING_INVALIDO), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("EC-19_is_follow_up_numero_retorna_400_invalid_input", async () => {
  const res = await handler(post_auth(PAYLOAD_FOLLOW_UP_NUMERO_INVALIDO), deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── EC-20: is_follow_up:false (SIN note) — 200, NUNCA 400; el body refleja
//    `false` estricto (no confundir con ausente/undefined) ──────────────────

Deno.test("EC-20_is_follow_up_false_sin_note_retorna_200_y_el_body_refleja_false_estricto", async () => {
  const res = await handler(post_auth(PAYLOAD_SOLO_FOLLOW_UP_FALSE), deps(updater_ok(LEAD_CON_FOLLOW_UP_FALSE)));
  assertEquals(
    res.status,
    200,
    "is_follow_up:false debe ser aceptado (desactiva la bandera), NUNCA 400",
  );
  const body = await res.json();
  assertEquals(
    body.lead.is_follow_up,
    false,
    "el body debe reflejar is_follow_up=false EXACTO — no undefined, no omitido",
  );
});
