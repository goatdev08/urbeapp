// supabase/functions/update-lead-note/note_updater.test.ts
// Tests RED — subtareas 29.2/29.3 (fusionadas) + 75.6
// Edge Function: update-lead-note/note_updater.ts
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net --allow-env supabase/functions/update-lead-note/note_updater.test.ts
//
// Mirror directo de update-lead-status/lead_status_updater.test.ts, pero SIN
// la tabla VALID_TRANSITIONS (esta función nunca toca el status).
//
// EDGE CASES (RED) — 29.2/29.3:
//
// ### Happy path
// - NU-1: actualiza nota de lead propio → ok:true, lead.internal_notes = note
// - NU-8: nota larga (500 chars) → ok:true
// - NU-9: chars especiales/emoji → ok:true, preservados
//
// ### Edge cases del PRD / reglas no obvias
// - NU-2: nota vacía "" → ok:true, internal_notes = null (limpia)
// - NU-11: el UPDATE no incluye la columna status (el status nunca se toca)
//
// ### Ownership / not-found (dos queries reales)
// - NU-3: lead no existe (ambas queries vacías) → LEAD_NOT_FOUND
// - NU-4: lead existe pero de otro agente → UNAUTHORIZED_AGENT
//
// ### Boundary / error
// - NU-5: DB error en el SELECT → DB_ERROR
// - NU-6: DB error en el UPDATE → DB_ERROR
// - NU-7: UPDATE devuelve 0 filas (updated null) → DB_ERROR
// - NU-10: updated_at se envía en el UPDATE payload
//
// EDGE CASES (RED) — 75.6 (§19.7, bandera "en seguimiento" desde la app):
// SEAM: NoteUpdater.update() — mismo patrón "spread condicional" ya usado por
// lead_status_updater.ts:66-72 para `note`, replicado aquí para `is_follow_up`.
//
// ### Happy path — is_follow_up
// - NU-12: solo is_follow_up:true (sin note) → ok:true, activa la bandera,
//   el payload del UPDATE NO incluye la clave internal_notes (no la toca)
// - NU-13 [INVARIANTE]: solo note (sin is_follow_up) sigue funcionando igual
//   que antes — el payload del UPDATE NO incluye la clave is_follow_up
//   (no-regresión del contrato viejo, apps v1.0.3 en la calle)
// - NU-14: note E is_follow_up presentes a la vez → ambos se actualizan
//
// ### Regla no obvia — false NO es "ausente" (bug clásico del spread condicional)
// - NU-15: is_follow_up:false (sin note) → el payload SÍ incluye la clave
//   is_follow_up con el valor false explícito (nunca omitida por ser falsy)

import { assertEquals, assertExists } from "@std/assert";
import { make_note_updater } from "./note_updater.ts";
import type { UpdateLeadNoteParams } from "./types.ts";

// ── Fake client (mismo patrón que lead_status_updater.test.ts) ────────────────

interface FakeResponse {
  data: unknown;
  error: { message: string } | null;
}

interface CapturedCall {
  update_payload?: Record<string, unknown>;
  eq_calls: Array<[string, unknown]>;
}

/**
 * Crea un fake client chainable. Cada llamada a `.from()` consume el siguiente
 * response de `responses[]` y registra los `.eq()` y `.update()` en esa chain.
 *
 * ⚠️ Respeta el orden REAL de la cadena postgrest (verificado en
 * lead_status_updater.ts): SELECT = .from().select().eq().eq().maybeSingle();
 * UPDATE = .from().update().eq().eq().select().maybeSingle().
 */
function make_fake_client(responses: FakeResponse[]): {
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any };
  captured_calls: CapturedCall[];
} {
  let idx = 0;
  const captured_calls: CapturedCall[] = [];

  // deno-lint-ignore no-explicit-any
  function builder(response: FakeResponse, capture: CapturedCall): any {
    const b = {
      select(_cols?: string) { return this; },
      update(payload: Record<string, unknown>) {
        capture.update_payload = { ...payload };
        return this;
      },
      eq(col: string, val: unknown) {
        capture.eq_calls.push([col, val]);
        return this;
      },
      async maybeSingle() { return response; },
      async single() { return response; },
    };
    return b;
  }

  const client = {
    from(_table: string) {
      const i = idx++;
      const response = responses[i] ?? { data: null, error: null };
      const capture: CapturedCall = { eq_calls: [] };
      captured_calls.push(capture);
      return builder(response, capture);
    },
  };

  return { client, captured_calls };
}

// ── Constantes ────────────────────────────────────────────────────────────────

const LEAD_ID = "00000000-0000-0000-0000-000000000002";
const AGENT_ID = "00000000-0000-0000-0000-000000000001";

