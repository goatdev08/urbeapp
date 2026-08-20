// supabase/functions/_shared/ad_creative_status_updater.test.ts
// Tests del AdCreativeStatusUpdater REAL (make_ad_creative_status_updater) —
// subtarea 169.5 (cierre pedido por el coordinador tras el GREEN, 2026-08-16).
//
// GAP reportado: la suite DI de stream-webhook/handler_ads.test.ts solo prueba
// el CONTRATO del handler contra un fake (mark_ready/mark_failed configurados
// por escenario) — la correctitud de la QUERY REAL (tabla, columna de scope,
// redondeo antes de escribir en la columna integer, conteo de filas afectadas)
// no tenía cobertura automatizada. Mismo patrón que
// _shared/active_ad_upload_checker.test.ts / _shared/ad_url_minter.test.ts
// (FakeQueryBuilder chainable + thenable, capturando la forma de la query).
//
// El mutante MÁS GRAVE que este archivo debe matar: apuntar el UPDATE a
// `property_videos` en vez de `ad_creatives` (o filtrar por otra columna que no
// sea `cloudflare_uid`) haría que el webhook, en la rama de anuncios, PISARA
// filas de video de propiedad — exactamente el acoplamiento que 169 (opción A,
// tabla propia) existe para evitar. Segundo mutante grave: un adapter que
// devuelva siempre 1 (o siempre 0) filas afectadas rompe en SILENCIO toda la
// rama aditiva del webhook, que decide "¿intento ad_creatives?" leyendo ese
// número.
//
// Framework: Deno.test + @std/assert
// Ejecutar:
//   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//     --config deno.json _shared/ad_creative_status_updater.test.ts
//
// ─── EDGE CASES CUBIERTOS (169.5) ─────────────────────────────────────────────
//
// ### Tabla y columna de scope (mutante más grave — cruce con property_videos)
// - mark_ready_usa_tabla_ad_creatives_no_property_videos
// - mark_ready_filtra_por_cloudflare_uid_exacto
// - mark_failed_usa_tabla_ad_creatives_no_property_videos
// - mark_failed_filtra_por_cloudflare_uid_exacto
//
// ### Campos que escribe el UPDATE
// - mark_ready_escribe_status_ready_y_thumbnail_url_exacto
// - mark_ready_thumbnail_url_null_se_escribe_como_null
// - mark_failed_escribe_status_failed
//
// ### 🔴 Redondeo — vive AQUÍ, DESPUÉS de que el handler ya validó [6,30] contra
// el valor crudo (orden documentado en stream-webhook/handler.ts:82-96; ver
// nota de invariante de orden más abajo)
// - mark_ready_redondea_29_9_a_30_entero
// - mark_ready_redondea_6_6_a_7_pin_de_round_no_de_trunc
// - mark_ready_no_re_valida_el_rango_solo_redondea_lo_que_recibe
//
// ### Filas afectadas — de esto depende la rama aditiva completa del webhook
// - mark_ready_devuelve_1_cuando_el_update_afecta_una_fila
// - mark_ready_devuelve_0_cuando_el_update_no_afecta_ninguna_fila
// - mark_failed_devuelve_1_cuando_el_update_afecta_una_fila
// - mark_failed_devuelve_0_cuando_el_update_no_afecta_ninguna_fila
//
// ### Fail-closed ante error de la query (mismo criterio que 169.4)
// - mark_ready_lanza_si_la_query_devuelve_error
// - mark_failed_lanza_si_la_query_devuelve_error

import { assertEquals, assertRejects } from "@std/assert";
import { make_ad_creative_status_updater } from "./clients.ts";

// ── Tipos internos del fake ───────────────────────────────────────────────────

interface EqCall {
  column: string;
  value: unknown;
}

type UpdateResponse = { data: Array<{ id: string }> | null; error: { message: string } | null };

// ── FakeUpdateQueryBuilder — captura tabla/update/eq/select; thenable como el real ──

class FakeUpdateQueryBuilder {
  table: string;
  update_payload: Record<string, unknown> | null = null;
  eq_calls: EqCall[] = [];
  select_calls: string[] = [];

  constructor(table: string, private response: UpdateResponse) {
    this.table = table;
  }

  update(payload: Record<string, unknown>): this {
    this.update_payload = payload;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.eq_calls.push({ column, value });
    return this;
  }

  is(_column: string, _value: unknown): this {
    // ad_creatives no tiene deleted_at (a diferencia de property_videos) — si
    // el adapter real llamara .is() de todos modos no debe romper el fake,
    // pero ningún test de este archivo lo requiere.
    return this;
  }

  select(columns: string): this {
    this.select_calls.push(columns);
    return this;
  }

