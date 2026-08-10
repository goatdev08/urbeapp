// supabase/functions/moderate-property/property_updater.test.ts
// Tests del PropertyUpdater REAL (make_property_updater, en _shared/clients.ts).
// Ejerce lo que handler.test.ts NO puede ver porque ahí propertyUpdater es un
// fake que acepta cualquier objeto: el shape EXACTO del payload que
// apply_revision_snapshot manda a `.update()`.
//
// Regresión (guardian, 73.9): apply_revision_snapshot hacía spread crudo de
// changed_fields — que es el EditPropertyInput COMPLETO que property_revisions
// guarda (73.6) e incluye `property_id` (types.ts:30). `properties` no tiene esa
// columna (usa `id`), así que el spread rompía TODO update con 500 DB_ERROR
// ("Could not find the 'property_id' column of 'properties' in the schema
// cache") — probado en vivo contra el stack local, no solo en teoría. Fix:
// proyectar al mismo whitelist que edit-property/index.ts:98-115.
//
// Técnica: mismo fake client chainable que
// update-property-status/property_status_updater.test.ts.

import { assertEquals, assertFalse } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { make_property_updater } from "../_shared/clients.ts";

// ── Fake client ───────────────────────────────────────────────────────────────

interface CapturedCall {
  update_payload?: Record<string, unknown>;
  eq_calls: Array<[string, unknown]>;
}

function make_fake_client(): {
  client: SupabaseClient;
  captured: CapturedCall;
} {
  const captured: CapturedCall = { eq_calls: [] };
  const client = {
    from(_table: string) {
      return {
        update(payload: Record<string, unknown>) {
          captured.update_payload = { ...payload };
          return this;
        },
        eq(col: string, val: unknown) {
          captured.eq_calls.push([col, val]);
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  // El adaptador real (make_property_updater) solo usa .from(...).update(...).eq(...)
  // — el resto de la superficie de SupabaseClient nunca se toca en este seam.
  return { client: client as unknown as SupabaseClient, captured };
}

const PROPERTY_ID = "00000000-0000-0000-0000-000000000002";

// Snapshot REALISTA: el EditPropertyInput COMPLETO tal como property_revisions
// lo guarda de verdad (73.6) — incluye property_id, la key que rompía el
// spread crudo. Los 12 campos editables + location, igual que
// edit-property/handler.ts arma el payload validado.
const REALISTIC_CHANGED_FIELDS = {
  property_id: PROPERTY_ID,
  operation_type: "sale",
  property_type: "casa",
  price: 4200000,
  bedrooms: 3,
  bathrooms: 2,
  square_meters: 180,
  address: "Av. Real 123",
  price_visible: true,
  pet_friendly: true,
  allows_no_guarantor: false,
  student_friendly: false,
  description: "Snapshot realista de property_revisions.changed_fields",
  location: "SRID=4326;POINT(-103.3496 20.6597)",
};

Deno.test("apply_revision_snapshot: property_id NUNCA viaja en el UPDATE payload (regresión guardian 73.9)", async () => {
  const { client, captured } = make_fake_client();
  const updater = make_property_updater(client);

  const result = await updater.apply_revision_snapshot(
    PROPERTY_ID,
    REALISTIC_CHANGED_FIELDS,
  );

  assertEquals(result.ok, true);
  assertFalse(
    Object.prototype.hasOwnProperty.call(captured.update_payload, "property_id"),
    "property_id no es columna de `properties` (usa `id`) — no debe viajar en el UPDATE",
  );
});

Deno.test("apply_revision_snapshot: proyecta exactamente el whitelist de edit-property/index.ts (12 campos + location + updated_at)", async () => {
  const { client, captured } = make_fake_client();
  const updater = make_property_updater(client);

  await updater.apply_revision_snapshot(PROPERTY_ID, REALISTIC_CHANGED_FIELDS);

  const keys = Object.keys(captured.update_payload!).sort();
  assertEquals(keys, [
    "address",
    "allows_no_guarantor",
    "bathrooms",
    "bedrooms",
    "description",
    "location",
    "operation_type",
    "pet_friendly",
    "price",
    "price_visible",
    "property_type",
    "square_meters",
    "student_friendly",
    "updated_at",
  ]);
});

Deno.test("apply_revision_snapshot: los valores del whitelist se copian tal cual del snapshot", async () => {
  const { client, captured } = make_fake_client();
  const updater = make_property_updater(client);

  await updater.apply_revision_snapshot(PROPERTY_ID, REALISTIC_CHANGED_FIELDS);

  assertEquals(captured.update_payload?.price, 4200000);
  assertEquals(captured.update_payload?.description, REALISTIC_CHANGED_FIELDS.description);
  assertEquals(captured.update_payload?.operation_type, "sale");
  assertEquals(captured.update_payload?.location, REALISTIC_CHANGED_FIELDS.location);
});

Deno.test("apply_revision_snapshot: sin `location` en el snapshot, no se incluye en el UPDATE (no pisa coordenadas)", async () => {
  const { client, captured } = make_fake_client();
  const updater = make_property_updater(client);

  const { location: _location, ...without_location } = REALISTIC_CHANGED_FIELDS;
  await updater.apply_revision_snapshot(PROPERTY_ID, without_location);

  assertFalse(
    Object.prototype.hasOwnProperty.call(captured.update_payload, "location"),
    "location ausente en el snapshot no debe forzarse a null/undefined en el UPDATE",
  );
});

Deno.test("apply_revision_snapshot: nunca incluye `status` (esa columna es de set_status, no de esta operación)", async () => {
  const { client, captured } = make_fake_client();
  const updater = make_property_updater(client);

  await updater.apply_revision_snapshot(PROPERTY_ID, REALISTIC_CHANGED_FIELDS);

  assertFalse(
    Object.prototype.hasOwnProperty.call(captured.update_payload, "status"),
  );
});

Deno.test("apply_revision_snapshot: filtra por id de la propiedad", async () => {
  const { client, captured } = make_fake_client();
  const updater = make_property_updater(client);

  await updater.apply_revision_snapshot(PROPERTY_ID, REALISTIC_CHANGED_FIELDS);

  assertEquals(captured.eq_calls, [["id", PROPERTY_ID]]);
});