function make_params(note: string): { user_id: string; lead_id: string; note: string } {
  return { user_id: AGENT_ID, lead_id: LEAD_ID, note };
}

// ── NU-1: Happy path — actualiza nota de lead propio ─────────────────────────

Deno.test("NU-1_actualiza_nota_de_lead_propio_retorna_ok_true", async () => {
  const nota = "Cliente interesado, llamar la próxima semana";
  const { client } = make_fake_client([
    { data: { id: LEAD_ID }, error: null }, // ownership query
    { data: { id: LEAD_ID, internal_notes: nota }, error: null }, // UPDATE query
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params(nota));

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.lead.id, LEAD_ID);
    assertEquals(result.lead.internal_notes, nota);
  }
});

// ── NU-2: nota vacía "" limpia la nota (persiste null) ───────────────────────

Deno.test("NU-2_nota_vacia_limpia_la_nota_persiste_internal_notes_null", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: null }, error: null },
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params(""));

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(
      result.lead.internal_notes,
      null,
      "nota vacía debe limpiar la nota → internal_notes = null",
    );
  }
  assertEquals(
    captured_calls[1].update_payload?.internal_notes,
    null,
    ".update() debe recibir internal_notes=null cuando note es ''",
  );
});

// ── NU-3: lead no existe (ambas queries vacías) → LEAD_NOT_FOUND ─────────────

Deno.test("NU-3_lead_inexistente_devuelve_LEAD_NOT_FOUND", async () => {
  const { client } = make_fake_client([
    { data: null, error: null }, // ownership query
    { data: null, error: null }, // any_lead query
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params("una nota"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "LEAD_NOT_FOUND");
});

// ── NU-4: lead existe pero de otro agente → UNAUTHORIZED_AGENT ───────────────

Deno.test("NU-4_lead_de_otro_agente_devuelve_UNAUTHORIZED_AGENT", async () => {
  const { client } = make_fake_client([
    { data: null, error: null }, // ownership query: no encontrado con este agent_id
    { data: { id: LEAD_ID }, error: null }, // any_lead query: sí existe (de otro agente)
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params("una nota"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "UNAUTHORIZED_AGENT");
});

// ── NU-5: DB error en el SELECT → DB_ERROR ───────────────────────────────────

Deno.test("NU-5_db_error_en_select_devuelve_DB_ERROR", async () => {
  const { client } = make_fake_client([
    { data: null, error: { message: "connection refused" } },
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params("una nota"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "DB_ERROR");
});

// ── NU-6: DB error en el UPDATE → DB_ERROR ───────────────────────────────────

Deno.test("NU-6_db_error_en_update_devuelve_DB_ERROR", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID }, error: null }, // ownership query ok
    { data: null, error: { message: "constraint violation" } }, // UPDATE falla
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params("una nota"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "DB_ERROR");
});

// ── NU-7: UPDATE devuelve 0 filas (updated null sin error) → DB_ERROR ────────

Deno.test("NU-7_update_sin_filas_afectadas_devuelve_DB_ERROR", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID }, error: null }, // ownership query ok
    { data: null, error: null }, // UPDATE no devolvió filas (RLS lo bloqueó silenciosamente)
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params("una nota"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "DB_ERROR");
});

// ── NU-8: nota larga (500 chars) → ok:true ───────────────────────────────────

Deno.test("NU-8_nota_larga_500_chars_retorna_ok_true", async () => {
  const nota_larga = "a".repeat(500);
  const { client } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: nota_larga }, error: null },
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params(nota_larga));

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.lead.internal_notes?.length, 500);
  }
});

// ── NU-9: chars especiales / emoji preservados ───────────────────────────────

Deno.test("NU-9_nota_con_emoji_y_chars_especiales_preservada", async () => {
  const nota_especial = "Cliente 🏠 muy interesado — llamó a las 3pm, dijo: \"sí, quiero verla\" 👍";
  const { client } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: nota_especial }, error: null },
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params(nota_especial));

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.lead.internal_notes, nota_especial);
  }
});

// ── NU-10: updated_at se envía en el UPDATE payload ──────────────────────────

Deno.test("NU-10_update_payload_incluye_updated_at", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: "nota" }, error: null },
  ]);
  const updater = make_note_updater(client);
  await updater.update(make_params("nota"));

  assertExists(
    captured_calls[1].update_payload?.updated_at,
    ".update() debe incluir updated_at para mantener la columna sincronizada",
  );
});

// ── NU-11: el UPDATE nunca toca la columna status ────────────────────────────