  then<T>(
    onfulfilled: (value: { data: Array<{ id: string }> | null; error: { message: string } | null }) => T,
    onrejected?: (reason: unknown) => T,
  ): Promise<T> {
    return Promise.resolve(this.response).then(onfulfilled, onrejected);
  }
}

// ── FakeSupabaseClient ────────────────────────────────────────────────────────

function make_fake_client_tracked(response: UpdateResponse): {
  get_builder(): FakeUpdateQueryBuilder | null;
  client: unknown;
} {
  let _last_builder: FakeUpdateQueryBuilder | null = null;
  const client = {
    from(table: string): FakeUpdateQueryBuilder {
      const builder = new FakeUpdateQueryBuilder(table, response);
      _last_builder = builder;
      return builder;
    },
  };
  return { get_builder: () => _last_builder, client };
}

// ── Constantes ────────────────────────────────────────────────────────────────

const CF_UID = "cf-uid-ad-creative-status-0001";
const THUMBNAIL_URL = "https://videodelivery.net/cf-uid-ad-creative-status-0001/thumbnails/thumbnail.jpg";
const AFFECTED_ONE: UpdateResponse = { data: [{ id: "row-1" }], error: null };
const AFFECTED_ZERO: UpdateResponse = { data: [], error: null };
const QUERY_ERROR: UpdateResponse = { data: null, error: { message: "connection timeout" } };

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — tabla y columna de scope (mutante más grave)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("mark_ready_usa_tabla_ad_creatives_no_property_videos", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 20 });
  assertEquals(get_builder()!.table, "ad_creatives", "el UPDATE debe apuntar a ad_creatives, NUNCA a property_videos");
});

Deno.test("mark_ready_filtra_por_cloudflare_uid_exacto", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 20 });
  const filter = get_builder()!.eq_calls.find((f) => f.column === "cloudflare_uid");
  assertEquals(filter?.value, CF_UID, "el filtro debe ser .eq('cloudflare_uid', <uid exacto>)");
});

Deno.test("mark_failed_usa_tabla_ad_creatives_no_property_videos", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "AD_DURATION_INVALID" });
  assertEquals(get_builder()!.table, "ad_creatives", "el UPDATE debe apuntar a ad_creatives, NUNCA a property_videos");
});

Deno.test("mark_failed_filtra_por_cloudflare_uid_exacto", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "AD_DURATION_INVALID" });
  const filter = get_builder()!.eq_calls.find((f) => f.column === "cloudflare_uid");
  assertEquals(filter?.value, CF_UID, "el filtro debe ser .eq('cloudflare_uid', <uid exacto>)");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — campos que escribe el UPDATE
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("mark_ready_escribe_status_ready_y_thumbnail_url_exacto", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 20 });
  const payload = get_builder()!.update_payload!;
  assertEquals(payload.status, "ready");
  assertEquals(payload.thumbnail_url, THUMBNAIL_URL);
});

Deno.test("mark_ready_thumbnail_url_null_se_escribe_como_null", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: null, duration_seconds: 20 });
  const payload = get_builder()!.update_payload!;
  assertEquals(payload.thumbnail_url, null, "thumbnail_url ausente en el payload de Stream debe escribirse como null, no omitirse");
});

Deno.test("mark_failed_escribe_status_failed", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "AD_DURATION_INVALID" });
  const payload = get_builder()!.update_payload!;
  assertEquals(payload.status, "failed");
});

// ─────────────────────────────────────────────────────────────────────────────
// RED #189 — el reason_code SE PERSISTE, no se tira.
//
// Este adapter RECIBÍA params.reason_code y escribía solo { status: 'failed' }.
// Su hermano de property_videos (clients.ts, make_video_status_updater) sí
// persiste failure_reason desde siempre. Esa asimetría es lo que obligó a
// useAdUpload a ADIVINAR la causa "por eliminación" y mostrar siempre "error
// de transcodificación" — un mensaje que miente en cuanto la causa es otra.
//
// Los dos tests usan vocabularios DISTINTOS a propósito: uno solo, con el
// literal que ya aparece en el resto del archivo, pasaría igual con un
// `failure_reason: "AD_DURATION_INVALID"` hardcodeado.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("mark_failed_persiste_el_reason_code_propio_en_failure_reason", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "AD_DURATION_INVALID" });
  const payload = get_builder()!.update_payload!;
  assertEquals(
    payload.failure_reason,
    "AD_DURATION_INVALID",
    "el reason_code que recibe el adapter debe llegar a la columna, no descartarse",
  );
});

