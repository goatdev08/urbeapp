/**
 * Tests RED→GREEN — subtarea 73.4 (absorbe 73.5)
 * SUT: make_duplicate_property_checker(client) en _shared/clients.ts
 *
 * GAP reportado por test-author en la bitácora de 73.4: la suite DI de
 * handler.test.ts solo prueba el CONTRATO del handler contra un mock de
 * DuplicatePropertyChecker (isDuplicate configurado por escenario) — la
 * correctitud de la QUERY REAL (owner_user_id, lower(trim(address)),
 * status NOT IN (...), deleted_at is null) no tenía cobertura automatizada.
 * Este archivo la cierra con un fake postgrest client, mismo patrón que
 * poster_url_minter.test.ts (FakeQueryBuilder chainable + thenable), pero
 * aplicando el filtro real en el fake (in-memory) para poder afirmar sobre
 * combinaciones owner/address/status sin acoplarse al mecanismo SQL exacto.
 *
 * Framework: Deno.test + @std/assert
 * Ejecutar:
 *   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
 *     --config deno.json _shared/duplicate_property_checker.test.ts
 *
 * ─── EDGE CASES CUBIERTOS ─────────────────────────────────────────────────
 * - mismo owner + misma dirección exacta → isDuplicate true
 * - distinto owner + misma dirección → NO es duplicado (scoping por owner)
 * - misma dirección con mayúsculas/espacios distintos → SÍ bloquea (normalización)
 * - dirección distinta → NO es duplicado
 * - propiedad previa rechazada → NO cuenta como duplicado
 * - propiedad previa eliminada (soft/hard) → NO cuenta como duplicado
 * - sin filas del owner → NO es duplicado
 * - error de la query → fail-open (isDuplicate: false), no lanza
 */

import { assertEquals } from "@std/assert";
import { make_duplicate_property_checker } from "./clients.ts";

// ── Fila cruda simulada de public.properties ──────────────────────────────────

interface PropertyRow {
  owner_user_id: string;
  address: string;
  status: string;
  deleted_at: string | null;
}

// ── FakeQueryBuilder — aplica los filtros EN el fake (in-memory), igual que
// PostgREST los aplicaría server-side, para poder afirmar sobre combinaciones
// realistas sin acoplarse al mecanismo SQL exacto del adapter. ──────────────

class FakeQueryBuilder {
  private rows: PropertyRow[];
  private readonly _error: { message: string } | null;

  constructor(rows: PropertyRow[], error: { message: string } | null) {
    this.rows = rows;
    this._error = error;
  }

  select(_columns: string): this {
    return this;
  }

  eq(column: keyof PropertyRow, value: unknown): this {
    this.rows = this.rows.filter((r) => r[column] === value);
    return this;
  }

  is(column: keyof PropertyRow, value: unknown): this {
    this.rows = this.rows.filter((r) => r[column] === value);
    return this;
  }

  not(column: keyof PropertyRow, _op: string, value: string): this {
    const excluded = value.replace(/[()]/g, "").split(",");
    this.rows = this.rows.filter((r) => !excluded.includes(String(r[column])));
    return this;
  }

  then<T>(
    onfulfilled: (value: { data: PropertyRow[] | null; error: { message: string } | null }) => T,
    onrejected?: (reason: unknown) => T,
  ): Promise<T> {
    if (this._error) {
      return Promise.resolve({ data: null, error: this._error }).then(onfulfilled, onrejected);
    }
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected);
  }
}

function make_fake_client(rows: PropertyRow[], error: { message: string } | null = null): unknown {
  return {
    from(_table: string): FakeQueryBuilder {
      return new FakeQueryBuilder(rows, error);
    },
  };
}

// ── Constantes ──────────────────────────────────────────────────────────────

const OWNER = "00000000-0000-0000-0005-000000000001";
const OTHER_OWNER = "00000000-0000-0000-0005-000000000099";
const ADDRESS = "Av. Insurgentes Sur 1602, Col. Crédito Constructor, CDMX";

function make_row(overrides: Partial<PropertyRow> = {}): PropertyRow {
  return {
    owner_user_id: OWNER,
    address: ADDRESS,
    status: "active",
    deleted_at: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

Deno.test("mismo_owner_misma_direccion_exacta_bloquea", async () => {
  const client = make_fake_client([make_row()]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(result.isDuplicate, true, "mismo owner + misma dirección debe bloquear");
});

Deno.test("distinto_owner_misma_direccion_no_bloquea", async () => {
  const client = make_fake_client([make_row({ owner_user_id: OWNER })]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OTHER_OWNER, ADDRESS);
  assertEquals(
    result.isDuplicate,
    false,
    "un owner distinto publicando la misma dirección no es un duplicado obvio del mismo publicante",
  );
});

Deno.test("misma_direccion_mayusculas_y_espacios_distintos_bloquea_normalizado", async () => {
  const client = make_fake_client([make_row({ address: "  Av. Insurgentes SUR 1602, Col. Crédito Constructor, CDMX  " })]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, "av. insurgentes sur 1602, col. crédito constructor, cdmx");
  assertEquals(
    result.isDuplicate,
    true,
    "la comparación debe normalizar mayúsculas/espacios en ambos lados (lower+trim)",
  );
});

Deno.test("direccion_distinta_no_bloquea", async () => {
  const client = make_fake_client([make_row({ address: "Otra calle 123" })]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(result.isDuplicate, false, "una dirección distinta no es un duplicado");
});

Deno.test("propiedad_previa_rechazada_no_cuenta_como_duplicado", async () => {
  const client = make_fake_client([make_row({ status: "rejected" })]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(
    result.isDuplicate,
    false,
    "una publicación previa rechazada no bloquea — el agente puede resubir",
  );
});

Deno.test("propiedad_previa_eliminada_soft_no_cuenta_como_duplicado", async () => {
  const client = make_fake_client([make_row({ status: "deleted_soft" })]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(result.isDuplicate, false, "status deleted_soft está excluido de la regla de duplicado");
});

Deno.test("propiedad_previa_eliminada_hard_no_cuenta_como_duplicado", async () => {
  const client = make_fake_client([make_row({ status: "deleted_hard" })]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(result.isDuplicate, false, "status deleted_hard está excluido de la regla de duplicado");
});

Deno.test("propiedad_con_deleted_at_no_nulo_no_cuenta_como_duplicado", async () => {
  const client = make_fake_client([make_row({ deleted_at: "2026-08-01T00:00:00Z" })]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(result.isDuplicate, false, "una fila soft-deleted (deleted_at no nulo) no cuenta");
});

Deno.test("sin_filas_del_owner_no_es_duplicado", async () => {
  const client = make_fake_client([]);
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(result.isDuplicate, false, "sin publicaciones previas del owner, no hay duplicado");
});

Deno.test("error_de_la_query_falla_abierto_no_lanza", async () => {
  const client = make_fake_client([], { message: "connection timeout" });
  const checker = make_duplicate_property_checker(client as never);
  const result = await checker.check(OWNER, ADDRESS);
  assertEquals(
    result.isDuplicate,
    false,
    "un error de red/DB debe fallar abierto (isDuplicate: false), nunca lanzar ni bloquear falsamente",
  );
});
