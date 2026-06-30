// supabase/functions/update-lead-status/lead_status_updater.test.ts
// Tests del LeadStatusUpdater REAL (make_lead_status_updater).
// Ejerce la lógica de dominio que los tests DI del handler nunca pueden ver:
//   - tabla VALID_TRANSITIONS (closed_won→*, discarded→*, skip-steps rechazados)
//   - diferenciación LEAD_NOT_FOUND vs UNAUTHORIZED_AGENT (las dos queries reales)
//   - shape exacto del UPDATE payload (status, updated_at, internal_notes, eq de agent_id)
//
// Técnica: fake supabase client chainable con cola de respuestas por llamada `.from()`.
// Cada `from()` consume el siguiente response de la cola y captura lo que se pasa
// a `.update()` y `.eq()` para verificar el contrato con la DB.
//
// Fuente de verdad del enum: migración 0001:
//   lead_status = ('new', 'contacted', 'in_progress', 'visit_scheduled',
//                  'closed_won', 'closed_lost', 'discarded')

import { assertEquals, assertExists } from "@std/assert";
import { make_lead_status_updater } from "./lead_status_updater.ts";

// ── Fake client ───────────────────────────────────────────────────────────────

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
 * Retorna:
 *   client         — duck-type compatible con make_lead_status_updater
 *   captured_calls — array indexado por orden de `.from()` calls (0=primera, 1=segunda...)
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
      is(_col: string, _val: unknown) { return this; },
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

// deno-lint-ignore no-explicit-any
function make_params(new_status: string, note?: string): any {
  return { user_id: AGENT_ID, lead_id: LEAD_ID, new_status, note };
}

// ── Transiciones inválidas — verifica la tabla real VALID_TRANSITIONS ─────────
// Los estados terminal (closed_won, closed_lost, discarded) no tienen transiciones salientes.
// Los saltos de etapa (new→visit_scheduled, contacted→closed_won) también deben rechazarse.

Deno.test("updater_real_closed_won_a_contacted_devuelve_INVALID_TRANSITION", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "closed_won" }, error: null },
    // UPDATE nunca se llama — la transición se rechaza antes
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("contacted"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_discarded_a_in_progress_devuelve_INVALID_TRANSITION", async () => {
  // discarded es terminal — ninguna transición saliente permitida
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "discarded" }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("in_progress"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_closed_lost_a_new_devuelve_INVALID_TRANSITION", async () => {
  // closed_lost es terminal — no se puede reabrir directamente
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "closed_lost" }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("new"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_new_a_visit_scheduled_salta_pasos_devuelve_INVALID_TRANSITION", async () => {
  // new → visit_scheduled salta 'contacted' e 'in_progress' — no permitido
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("visit_scheduled"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_contacted_a_closed_won_salta_pasos_devuelve_INVALID_TRANSITION", async () => {
  // contacted → closed_won salta 'in_progress' y 'visit_scheduled' — no permitido
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "contacted" }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("closed_won"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_invalid_transition_no_llama_query_update", async () => {
  // Transición inválida: el updater retorna antes del UPDATE
  // → solo 1 llamada a `.from()` (la de existencia+ownership), nunca la de UPDATE
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID, status: "closed_won" }, error: null },
    { data: { id: LEAD_ID, status: "contacted" }, error: null }, // nunca debería usarse
  ]);
  const updater = make_lead_status_updater(client);
  await updater.update(make_params("contacted"));

  assertEquals(
    captured_calls.length,
    1,
    "solo debe haber 1 llamada a .from() cuando la transición es inválida (no llama al UPDATE)",
  );
});

// ── Ownership / Not found — las dos queries reales ───────────────────────────
// Verifica que el updater distingue correctamente LEAD_NOT_FOUND vs UNAUTHORIZED_AGENT.

