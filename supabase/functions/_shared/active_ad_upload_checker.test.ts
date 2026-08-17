// supabase/functions/_shared/active_ad_upload_checker.test.ts
// Tests del ActiveAdUploadChecker REAL (make_active_ad_upload_checker) —
// subtarea 169.4 (cierre pedido por el guardián, 2026-08-16).
//
// GAP reportado por el guardián: la suite DI de mint-ad-upload-url/handler.test.ts
// solo prueba el CONTRATO del handler contra un mock (count_active_ad_uploads
// configurado por escenario) — la correctitud de la QUERY REAL (tabla, columna
// de scope, filtro de estados/ventana) no tenía cobertura automatizada. Mismo
// patrón que duplicate_property_checker.test.ts (fake client chainable +
// thenable, capturando la forma de la query).
//
// Dos mutantes que este archivo debe matar (criterio del guardián):
//
// - (j) — EL MÁS GRAVE. Apuntar make_active_ad_upload_checker a
//   `property_videos`/`agent_id` en vez de `ad_creatives`/`agency_id`
//   reintroduce el 409 CRUZADO que 169.4 existe para evitar (un video de
//   propiedad en vuelo bloquearía un anuncio de la misma persona). La suite
//   DI del handler solo prueba que el handler LE PASA agency_id al checker —
//   nunca que el checker LEE ad_creatives. Este archivo cierra esa mitad
//   verificando la tabla y la columna de la query real.
//
// - (h) — 'processing' gana ventana de expiración en el filtro real. La
//   semántica correcta es: 'processing' SIEMPRE cuenta (el webhook, 169.5, lo
//   resuelve solo — no hay fila colgada); 'uploading' SOLO cuenta si es más
//   reciente que stale_before (reaper, bug #103 heredado). El test de abajo
//   asserta la QUERY QUE SE CONSTRUYE (el string exacto que se le pasa al
//   filtro `.or()` de PostgREST), NO una reimplementación de esa semántica en
//   el fake — evita el borde tautológico que el guardián marcó en la suite
//   anterior (donde el fake reimplementaba el filtro y siempre coincidía
//   consigo mismo).
//
// Framework: Deno.test + @std/assert
// Ejecutar:
//   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//     --config deno.json _shared/active_ad_upload_checker.test.ts
//
// ─── EDGE CASES CUBIERTOS ─────────────────────────────────────────────────────
//
// ### Tabla y columna de scope (mutante "j")
// - consulta_la_tabla_ad_creatives_no_property_videos
// - filtra_por_agency_id_no_por_agent_id
//
// ### Shape del select (count exacto, sin traer filas)
// - select_usa_id_con_count_exact_y_head_true
//
// ### Filtro real de estado/ventana (mutante "h" — query construida, no reimplementada)
// - filtro_or_incluye_processing_sin_ventana_y_uploading_con_stale_before_exacto
//
// ### Wiring del resultado
// - count_de_la_respuesta_se_retorna_tal_cual
// - count_null_se_normaliza_a_cero
// - error_de_la_query_falla_cerrado_retorna_1

import { assertEquals } from "@std/assert";
import { make_active_ad_upload_checker } from "./clients.ts";

// ── Tipos internos del fake ───────────────────────────────────────────────────

interface SelectCall {
  columns: string;
  options?: Record<string, unknown>;
}

interface EqCall {
  column: string;
  value: unknown;
}

type CountResponse = { count: number | null; error: { message: string } | null };

// ── FakeCountQueryBuilder — captura tabla/select/eq/or; thenable como el real ──

class FakeCountQueryBuilder {
  select_calls: SelectCall[] = [];
  eq_calls: EqCall[] = [];
  or_calls: string[] = [];

  constructor(private response: CountResponse) {}

  select(columns: string, options?: Record<string, unknown>): this {
    this.select_calls.push({ columns, options });
    return this;
  }

  eq(column: string, value: unknown): this {
    this.eq_calls.push({ column, value });
    return this;
  }

  or(filter: string): this {
    this.or_calls.push(filter);
    return this;
  }

