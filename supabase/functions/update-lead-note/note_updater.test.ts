// supabase/functions/update-lead-note/note_updater.test.ts
// Tests RED — subtareas 29.2/29.3 (fusionadas)
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

import { assertEquals, assertExists } from "@std/assert";
import { make_note_updater } from "./note_updater.ts";

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