Deno.test("updater_real_lead_de_otro_agent_devuelve_UNAUTHORIZED_AGENT", async () => {
  // Primera query (con agent_id filter): null = no encontrado con ese agent_id
  // Segunda query (sin agent_id filter): lead existe = es de otro agente
  const { client } = make_fake_client([
    { data: null, error: null },                  // ownership query: no encontrado
    { data: { id: LEAD_ID }, error: null },       // any_lead query: sí existe
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("contacted"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "UNAUTHORIZED_AGENT");
});

Deno.test("updater_real_lead_inexistente_devuelve_LEAD_NOT_FOUND", async () => {
  // Ambas queries devuelven null: el lead no existe
  const { client } = make_fake_client([
    { data: null, error: null }, // ownership query
    { data: null, error: null }, // any_lead query
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("contacted"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "LEAD_NOT_FOUND");
});

// ── Shape exacto del UPDATE (riesgo mock-vs-prod) ─────────────────────────────
// Verifica que el payload del UPDATE y los .eq() de ownership son correctos.

Deno.test("updater_real_new_a_contacted_update_payload_tiene_status_contacted", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("contacted"));

  assertEquals(result.ok, true);
  // captured_calls[1] = la segunda .from() = la UPDATE query
  assertEquals(
    captured_calls[1].update_payload?.status,
    "contacted",
    ".update() debe recibir status='contacted'",
  );
});

Deno.test("updater_real_new_a_contacted_update_payload_tiene_updated_at", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  await updater.update(make_params("contacted"));

  assertExists(
    captured_calls[1].update_payload?.updated_at,
    ".update() debe incluir updated_at para mantener la columna sincronizada",
  );
});

Deno.test("updater_real_note_presente_update_payload_tiene_internal_notes", async () => {
  const nota = "Primera llamada exitosa";
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
    {
      data: { id: LEAD_ID, status: "contacted", internal_notes: nota },
      error: null,
    },
  ]);
  const updater = make_lead_status_updater(client);
  await updater.update(make_params("contacted", nota));

  assertExists(
    captured_calls[1].update_payload?.internal_notes,
    ".update() debe incluir internal_notes cuando note está presente",
  );
});

Deno.test("updater_real_note_ausente_update_payload_no_tiene_internal_notes", async () => {
  // Sin note: internal_notes no debe aparecer en el UPDATE (no sobreescribir con null)
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  await updater.update(make_params("contacted")); // sin note

  assertEquals(
    captured_calls[1].update_payload?.internal_notes,
    undefined,
    ".update() NO debe incluir internal_notes cuando note es undefined — no sobreescribir notas previas",
  );
});

Deno.test("updater_real_update_eq_filtra_por_id_y_agent_id", async () => {
  // Verifica que el UPDATE incluye .eq('id', lead_id) y .eq('agent_id', user_id)
  // para garantizar el check de ownership en la DB (segunda línea de defensa vs RLS).
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  await updater.update(make_params("contacted"));

  const eq_calls = captured_calls[1].eq_calls;
  const id_eq = eq_calls.find(([col]) => col === "id");
  const agent_eq = eq_calls.find(([col]) => col === "agent_id");

  assertEquals(
    id_eq?.[1],
    LEAD_ID,
    "UPDATE debe incluir .eq('id', lead_id)",
  );
  assertEquals(
    agent_eq?.[1],
    AGENT_ID,
    "UPDATE debe incluir .eq('agent_id', user_id) — ownership como defensa en DB",
  );
});

// ── Happy path updater ────────────────────────────────────────────────────────

Deno.test("updater_real_new_a_contacted_retorna_ok_true_con_lead", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("contacted"));

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.lead.id, LEAD_ID);
    assertEquals(result.lead.status, "contacted");
  }
});

Deno.test("updater_real_visit_scheduled_a_closed_won_retorna_ok_true", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "visit_scheduled" }, error: null },
    { data: { id: LEAD_ID, status: "closed_won", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("closed_won"));

  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.lead.status, "closed_won");
});