  then<T>(
    onfulfilled: (value: CountResponse) => T,
    onrejected?: (reason: unknown) => T,
  ): Promise<T> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

function make_fake_client(response: CountResponse) {
  const from_calls: string[] = [];
  let last_builder: FakeCountQueryBuilder | undefined;
  const client = {
    from(table: string): FakeCountQueryBuilder {
      from_calls.push(table);
      last_builder = new FakeCountQueryBuilder(response);
      return last_builder;
    },
  };
  return {
    client,
    from_calls,
    get builder(): FakeCountQueryBuilder {
      return last_builder!;
    },
  };
}

// ── Constantes ──────────────────────────────────────────────────────────────

const AGENCY_ID = "10000000-0000-0000-0000-000000000001";
const STALE_BEFORE = "2026-08-16T00:00:00.000Z";

// ── Tabla y columna de scope (mutante "j") ────────────────────────────────────

Deno.test("consulta_la_tabla_ad_creatives_no_property_videos", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_ad_upload_checker(fake.client as never);
  await checker.count_active_ad_uploads(AGENCY_ID, STALE_BEFORE);
  assertEquals(
    fake.from_calls,
    ["ad_creatives"],
    "la concurrencia de anuncios debe consultarse sobre ad_creatives, NUNCA property_videos",
  );
});

Deno.test("filtra_por_agency_id_no_por_agent_id", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_ad_upload_checker(fake.client as never);
  await checker.count_active_ad_uploads(AGENCY_ID, STALE_BEFORE);
  const agency_call = fake.builder.eq_calls.find((c) => c.column === "agency_id");
  assertEquals(agency_call?.value, AGENCY_ID, "el filtro debe ser eq(agency_id, ...)");
  const agent_call = fake.builder.eq_calls.find((c) => c.column === "agent_id");
  assertEquals(
    agent_call,
    undefined,
    "NUNCA debe filtrar por agent_id — esa es la clave del checker de property_videos",
  );
});

// ── Shape del select ──────────────────────────────────────────────────────────

Deno.test("select_usa_id_con_count_exact_y_head_true", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_ad_upload_checker(fake.client as never);
  await checker.count_active_ad_uploads(AGENCY_ID, STALE_BEFORE);
  assertEquals(
    fake.builder.select_calls[0],
    { columns: "id", options: { count: "exact", head: true } },
    "debe pedir un count exacto sin traer filas (head:true) — barato incluso con muchas filas",
  );
});

// ── Filtro real de estado/ventana (mutante "h") ───────────────────────────────

Deno.test("filtro_or_incluye_processing_sin_ventana_y_uploading_con_stale_before_exacto", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_ad_upload_checker(fake.client as never);
  await checker.count_active_ad_uploads(AGENCY_ID, STALE_BEFORE);
  assertEquals(
    fake.builder.or_calls,
    [`status.eq.processing,and(status.eq.uploading,created_at.gt.${STALE_BEFORE})`],
    "'processing' debe ir SIN condición de fecha (sin ventana); 'uploading' debe ir con " +
      "created_at.gt.<stale_before> EXACTO — si 'processing' ganara una ventana, este string cambiaría",
  );
});

// ── Wiring del resultado ──────────────────────────────────────────────────────

Deno.test("count_de_la_respuesta_se_retorna_tal_cual", async () => {
  const fake = make_fake_client({ count: 3, error: null });
  const checker = make_active_ad_upload_checker(fake.client as never);
  const result = await checker.count_active_ad_uploads(AGENCY_ID, STALE_BEFORE);
  assertEquals(result, 3);
});

Deno.test("count_null_se_normaliza_a_cero", async () => {
  const fake = make_fake_client({ count: null, error: null });
  const checker = make_active_ad_upload_checker(fake.client as never);
  const result = await checker.count_active_ad_uploads(AGENCY_ID, STALE_BEFORE);
  assertEquals(result, 0);
});

Deno.test("error_de_la_query_falla_cerrado_retorna_1", async () => {
  const fake = make_fake_client({ count: null, error: { message: "connection timeout" } });
  const checker = make_active_ad_upload_checker(fake.client as never);
  const result = await checker.count_active_ad_uploads(AGENCY_ID, STALE_BEFORE);
  assertEquals(
    result,
    1,
    "un error de red/DB debe fallar CERRADO (se trata como si hubiera 1 activo), nunca abrir el gate",
  );
});
