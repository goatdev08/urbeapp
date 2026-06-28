// supabase/functions/update-property-status/property_status_updater.test.ts
// Tests del PropertyStatusUpdater REAL (make_property_status_updater).
// Ejerce la lógica de dominio que los tests DI del handler nunca pueden ver:
//   - tabla VALID_TRANSITIONS (closed→active, draft→paused, paused→draft rechazados)
//   - diferenciación not-found vs unauthorized (las dos queries reales)
//   - shape exacto del UPDATE payload (status, closed_reason, eq de ownership)
//
// Técnica: fake supabase client chainable con cola de respuestas por llamada `.from()`.
// Cada `from()` consume el siguiente response de la cola y captura lo que se pasa
// a `.update()` y `.eq()` para verificar el contrato con la DB.

import { assertEquals } from "@std/assert";
import { make_property_status_updater } from "./property_status_updater.ts";

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
 * response de `responses[]` y registra los `.eq()` y `.update()` llamados en esa chain.
 *
 * Retorna:
 *   client         — duck-type compatible con make_property_status_updater
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

const PROPERTY_ID = "00000000-0000-0000-0000-000000000002";
const USER_ID = "00000000-0000-0000-0000-000000000001";

// deno-lint-ignore no-explicit-any
function make_params(new_status: string, closed_reason: string | null = null): any {
  return { user_id: USER_ID, property_id: PROPERTY_ID, new_status, closed_reason };
}

// ── Transiciones inválidas — verifican la tabla real VALID_TRANSITIONS ────────
// Si VALID_TRANSITIONS estuviera mal (p.ej. permitiera closed→active), estos tests fallarían.

Deno.test("updater_real_closed_a_active_devuelve_INVALID_TRANSITION", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "closed" }, error: null },
    // segunda query (update) nunca se llama — la transición se rechaza antes
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("active"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_draft_a_paused_devuelve_INVALID_TRANSITION", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "draft" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("paused"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_paused_a_draft_devuelve_INVALID_TRANSITION", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "paused" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("draft"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_invalid_transition_no_llama_segunda_query", async () => {
  // Si la transición es inválida, el updater debe retornar antes del UPDATE
  // → solo 1 llamada a `.from()` (la de la query de existencia+ownership)
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "closed" }, error: null },
    { data: { id: PROPERTY_ID, status: "active" }, error: null }, // nunca debería usarse
  ]);
  const updater = make_property_status_updater(client);
  await updater.update(make_params("active"));

  assertEquals(
    captured_calls.length,
    1,
    "solo debe haber 1 llamada a .from() cuando la transición es inválida (no llama al UPDATE)",
  );
});

// ── Ownership / Not found — las dos queries reales ───────────────────────────
// Verifica que el updater distingue correctamente not-found vs unauthorized.

Deno.test("updater_real_propiedad_de_otro_owner_devuelve_UNAUTHORIZED_OWNER", async () => {
  // Primera query (con owner filter): null = no encontrada con ese owner_user_id
  // Segunda query (sin owner filter): propiedad existe = es de otro dueño
  const { client } = make_fake_client([
    { data: null, error: null },                    // ownership query: no encontrada
    { data: { id: PROPERTY_ID }, error: null },    // any_prop query: sí existe
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("active"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "UNAUTHORIZED_OWNER");
});

Deno.test("updater_real_propiedad_inexistente_devuelve_PROPERTY_NOT_FOUND", async () => {
  // Ambas queries devuelven null: la propiedad no existe
  const { client } = make_fake_client([
    { data: null, error: null }, // ownership query
    { data: null, error: null }, // any_prop query
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("active"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "PROPERTY_NOT_FOUND");
});

// ── Shape exacto del UPDATE (riesgo #8: mock pasa, prod falla) ───────────────
// Verifica que el payload pasado al UPDATE y los .eq() de ownership son correctos.

Deno.test("updater_real_active_a_paused_update_payload_tiene_status_paused", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "paused", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("paused", null));

  assertEquals(result.ok, true);
  // captured_calls[1] = la segunda .from() = la UPDATE query
  assertEquals(
    captured_calls[1].update_payload?.status,
    "paused",
    ".update() debe recibir status='paused'",
  );
});

Deno.test("updater_real_active_a_paused_update_payload_closed_reason_es_null", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "paused", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  await updater.update(make_params("paused", null));

  assertEquals(
    captured_calls[1].update_payload?.closed_reason,
    null,
    ".update() debe recibir closed_reason=null para transición no-cierre",
  );
});

Deno.test("updater_real_active_a_closed_update_payload_closed_reason_rented", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "closed", closed_reason: "rented" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("closed", "rented"));

  assertEquals(result.ok, true);
  assertEquals(
    captured_calls[1].update_payload?.status,
    "closed",
    ".update() debe recibir status='closed'",
  );
  assertEquals(
    captured_calls[1].update_payload?.closed_reason,
    "rented",
    ".update() debe recibir closed_reason='rented'",
  );
});

Deno.test("updater_real_active_a_paused_update_eq_filtra_por_id_y_owner", async () => {
  // Verifica que el UPDATE incluye .eq('id', property_id) y .eq('owner_user_id', user_id)
  // para garantizar el CHECK de ownership en la DB (segunda línea de defensa vs RLS).
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "paused", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  await updater.update(make_params("paused", null));

  const eq_calls = captured_calls[1].eq_calls;
  const id_eq = eq_calls.find(([col]) => col === "id");
  const owner_eq = eq_calls.find(([col]) => col === "owner_user_id");

  assertEquals(
    id_eq?.[1],
    PROPERTY_ID,
    "UPDATE debe incluir .eq('id', property_id)",
  );
  assertEquals(
    owner_eq?.[1],
    USER_ID,
    "UPDATE debe incluir .eq('owner_user_id', user_id) — ownership como defensa en DB",
  );
});
