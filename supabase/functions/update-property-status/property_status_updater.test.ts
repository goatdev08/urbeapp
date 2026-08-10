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

import { assert, assertEquals } from "@std/assert";
import { make_property_status_updater, VALID_TRANSITIONS } from "./property_status_updater.ts";

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

// ── Cierre y baja (§16, subtarea 73.8) ────────────────────────────────────────
// Diseño: rented/sold pasan a ser new_status DIRECTO (ya no closed+closed_reason).
// Transición válida: active|paused|approved → rented|sold (el propio status ya es
// autodescriptivo → el UPDATE payload debe llevar closed_reason=null, no duplicar
// el motivo). Sin reapertura: ningún estado sale de rented/sold/closed (terminales).
// 'approved' (73.1/PRD §15.4) = aprobada pero aún no activa; también es origen válido.

// ── Happy path — active|paused|approved → rented|sold ────────────────────────

Deno.test("updater_real_active_a_rented_ok_true", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "rented", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("rented"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_active_a_rented_update_payload_status_rented", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "rented", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  await updater.update(make_params("rented"));

  assertEquals(
    captured_calls[1].update_payload?.status,
    "rented",
    ".update() debe recibir status='rented'",
  );
});

Deno.test("updater_real_active_a_rented_update_payload_closed_reason_null", async () => {
  // El status 'rented' ya es autodescriptivo — closed_reason NO debe duplicar el motivo.
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "rented", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  await updater.update(make_params("rented", null));

  assertEquals(
    captured_calls[1].update_payload?.closed_reason,
    null,
    ".update() debe recibir closed_reason=null al pasar a 'rented'",
  );
});

Deno.test("updater_real_active_a_sold_ok_true", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "sold", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("sold"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_active_a_sold_update_payload_status_sold", async () => {
  const { client, captured_calls } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "active" }, error: null },
    { data: { id: PROPERTY_ID, status: "sold", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  await updater.update(make_params("sold"));

  assertEquals(
    captured_calls[1].update_payload?.status,
    "sold",
    ".update() debe recibir status='sold'",
  );
});

Deno.test("updater_real_paused_a_rented_ok_true", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "paused" }, error: null },
    { data: { id: PROPERTY_ID, status: "rented", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("rented"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_paused_a_sold_ok_true", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "paused" }, error: null },
    { data: { id: PROPERTY_ID, status: "sold", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("sold"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_approved_a_rented_ok_true", async () => {
  // 'approved' (73.1/PRD §15.4): aprobada pero aún no activa (por fecha o pago).
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "approved" }, error: null },
    { data: { id: PROPERTY_ID, status: "rented", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("rented"));

  assertEquals(result.ok, true);
});

Deno.test("updater_real_approved_a_sold_ok_true", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "approved" }, error: null },
    { data: { id: PROPERTY_ID, status: "sold", closed_reason: null }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("sold"));

  assertEquals(result.ok, true);
});

// ── Ramas no obvias — no reapertura + no cierre prematuro ─────────────────────
// GUARD tests: hoy ya devuelven INVALID_TRANSITION porque 'pending_review'/'rented'/
// 'sold'/'draft' no son keys de VALID_TRANSITIONS (fallback undefined → rechazo).
// Se fijan explícitamente aquí para que la extensión de la tabla en GREEN no los rompa.

