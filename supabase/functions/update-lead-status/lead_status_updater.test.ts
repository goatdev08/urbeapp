// supabase/functions/update-lead-status/lead_status_updater.test.ts
// Tests del LeadStatusUpdater REAL (make_lead_status_updater).
// Ejerce la lógica de dominio que los tests DI del handler nunca pueden ver:
//   - transiciones LIBRES (subtarea 75.1 — VALID_TRANSITIONS desaparece; ver bloque
//     "Transiciones LIBRES" más abajo; RED hoy porque el gate viejo sigue activo)
//   - diferenciación LEAD_NOT_FOUND vs UNAUTHORIZED_AGENT (las dos queries reales)
//   - shape exacto del UPDATE payload (status, updated_at, internal_notes, eq de agent_id)
//
// Técnica: fake supabase client chainable con cola de respuestas por llamada `.from()`.
// Cada `from()` consume el siguiente response de la cola y captura lo que se pasa
// a `.update()` y `.eq()` para verificar el contrato con la DB.
//
// Fuente de verdad del enum HOY (migración 0001), 7 valores — el GREEN de 75.1 le
// agrega 4 (whatsapp_opened, interested, closed_won_rent, closed_won_sale) sin
// quitar ninguno (Postgres no puede vaciar un enum; ver pgTAP 28_lead_status_reconcile):
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

// ── Transiciones LIBRES — subtarea 75.1 (RED) ──────────────────────────────────
// Decisión del usuario: VALID_TRANSITIONS desaparece. Cualquier estado → cualquier
// estado, INCLUIDO reabrir un lead cerrado. El historial (pgTAP 28_*) registra cada
// cambio; el enforcement de "pasos" ya no vive en la DB ni en esta Edge Function.
// Los 4 casos con prefijo `_ejemplo_` son EXACTAMENTE los del enunciado de 75.1;
// los 3 con prefijo `_legacy_` repiten escenarios que ANTES estaban bloqueados
// (con valores del enum viejo) para probar que el gate realmente desapareció, no
// que solo se relajó para los estados nuevos.
//
// NOTA: "closed_won_rent"/"closed_won_sale"/"interested"/"whatsapp_opened" aún NO
// existen en el enum real de Postgres (eso lo agrega la migración GREEN, ver pgTAP
// 28_lead_status_reconcile_test.sql) — pero el fake client tipa sus respuestas como
// `unknown` y `make_params()` devuelve `any`, así que estos tests corren hoy sin
// error de compilación: fallan por ASERCIÓN (ok:false/INVALID_TRANSITION), no por
// tipos ni por import. `result.lead.status` se compara casteado a `string` porque
// el tipo actual de LeadStatusEnum (types.ts) todavía no incluye los 4 valores
// nuevos — ese archivo de tipos no se toca en RED (es contrato de producción).

Deno.test("updater_real_ejemplo_closed_won_rent_a_contacted_permite_la_transicion", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "closed_won_rent" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("contacted"));

  assertEquals(result.ok, true, "closed_won_rent→contacted debe aceptarse (transiciones libres)");
  if (result.ok) assertEquals(result.lead.status as string, "contacted");
});

Deno.test("updater_real_ejemplo_closed_lost_a_interested_permite_la_transicion", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "closed_lost" }, error: null },
    { data: { id: LEAD_ID, status: "interested", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("interested"));

  assertEquals(result.ok, true, "closed_lost→interested debe aceptarse (reabrir un lead cerrado)");
  if (result.ok) assertEquals(result.lead.status as string, "interested");
});

Deno.test("updater_real_ejemplo_discarded_a_whatsapp_opened_permite_la_transicion", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "discarded" }, error: null },
    { data: { id: LEAD_ID, status: "whatsapp_opened", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("whatsapp_opened"));

  assertEquals(result.ok, true, "discarded→whatsapp_opened debe aceptarse (discarded ya no es terminal)");
  if (result.ok) assertEquals(result.lead.status as string, "whatsapp_opened");
});

Deno.test("updater_real_ejemplo_whatsapp_opened_a_visit_scheduled_permite_la_transicion", async () => {
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "whatsapp_opened" }, error: null },
    { data: { id: LEAD_ID, status: "visit_scheduled", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("visit_scheduled"));

  assertEquals(result.ok, true, "whatsapp_opened→visit_scheduled debe aceptarse (salto de pasos permitido)");
  if (result.ok) assertEquals(result.lead.status as string, "visit_scheduled");
});

Deno.test("updater_real_legacy_closed_won_a_contacted_ya_no_es_INVALID_TRANSITION", async () => {
  // Antes de 75.1 este caso exacto devolvía INVALID_TRANSITION (closed_won era terminal).
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "closed_won" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("contacted"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_legacy_discarded_a_in_progress_ya_no_es_INVALID_TRANSITION", async () => {
  // Antes de 75.1: discarded era terminal — cero transiciones salientes.
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "discarded" }, error: null },
    { data: { id: LEAD_ID, status: "in_progress", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("in_progress"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_legacy_new_a_visit_scheduled_salto_de_pasos_ya_no_es_INVALID_TRANSITION", async () => {
  // Antes de 75.1: new→visit_scheduled saltaba 'contacted' e 'in_progress' → rechazado.
  const { client } = make_fake_client([
    { data: { id: LEAD_ID, status: "new" }, error: null },
    { data: { id: LEAD_ID, status: "visit_scheduled", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  const result = await updater.update(make_params("visit_scheduled"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_cualquier_transicion_siempre_llama_la_query_de_update", async () => {
  // Antes: una transición "inválida" cortaba camino tras 1 sola llamada a `.from()`.
  // Ahora: SIEMPRE hay 2 llamadas (existencia+ownership, luego UPDATE) sin importar
  // el estado actual — no queda ningún gate que corte antes del UPDATE.
  const { client, captured_calls } = make_fake_client([
    { data: { id: LEAD_ID, status: "closed_won" }, error: null },
    { data: { id: LEAD_ID, status: "contacted", internal_notes: null }, error: null },
  ]);
  const updater = make_lead_status_updater(client);
  await updater.update(make_params("contacted"));

  assertEquals(
    captured_calls.length,
    2,
    "debe haber 2 llamadas a .from() (existencia+ownership y UPDATE) incluso partiendo de un estado antes terminal",
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