Deno.test("mark_failed_persiste_tambien_un_reason_code_de_cloudflare_no_hardcodea_el_nuestro", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "ERR_NON_VIDEO_FILE" });
  const payload = get_builder()!.update_payload!;
  assertEquals(payload.failure_reason, "ERR_NON_VIDEO_FILE");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — redondeo (ad_creatives.duration_seconds es integer; el handler valida
// el rango [6,30] contra el valor CRUDO fraccionario ANTES de llamar aquí —
// stream-webhook/handler.ts:82-96 documenta ese orden. Este adapter NUNCA
// vuelve a validar el rango: solo redondea lo que recibe para que quepa en la
// columna integer. 🔒 Invariante de orden que este archivo NO puede probar por
// sí solo (vive partido entre handler.ts y este adapter): si alguien moviera el
// redondeo AL HANDLER y validara el rango DESPUÉS de redondear, un video de
// 5.7s redondearía a 6 y pasaría la validación de mínimo violándola en
// realidad — por eso el redondeo debe vivir EXCLUSIVAMENTE aquí, nunca antes
// de la validación en handler.ts (verificado ahí, no aquí).
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("mark_ready_redondea_29_9_a_30_entero", async () => {
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 29.9 });
  const payload = get_builder()!.update_payload!;
  assertEquals(payload.duration_seconds, 30, "29.9 debe redondearse a un entero (30) antes de escribir en la columna integer");
  assertEquals(Number.isInteger(payload.duration_seconds), true);
});

Deno.test("mark_ready_redondea_6_6_a_7_pin_de_round_no_de_trunc", async () => {
  // 6.6 distingue Math.round (→7) de Math.trunc/Math.floor (→6) — fija la
  // decisión de diseño (redondear al entero más cercano) para que un cambio a
  // truncar/floor rompa este test en vez de colarse en silencio.
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 6.6 });
  const payload = get_builder()!.update_payload!;
  assertEquals(payload.duration_seconds, 7, "6.6 debe redondear a 7 (Math.round), no truncar a 6");
});

Deno.test("mark_ready_no_re_valida_el_rango_solo_redondea_lo_que_recibe", async () => {
  // La validación [6,30] YA ocurrió en el handler contra el valor crudo — este
  // adapter no debe rechazar/lanzar por un valor fuera de rango, solo
  // redondearlo y escribirlo tal cual (single-responsibility: validar es del
  // handler, persistir+redondear es de este adapter).
  const { client, get_builder } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 2.3 });
  const payload = get_builder()!.update_payload!;
  assertEquals(payload.duration_seconds, 2, "el adapter redondea sin re-validar el rango — no es su responsabilidad");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — filas afectadas (el corazón de la rama aditiva del webhook)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("mark_ready_devuelve_1_cuando_el_update_afecta_una_fila", async () => {
  const { client } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  const affected = await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 20 });
  assertEquals(affected, 1);
});

Deno.test("mark_ready_devuelve_0_cuando_el_update_no_afecta_ninguna_fila", async () => {
  const { client } = make_fake_client_tracked(AFFECTED_ZERO);
  const updater = make_ad_creative_status_updater(client as never);
  const affected = await updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 20 });
  assertEquals(affected, 0, "cloudflare_uid desconocido a ad_creatives debe devolver 0, no lanzar");
});

Deno.test("mark_failed_devuelve_1_cuando_el_update_afecta_una_fila", async () => {
  const { client } = make_fake_client_tracked(AFFECTED_ONE);
  const updater = make_ad_creative_status_updater(client as never);
  const affected = await updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "AD_DURATION_INVALID" });
  assertEquals(affected, 1);
});

Deno.test("mark_failed_devuelve_0_cuando_el_update_no_afecta_ninguna_fila", async () => {
  const { client } = make_fake_client_tracked(AFFECTED_ZERO);
  const updater = make_ad_creative_status_updater(client as never);
  const affected = await updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "AD_DURATION_INVALID" });
  assertEquals(affected, 0, "cloudflare_uid desconocido a ad_creatives debe devolver 0, no lanzar");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — fail-closed ante error de la query
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("mark_ready_lanza_si_la_query_devuelve_error", async () => {
  const { client } = make_fake_client_tracked(QUERY_ERROR);
  const updater = make_ad_creative_status_updater(client as never);
  await assertRejects(() =>
    updater.mark_ready({ cloudflare_uid: CF_UID, thumbnail_url: THUMBNAIL_URL, duration_seconds: 20 })
  );
});

Deno.test("mark_failed_lanza_si_la_query_devuelve_error", async () => {
  const { client } = make_fake_client_tracked(QUERY_ERROR);
  const updater = make_ad_creative_status_updater(client as never);
  await assertRejects(() => updater.mark_failed({ cloudflare_uid: CF_UID, reason_code: "AD_DURATION_INVALID" }));
});