Deno.test("updater_real_pending_review_a_rented_devuelve_INVALID_TRANSITION", async () => {
  // No se puede marcar rented/sold algo que aún no está activo/aprobado.
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "pending_review" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("rented"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_draft_a_rented_devuelve_INVALID_TRANSITION", async () => {
  // draft debe publicarse (draft→active) antes de poder cerrarse por renta/venta.
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "draft" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("rented"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_rented_a_active_devuelve_INVALID_TRANSITION_no_reapertura", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "rented" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("active"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_rented_a_paused_devuelve_INVALID_TRANSITION_no_reapertura", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "rented" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("paused"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

Deno.test("updater_real_sold_a_active_devuelve_INVALID_TRANSITION_no_reapertura", async () => {
  const { client } = make_fake_client([
    { data: { id: PROPERTY_ID, status: "sold" }, error: null },
  ]);
  const updater = make_property_status_updater(client);
  const result = await updater.update(make_params("active"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

// ── #128: matriz completa — 17 estados del enum, cada uno con entrada EXPLÍCITA ──
// El bug: VALID_TRANSITIONS cubría 7 de 17 valores y el `?.` convertía cada key
// faltante en un INVALID_TRANSITION accidental (indistinguible de una decisión).
// Estos tests exigen que la tabla sea espejo 1:1 del enum property_status en DB
// (20260604000001 + 20260809000002) y fijan el contrato COMPLETO 17 orígenes × 6
// destinos que el cliente puede pedir. Agregar un valor al enum sin decidir su
// fila aquí = test rojo, no fallo silencioso en runtime.

// Espejo del enum property_status en DB — 7 originales + 10 operativos (73.1).
const ALL_PROPERTY_STATUSES = [
  "draft",
  "pending_review",
  "needs_changes",
  "active",
  "paused",
  "closed",
  "suspended",
  "uploading_media",
  "media_failed",
  "pending_payment",
  "approved",
  "expired",
  "rented",
  "sold",
  "rejected",
  "deleted_soft",
  "deleted_hard",
] as const;

Deno.test("valid_transitions_tiene_entrada_explicita_para_los_17_valores_del_enum", () => {
  for (const status of ALL_PROPERTY_STATUSES) {
    assert(
      Object.hasOwn(VALID_TRANSITIONS, status),
      `VALID_TRANSITIONS no tiene entrada para '${status}' — cada valor del enum ` +
        `property_status necesita una decisión explícita ([] cuenta, omisión no)`,
    );
  }
});

Deno.test("valid_transitions_no_tiene_keys_fuera_del_enum", () => {
  for (const key of Object.keys(VALID_TRANSITIONS)) {
    assert(
      (ALL_PROPERTY_STATUSES as readonly string[]).includes(key),
      `VALID_TRANSITIONS tiene la key '${key}' que no existe en el enum property_status`,
    );
  }
});

// Contrato completo: qué puede pedir el DUEÑO (vía esta EF) desde cada estado.
// Decisiones deliberadas (#128, alineadas al PRD §15.4/§16 y al guard de 73.8):
//   - Estados de moderación (pending_review, needs_changes, suspended, rejected):
//     los mueve moderate-property; el dueño NO tiene acciones aquí → [].
//   - Estados de pipeline (uploading_media, media_failed, pending_payment):
//     los mueve el flujo de media/pago, no el dueño → [].
//   - expired: la renovación regresa a pending_review vía flujo de pago (PRD §17),
//     no vía esta EF → [].
//   - Terminales (closed, rented, sold, deleted_soft, deleted_hard): sin reapertura
//     en MVP (PRD §16.1) → [].
//   - draft→active queda como comportamiento vigente; #131 decidirá si muere
//     (bypass de moderación). Al resolverse #131, cambiar SOLO esa celda aquí.
const EXPECTED_MATRIX: Record<string, string[]> = {
  draft: ["active"],
  pending_review: [],
  needs_changes: [],
  active: ["paused", "closed", "rented", "sold"],
  paused: ["active", "closed", "rented", "sold"],
  closed: [],
  suspended: [],
  uploading_media: [],
  media_failed: [],
  pending_payment: [],
  approved: ["rented", "sold"],
  expired: [],
  rented: [],
  sold: [],
  rejected: [],
  deleted_soft: [],
  deleted_hard: [],
};

// Destinos que el handler deja pasar al updater (VALID_STATUSES del handler).
const CLIENT_TARGETS = ["draft", "active", "paused", "closed", "rented", "sold"] as const;

Deno.test("matriz_17x6_contrato_completo_origen_x_destino", async () => {
  for (const origin of ALL_PROPERTY_STATUSES) {
    for (const target of CLIENT_TARGETS) {
      const expected_valid = EXPECTED_MATRIX[origin].includes(target);
      const { client } = make_fake_client([
        { data: { id: PROPERTY_ID, status: origin }, error: null },
        // segunda response solo se consume si la transición es válida (UPDATE)
        { data: { id: PROPERTY_ID, status: target, closed_reason: null }, error: null },
      ]);
      const updater = make_property_status_updater(client);
      const result = await updater.update(
        make_params(target, target === "closed" ? "withdrawn" : null),
      );

      assertEquals(
        result.ok,
        expected_valid,
        `${origin}→${target}: se esperaba ${expected_valid ? "VÁLIDA" : "INVALID_TRANSITION"}`,
      );
      if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
    }
  }
});
