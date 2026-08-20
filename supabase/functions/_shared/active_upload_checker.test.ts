// supabase/functions/_shared/active_upload_checker.test.ts
// Tests del ActiveUploadChecker REAL (make_active_upload_checker, propiedades)
// — tareas #183 y #188.
//
// ════════════════════════════════════════════════════════════════════════════
// POR QUÉ ESTE ARCHIVO NO EXISTÍA, que es justo el hallazgo de #183: el
// checker de ANUNCIOS recibió cobertura en 169.4
// (active_ad_upload_checker.test.ts) y el de PROPIEDADES —del que aquél es un
// calco— se quedó sin ninguna. El guardián lo demostró con un mutante de
// control: aplicar la misma mutación de ventana al checker viejo SOBREVIVÍA
// las 1102 pruebas Deno.
//
// Consecuencia: el día que alguien tocara el umbral de propiedades, nada
// rompería aquí y el test que fallaría sería el de anuncios — apuntando al
// archivo equivocado.
//
// Es un ESPEJO deliberado de active_ad_upload_checker.test.ts, con tabla y
// clave propias. No se factorizó un helper compartido a propósito: la
// separación de scope (property_videos/agent_id vs ad_creatives/agency_id) es
// lo que el test `ausencia_de_409_cruzado` existe para probar INDEPENDIENTE, y
// un fake común la reacoplaría. Lo que sí se compara entre dominios son los
// umbrales, en upload_window_parity.test.ts.
//
// ─── EDGE CASES ─────────────────────────────────────────────────────────────
// - consulta_property_videos_no_ad_creatives          (espejo del mutante "j")
// - filtra_por_agent_id_no_por_agency_id
// - excluye_soft_deleted                              (property_videos SÍ tiene deleted_at)
// - select_usa_id_con_count_exact_y_head_true
// - filtro_or_da_ventana_a_processing_Y_a_uploading   (#188)
// - count_de_la_respuesta_se_retorna_tal_cual
// - count_null_se_normaliza_a_cero
// - error_de_la_query_falla_cerrado_retorna_1
// ════════════════════════════════════════════════════════════════════════════

import { assertEquals } from "@std/assert";
import { make_active_upload_checker } from "./clients.ts";

interface SelectCall {
  columns: string;
  options?: Record<string, unknown>;
}

interface EqCall {
  column: string;
  value: unknown;
}

interface IsCall {
  column: string;
  value: unknown;
}

type CountResponse = { count: number | null; error: { message: string } | null };

class FakeCountQueryBuilder {
  select_calls: SelectCall[] = [];
  eq_calls: EqCall[] = [];
  is_calls: IsCall[] = [];
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

  is(column: string, value: unknown): this {
    this.is_calls.push({ column, value });
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

const AGENT_ID = "20000000-0000-0000-0000-000000000001";
const STALE_BEFORE = "2026-08-20T00:00:00.000Z";
const STALE_PROCESSING_BEFORE = "2026-08-19T23:00:00.000Z";

// ── Tabla y columna de scope ────────────────────────────────────────────────

Deno.test("consulta_property_videos_no_ad_creatives", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE);
  assertEquals(
    fake.from_calls,
    ["property_videos"],
    "la concurrencia de propiedades debe consultarse sobre property_videos, NUNCA ad_creatives",
  );
});

Deno.test("filtra_por_agent_id_no_por_agency_id", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE);
  const agent_call = fake.builder.eq_calls.find((c) => c.column === "agent_id");
  assertEquals(agent_call?.value, AGENT_ID, "el filtro debe ser eq(agent_id, ...)");
  assertEquals(
    fake.builder.eq_calls.find((c) => c.column === "agency_id"),
    undefined,
    "NUNCA debe filtrar por agency_id — esa es la clave del checker de anuncios",
  );
});

Deno.test("excluye_soft_deleted", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE);
  assertEquals(
    fake.builder.is_calls,
    [{ column: "deleted_at", value: null }],
    "property_videos SÍ tiene deleted_at (a diferencia de ad_creatives): un video borrado no debe bloquear",
  );
});

// ── Shape del select ────────────────────────────────────────────────────────

Deno.test("select_usa_id_con_count_exact_y_head_true", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE);
  assertEquals(
    fake.builder.select_calls[0],
    { columns: "id", options: { count: "exact", head: true } },
    "debe pedir un count exacto sin traer filas (head:true)",
  );
});

// ── 🔴 #188: la ventana de 'processing' ─────────────────────────────────────

Deno.test("filtro_or_da_ventana_a_processing_Y_a_uploading", async () => {
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE);
  assertEquals(
    fake.builder.or_calls,
    [
      `and(status.eq.processing,created_at.gt.${STALE_PROCESSING_BEFORE}),` +
      `and(status.eq.uploading,created_at.gt.${STALE_BEFORE})`,
    ],
    "'processing' ya no cuenta sin ventana: un video atorado ahí bloqueaba al agente para siempre (#188)",
  );
});

Deno.test("las_dos_ventanas_son_umbrales_DISTINTOS_en_la_query", async () => {
  // Caso pareado: si el GREEN usara el mismo timestamp para ambos estados, el
  // test de arriba pasaría igual con STALE_BEFORE === STALE_PROCESSING_BEFORE.
  // Aquí se verifica que cada estado recibe SU propio umbral.
  const fake = make_fake_client({ count: 0, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  await checker.count_active_uploads(AGENT_ID, "AAA", "BBB");
  const filter = fake.builder.or_calls[0];
  assertEquals(filter.includes("status.eq.processing,created_at.gt.BBB"), true);
  assertEquals(filter.includes("status.eq.uploading,created_at.gt.AAA"), true);
});

// ── Wiring del resultado ────────────────────────────────────────────────────

Deno.test("count_de_la_respuesta_se_retorna_tal_cual", async () => {
  const fake = make_fake_client({ count: 3, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  assertEquals(await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE), 3);
});

Deno.test("count_null_se_normaliza_a_cero", async () => {
  const fake = make_fake_client({ count: null, error: null });
  const checker = make_active_upload_checker(fake.client as never);
  assertEquals(await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE), 0);
});

Deno.test("error_de_la_query_falla_cerrado_retorna_1", async () => {
  const fake = make_fake_client({ count: null, error: { message: "PGRST100" } });
  const checker = make_active_upload_checker(fake.client as never);
  assertEquals(
    await checker.count_active_uploads(AGENT_ID, STALE_BEFORE, STALE_PROCESSING_BEFORE),
    1,
    "fail-closed: un error de red/DB al chequear concurrencia se trata como 'hay 1'",
  );
});