Deno.test("NU-11_update_payload_no_incluye_status", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: "nota" }, error: null },
  ]);
  const updater = make_note_updater(client);
  await updater.update(make_params("nota"));

  assertEquals(
    "status" in (captured_calls[1].update_payload ?? {}),
    false,
    "update-lead-note NUNCA debe tocar la columna status — solo internal_notes/updated_at",
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 75.6 — is_follow_up (§19.7): spread condicional, mismo patrón que
// lead_status_updater.ts:66-72 para `note`.
// ════════════════════════════════════════════════════════════════════════════

function make_follow_up_params(
  is_follow_up: boolean,
  note?: string,
): { user_id: string; lead_id: string; note?: string; is_follow_up: boolean } {
  return { user_id: AGENT_ID, lead_id: LEAD_ID, note, is_follow_up };
}

// ── NU-12: solo is_follow_up:true (sin note) — activa la bandera SIN tocar
//    internal_notes (el payload del UPDATE no debe incluir esa clave) ────────

Deno.test("NU-12_solo_is_follow_up_true_activa_la_bandera_sin_tocar_internal_notes", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID }, error: null }, // ownership query
    { data: { id: LEAD_ID, internal_notes: null, is_follow_up: true }, error: null }, // UPDATE query
  ]);
  const updater = make_note_updater(client);
  const params: UpdateLeadNoteParams = { user_id: AGENT_ID, lead_id: LEAD_ID, is_follow_up: true };
  const result = await updater.update(params);

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.lead.is_follow_up, true, "el lead retornado debe reflejar is_follow_up=true");
  }
  assertEquals(
    "internal_notes" in (captured_calls[1].update_payload ?? {}),
    false,
    "mandar solo is_follow_up NO debe incluir internal_notes en el payload del UPDATE (no tocarla)",
  );
  assertEquals(
    captured_calls[1].update_payload?.is_follow_up,
    true,
    ".update() debe recibir is_follow_up=true cuando params.is_follow_up es true",
  );
});

// ── NU-13 [INVARIANTE]: solo note (sin is_follow_up) sigue funcionando igual
//    que antes — el payload NO debe incluir is_follow_up (no-regresión del
//    contrato viejo; hay apps v1.0.3 en la calle que solo mandan `note`) ─────

Deno.test("NU-13_solo_note_sin_is_follow_up_no_incluye_is_follow_up_en_el_payload", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: "nota vieja" }, error: null },
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_params("nota vieja"));

  assertEquals(result.ok, true);
  assertEquals(
    "is_follow_up" in (captured_calls[1].update_payload ?? {}),
    false,
    "mandar solo note (contrato v1.0.3) NO debe incluir is_follow_up en el payload del UPDATE",
  );
});

// ── NU-14: note E is_follow_up presentes a la vez — ambos se actualizan ──────

Deno.test("NU-14_note_e_is_follow_up_presentes_actualiza_ambos", async () => {
  const nota = "Cliente pidió que le marquemos la próxima semana";
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: nota, is_follow_up: true }, error: null },
  ]);
  const updater = make_note_updater(client);
  const result = await updater.update(make_follow_up_params(true, nota));

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.lead.internal_notes, nota);
    assertEquals(result.lead.is_follow_up, true);
  }
  assertEquals(captured_calls[1].update_payload?.internal_notes, nota);
  assertEquals(captured_calls[1].update_payload?.is_follow_up, true);
});

// ── NU-15: is_follow_up:false (sin note) — `false` NO es "ausente"; el
//    payload debe incluir la clave con el valor false EXPLÍCITO. Este es el
//    test que mata el bug clásico de `if (params.is_follow_up)` en vez de
//    `if (params.is_follow_up !== undefined)` ──────────────────────────────

Deno.test("NU-15_is_follow_up_false_desactiva_la_bandera_no_se_confunde_con_ausente", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID }, error: null },
    { data: { id: LEAD_ID, internal_notes: null, is_follow_up: false }, error: null },
  ]);
  const updater = make_note_updater(client);
  const params: UpdateLeadNoteParams = { user_id: AGENT_ID, lead_id: LEAD_ID, is_follow_up: false };
  const result = await updater.update(params);

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.lead.is_follow_up, false, "el lead retornado debe reflejar is_follow_up=false");
  }
  assertEquals(
    "is_follow_up" in (captured_calls[1].update_payload ?? {}),
    true,
    "is_follow_up=false debe viajar EXPLÍCITO en el payload del UPDATE — omitirla sería el bug clásico del spread condicional con `if (value)`",
  );
  assertEquals(
    captured_calls[1].update_payload?.is_follow_up,
    false,
    "el valor en el payload debe ser exactamente false, no true ni undefined",
  );
});
