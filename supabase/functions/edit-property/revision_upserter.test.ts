// supabase/functions/edit-property/revision_upserter.test.ts
// Tests RED — subtarea 73.6 (Re-revisión por edición, PRD §15.6)
// SUT: make_revision_upserter(client) en edit-property/revision_upserter.ts
//
// SEAM bajo test: el comportamiento REAL de upsert contra `property_revisions`
// — mismo patrón que _shared/duplicate_property_checker.test.ts (fake postgrest
// client con filtros aplicados EN el fake, in-memory, para poder afirmar sobre
// combinaciones realistas sin acoplarse al mecanismo SQL exacto).
//
// Invariante de fondo (73.2, ya migrada): índice único parcial — máximo 1
// revisión con status IN ('pending','needs_changes') activa por propiedad.
// El upsert debe RESPETAR esa invariante actualizando la fila activa existente
// en vez de intentar insertar una segunda (que la DB real rechazaría).
//
// Framework: Deno.test + @std/assert
// Ejecutar:
//   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//     --config deno.json edit-property/revision_upserter.test.ts
//
// ─── EDGE CASES CUBIERTOS ─────────────────────────────────────────────────
// - sin revisión activa previa → INSERT nueva fila con status='pending'
// - con revisión 'pending' existente → UPDATE la MISMA fila (mismo id), no inserta una segunda
// - con revisión 'needs_changes' existente → el nuevo submit la regresa a 'pending'
// - changed_fields de la fila actualizada refleja el snapshot MÁS RECIENTE (2º submit, no el 1º)
// - con revisión 'approved'/'rejected' (inactiva) → NO cuenta como activa, INSERT nueva fila
// - error de la query de búsqueda → {ok:false, error_code:'DB_ERROR'}, no lanza
// - error de la query de insert/update → {ok:false, error_code:'DB_ERROR'}, no lanza

import { assertEquals } from "@std/assert";
import { make_revision_upserter } from "./revision_upserter.ts";
import type { EditPropertyInput } from "./types.ts";

// ── Fila cruda simulada de public.property_revisions ──────────────────────────

interface RevisionRow {
  id: string;
  property_id: string;
  status: string;
  changed_fields: unknown;
  submitted_by: string;
  created_at: string;
  updated_at: string;
}

// ── Fake postgrest — filtros aplicados EN el fake, soporta select/update/insert ─

class FakeTable {
  rows: RevisionRow[];
  next_id = 1;
  constructor(rows: RevisionRow[]) {
    this.rows = rows;
  }
}

class FakeRevisionQueryBuilder {
  private table: FakeTable;
  private filtered: RevisionRow[];
  private mode: "select" | "update" | "insert" = "select";
  private update_payload: Partial<RevisionRow> | null = null;
  private insert_row: RevisionRow | null = null;
  private readonly _error: { message: string } | null;

  constructor(table: FakeTable, error: { message: string } | null) {
    this.table = table;
    this.filtered = table.rows;
    this._error = error;
  }

  select(_columns: string): this {
    return this;
  }

  eq(column: keyof RevisionRow, value: unknown): this {
    this.filtered = this.filtered.filter((r) => r[column] === value);
    return this;
  }

  in(column: keyof RevisionRow, values: string[]): this {
    this.filtered = this.filtered.filter((r) => values.includes(String(r[column])));
    return this;
  }

  update(payload: Partial<RevisionRow>): this {
    this.mode = "update";
    this.update_payload = payload;
    return this;
  }

  insert(payload: Omit<RevisionRow, "id" | "created_at" | "updated_at">): this {
    this.mode = "insert";
    const now = new Date().toISOString();
    this.insert_row = {
      ...payload,
      id: `generated-revision-${this.table.next_id++}`,
      created_at: now,
      updated_at: now,
    };
    return this;
  }

  maybeSingle(): Promise<{ data: unknown; error: { message: string } | null }> {
    if (this._error) {
      return Promise.resolve({ data: null, error: this._error });
    }
    if (this.mode === "update") {
      const target = this.filtered[0];
      if (!target) return Promise.resolve({ data: null, error: null });
      Object.assign(target, this.update_payload);
      return Promise.resolve({ data: { id: target.id }, error: null });
    }
    if (this.mode === "insert" && this.insert_row) {
      this.table.rows.push(this.insert_row);
      return Promise.resolve({ data: { id: this.insert_row.id }, error: null });
    }
    return Promise.resolve({ data: this.filtered[0] ?? null, error: null });
  }
}

function make_fake_client(
  table: FakeTable,
  error: { message: string } | null = null,
): unknown {
  return {
    from(_table_name: string): FakeRevisionQueryBuilder {
      return new FakeRevisionQueryBuilder(table, error);
    },
  };
}

// ── Constantes ──────────────────────────────────────────────────────────────

const PROPERTY_ID = "00000000-0000-0000-0007-000000000001";
const SUBMITTED_BY = "00000000-0000-0000-0007-000000000002";

function make_changed_fields(overrides: Partial<EditPropertyInput> = {}): EditPropertyInput {
  return {
    property_id: PROPERTY_ID,
    operation_type: "sale",
    property_type: "casa",
    price: 3000000,
    bedrooms: 3,
    bathrooms: 2,
    square_meters: 140,
    address: "Calle Reforma 100, CDMX",
    location: "SRID=4326;POINT(-99.15 19.42)",
    price_visible: true,
    pet_friendly: false,
    allows_no_guarantor: false,
    student_friendly: false,
    description: "Descripción original del primer submit",
    ...overrides,
  };
}

function make_row(overrides: Partial<RevisionRow> = {}): RevisionRow {
  return {
    id: "revision-existente-1",
    property_id: PROPERTY_ID,
    status: "pending",
    changed_fields: { description: "snapshot viejo" },
    submitted_by: SUBMITTED_BY,
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-01T00:00:00Z",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────

Deno.test("sin_revision_activa_previa_inserta_nueva_fila_pending", async () => {
  const table = new FakeTable([]);
  const upserter = make_revision_upserter(make_fake_client(table) as never);

  const result = await upserter.upsert(PROPERTY_ID, SUBMITTED_BY, make_changed_fields());

  assertEquals(result.ok, true);
  assertEquals(table.rows.length, 1, "debe insertar exactamente una fila nueva");
  assertEquals(table.rows[0].status, "pending");
  assertEquals(table.rows[0].property_id, PROPERTY_ID);
  assertEquals(table.rows[0].submitted_by, SUBMITTED_BY);
});

Deno.test("con_revision_pending_existente_actualiza_la_misma_fila_no_inserta_segunda", async () => {
  const existing = make_row({ status: "pending" });
  const table = new FakeTable([existing]);
  const upserter = make_revision_upserter(make_fake_client(table) as never);

  const result = await upserter.upsert(
    PROPERTY_ID,
    SUBMITTED_BY,
    make_changed_fields({ description: "segundo submit — refinamiento" }),
  );

  assertEquals(result.ok, true);
  assertEquals(table.rows.length, 1, "debe seguir habiendo UNA sola fila — la existente, actualizada");
  if (result.ok) {
    assertEquals(result.revision_id, existing.id, "el revision_id devuelto debe ser el de la fila EXISTENTE, no uno nuevo");
  }
});

Deno.test("con_revision_needs_changes_existente_regresa_a_pending_al_resubmit", async () => {
  const existing = make_row({ status: "needs_changes" });
  const table = new FakeTable([existing]);
  const upserter = make_revision_upserter(make_fake_client(table) as never);

  await upserter.upsert(PROPERTY_ID, SUBMITTED_BY, make_changed_fields());

  assertEquals(table.rows.length, 1);
  assertEquals(
    table.rows[0].status,
    "pending",
    "el agente atendió los cambios pedidos — el resubmit debe regresar la fila a 'pending'",
  );
});

Deno.test("changed_fields_de_la_fila_actualizada_refleja_el_snapshot_mas_reciente", async () => {
  const existing = make_row({ status: "pending", changed_fields: { description: "PRIMER submit" } });
  const table = new FakeTable([existing]);
  const upserter = make_revision_upserter(make_fake_client(table) as never);

  await upserter.upsert(
    PROPERTY_ID,
    SUBMITTED_BY,
    make_changed_fields({ description: "SEGUNDO submit — este debe quedar" }),
  );

  assertEquals(table.rows.length, 1);
  const stored = table.rows[0].changed_fields as EditPropertyInput;
  assertEquals(
    stored.description,
    "SEGUNDO submit — este debe quedar",
    "changed_fields debe reflejar el snapshot del submit MÁS RECIENTE, no el primero",
  );
});

Deno.test("revision_approved_no_cuenta_como_activa_inserta_nueva_fila", async () => {
  const approved = make_row({ id: "revision-approved-vieja", status: "approved" });
  const table = new FakeTable([approved]);
  const upserter = make_revision_upserter(make_fake_client(table) as never);

  const result = await upserter.upsert(PROPERTY_ID, SUBMITTED_BY, make_changed_fields());

  assertEquals(result.ok, true);
  assertEquals(table.rows.length, 2, "una revisión approved no bloquea — se inserta una fila NUEVA junto a la vieja");
  const nueva = table.rows.find((r) => r.id !== "revision-approved-vieja");
  assertEquals(nueva?.status, "pending");
});

Deno.test("revision_rejected_no_cuenta_como_activa_inserta_nueva_fila", async () => {
  const rejected = make_row({ id: "revision-rejected-vieja", status: "rejected" });
  const table = new FakeTable([rejected]);
  const upserter = make_revision_upserter(make_fake_client(table) as never);

  const result = await upserter.upsert(PROPERTY_ID, SUBMITTED_BY, make_changed_fields());

  assertEquals(result.ok, true);
  assertEquals(table.rows.length, 2, "una revisión rejected no bloquea — se inserta una fila NUEVA junto a la vieja");
});

Deno.test("error_en_query_de_busqueda_retorna_db_error_sin_lanzar", async () => {
  const table = new FakeTable([]);
  const upserter = make_revision_upserter(
    make_fake_client(table, { message: "connection timeout" }) as never,
  );

  const result = await upserter.upsert(PROPERTY_ID, SUBMITTED_BY, make_changed_fields());

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error_code, "DB_ERROR");
  }
});
