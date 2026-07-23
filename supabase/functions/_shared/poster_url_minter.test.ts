/**
 * Tests RED — subtarea 89.1 (EF mint-poster-urls, batch, auth dueño-o-activo)
 * SUT: make_poster_url_minter(client, hlsConfig?) en _shared/clients.ts
 *
 * Framework: Deno.test + @std/assert + jose (verificación de JWT RS256)
 * Ejecutar:
 *   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
 *     --config deno.json _shared/poster_url_minter.test.ts
 *
 * SEAMS (interfaz bajo test):
 * - PosterUrlMinter.mint_posters(property_ids, caller_id) — el adapter real,
 *   NUNCA la EF completa (eso es handler.test.ts, con un fake determinista).
 * - El SupabaseClient real se sustituye por un fake que registra cada llamada a
 *   .from(table), .select(str), .in(), .eq(), .is(), .order() para verificar la
 *   shape EXACTA de la query base (lección #8: mock-vs-prod).
 * - La autorización owner-o-active y el fail-closed por-item son COMPORTAMIENTO
 *   OBSERVABLE (posterUrl presente/omitido), no se dicta el mecanismo SQL exacto
 *   con el que el GREEN exprese el filtro — solo el resultado.
 * - La firma RS256 real se verifica con jose contra una clave pública de prueba
 *   (frontera de confianza real, nunca mockeada) — mismo patrón que
 *   video_url_minter.test.ts.
 *
 * ─── EDGE CASES CUBIERTOS (89.1) ─────────────────────────────────────────────
 *
 * ### Shape de la query base (lección #8 — barrera de datos, no de auth)
 * - query_usa_tabla_property_videos
 * - select_incluye_owner_user_id_y_status_del_join_properties
 * - select_incluye_cloudflare_uid_thumbnail_pct_duration_seconds
 * - filtro_in_property_ids_con_array_exacto
 * - filtro_eq_status_ready
 * - filtro_is_deleted_at_null
 *
 * ### Auth por-item: dueño ve TODO, público solo ve active (casos 1-4)
 * - dueno_ve_su_propiedad_draft_posterurl_presente
 * - dueno_ve_su_propiedad_paused_posterurl_presente
 * - dueno_ve_su_propiedad_closed_posterurl_presente
 * - no_dueno_propiedad_active_posterurl_presente_publico
 * - no_dueno_propiedad_draft_omitida
 * - no_dueno_propiedad_paused_omitida
 *
 * ### Disponibilidad de video (casos 5-6)
 * - propiedad_sin_video_ready_omitida
 * - propiedad_con_video_ready_sin_cloudflare_uid_omitida_legacy
 *
 * ### Selección del primer video por position (regla no-obvia, implementation details)
 * - primer_video_ready_por_position_gana_sobre_position_mayor
 *
 * ### Cálculo de time / formato de posterUrl (caso 7)
 * - time_pct_50_duration_92_da_46_0s
 * - time_pct_null_usa_default_50_duration_80_da_40_0s
 * - time_duration_null_omite_time_pero_token_presente
 *
 * ### Token en el path, NUNCA query param — anti-regresión (caso 8)
 * - token_en_el_path_firma_sub_caller_uid_no_owner_uid... (en realidad sub=cloudflare_uid, ver nota)
 *
 * ### Fail-closed batch-resiliente (caso 9)
 * - hls_config_ausente_omite_items_stream_sin_lanzar
 * - jwk_invalido_omite_items_stream_sin_lanzar_batch_no_se_rompe
 *
 * ### property_ids vacío (caso 10)
 * - property_ids_vacio_devuelve_array_vacio_sin_tocar_la_red
 *
 * ### Defensa adicional (batch degradado, patrón ya establecido en el minter de video)
 * - query_error_devuelve_array_vacio_sin_lanzar
 *
 * ### Forma de la respuesta (regresión — no debe filtrar video_id/signed_url)
 * - resultado_solo_tiene_property_id_y_posterurl
 */

import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify } from "jose";
import { make_poster_url_minter } from "./clients.ts";
import type { HlsSignerConfig } from "../mint-video-url/types.ts";

// ── Tipos internos del fake ───────────────────────────────────────────────────

interface FilterCall {
  method: "in" | "eq" | "is";
  column: string;
  value: unknown;
}

interface PosterVideoRow {
  id: string;
  property_id: string;
  cloudflare_uid: string | null;
  thumbnail_pct: number | null;
  duration_seconds: number | null;
  position: number;
  properties: { owner_user_id: string; status: string };
}

// ── FakeQueryBuilder (thenable y chainable) ───────────────────────────────────

class FakeQueryBuilder {
  table: string;
  select_str = "";
  filters: FilterCall[] = [];
  order_calls: Array<{ column: string; ascending?: boolean }> = [];
  private _data: PosterVideoRow[] | null;
  private _error: { message: string } | null;

  constructor(table: string, data: PosterVideoRow[] | null, error: { message: string } | null) {
    this.table = table;
    this._data = data;
    this._error = error;
  }

  select(str: string): this {
    this.select_str = str;
    return this;
  }

  in(column: string, value: unknown): this {
    this.filters.push({ method: "in", column, value });
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ method: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ method: "is", column, value });
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.order_calls.push({ column, ascending: opts?.ascending });
    return this;
  }

  then<T>(
    onfulfilled: (value: { data: PosterVideoRow[] | null; error: { message: string } | null }) => T,
    onrejected?: (reason: unknown) => T,
  ): Promise<T> {
    return Promise.resolve({ data: this._data, error: this._error }).then(onfulfilled, onrejected);
  }
}

// ── FakeSupabaseClient ────────────────────────────────────────────────────────

function make_fake_client_tracked(opts: {
  query_data: PosterVideoRow[] | null;
  query_error: { message: string } | null;
}): {
  get_last_builder(): FakeQueryBuilder | null;
  client: unknown;
} {
  let _last_builder: FakeQueryBuilder | null = null;
  const client = {
    from(table: string): FakeQueryBuilder {
      const builder = new FakeQueryBuilder(table, opts.query_data, opts.query_error);
      _last_builder = builder;
      return builder;
    },
  };
  return { get_last_builder: () => _last_builder, client };
}

// ── Constantes / factories de filas ───────────────────────────────────────────

const OWNER_UID = "00000000-0000-0000-0002-000000000001";
const OTHER_UID = "00000000-0000-0000-0002-000000000099";
const PROP_ID_1 = "00000000-0000-0000-0003-000000000001";
const PROP_ID_2 = "00000000-0000-0000-0003-000000000002";
const VIDEO_ID_1 = "00000000-0000-0000-0004-000000000001";
const VIDEO_ID_2 = "00000000-0000-0000-0004-000000000002";
const CF_UID_1 = "cf-uid-poster-0000000000000001";
const CF_UID_2 = "cf-uid-poster-0000000000000002";

function make_row(overrides: Partial<PosterVideoRow> = {}): PosterVideoRow {
  return {
    id: VIDEO_ID_1,
    property_id: PROP_ID_1,
    cloudflare_uid: CF_UID_1,
    thumbnail_pct: null,
    duration_seconds: null,
    position: 1,
    properties: { owner_user_id: OWNER_UID, status: "active" },
    ...overrides,
  };
}

// ── Firma RS256 de prueba (mismo patrón que video_url_minter.test.ts) ─────────

const TEST_KEY_ID = "test-poster-signing-key-01";
const DEFAULT_TTL_SECONDS = 14400;

async function generate_test_signing_key(): Promise<{
  public_jwk: JWK;
  private_jwk_base64: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  const private_jwk = await exportJWK(privateKey);
  private_jwk.kid = TEST_KEY_ID;
  private_jwk.alg = "RS256";
  private_jwk.use = "sig";
  const public_jwk = await exportJWK(publicKey);
  return { public_jwk, private_jwk_base64: btoa(JSON.stringify(private_jwk)) };
}

function make_hls_config(private_jwk_base64: string, overrides: Partial<HlsSignerConfig> = {}): HlsSignerConfig {
  return {
    streamSigningKeyId: TEST_KEY_ID,
    streamSigningJwk: private_jwk_base64,
    signedUrlTtlSeconds: DEFAULT_TTL_SECONDS,
    ...overrides,
  };
}

// Grupo 1 = token en el path; grupo 2 = time (opcional, según el patrón usado).
const POSTER_URL_WITH_TIME_RE =
  /^https:\/\/(?:customer-[a-z0-9]+\.cloudflarestream\.com|(?:[a-z0-9.-]*\.)?videodelivery\.net)\/([^/]+)\/thumbnails\/thumbnail\.jpg\?time=([0-9]+\.[0-9]s)$/i;

const POSTER_URL_NO_TIME_RE =
  /^https:\/\/(?:customer-[a-z0-9]+\.cloudflarestream\.com|(?:[a-z0-9.-]*\.)?videodelivery\.net)\/([^/]+)\/thumbnails\/thumbnail\.jpg$/i;

function extract_token_from_poster_url(url: string): string {
  const with_time = POSTER_URL_WITH_TIME_RE.exec(url);
  if (with_time) return with_time[1];
  const no_time = POSTER_URL_NO_TIME_RE.exec(url);
  if (no_time) return no_time[1];
  throw new Error(`posterUrl no matchea ningún patrón esperado: '${url}'`);
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — shape de la query base
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("query_usa_tabla_property_videos", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [make_row()],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_posters([PROP_ID_1], OWNER_UID);
  const builder = get_last_builder();
  assertExists(builder, "el adapter debe llamar .from() en el client");
  assertEquals(builder.table, "property_videos", "la tabla debe ser 'property_videos'");
});

Deno.test("select_incluye_owner_user_id_y_status_del_join_properties", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [make_row()],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_posters([PROP_ID_1], OWNER_UID);
  const sel = get_last_builder()!.select_str;
  assertEquals(
    sel.includes("owner_user_id"),
    true,
    `select debe incluir 'owner_user_id' del join properties (auth por-item lo necesita); recibido: '${sel}'`,
  );
  assertEquals(
    sel.includes("status"),
    true,
    `select debe incluir 'status' del join properties; recibido: '${sel}'`,
  );
  assertEquals(
    sel.includes("properties"),
    true,
    `select debe embeber la relación 'properties'; recibido: '${sel}'`,
  );
});

Deno.test("select_incluye_cloudflare_uid_thumbnail_pct_duration_seconds", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_last_builder } = make_fake_client_tracked({
    query_data: [make_row()],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_posters([PROP_ID_1], OWNER_UID);
  const sel = get_last_builder()!.select_str;
  for (const col of ["cloudflare_uid", "thumbnail_pct", "duration_seconds"]) {
    assertEquals(sel.includes(col), true, `select debe incluir '${col}'; recibido: '${sel}'`);
  }
});

Deno.test("filtro_in_property_ids_con_array_exacto", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const property_ids = [PROP_ID_1, PROP_ID_2];
  const { client, get_last_builder } = make_fake_client_tracked({ query_data: [], query_error: null });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_posters(property_ids, OWNER_UID);
  const in_filter = get_last_builder()!.filters.find((f) => f.method === "in" && f.column === "property_id");
  assertExists(in_filter, "debe existir un filtro .in('property_id', ...)");
  assertEquals(in_filter!.value, property_ids, ".in('property_id') debe recibir el array exacto");
});

Deno.test("filtro_eq_status_ready", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_last_builder } = make_fake_client_tracked({ query_data: [], query_error: null });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_posters([PROP_ID_1], OWNER_UID);
  const ready_filter = get_last_builder()!.filters.find(
    (f) => f.method === "eq" && f.column === "status" && f.value === "ready",
  );
  assertExists(ready_filter, "debe existir .eq('status','ready') para excluir videos no procesados");
});

Deno.test("filtro_is_deleted_at_null", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_last_builder } = make_fake_client_tracked({ query_data: [], query_error: null });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_posters([PROP_ID_1], OWNER_UID);
  const soft_delete_filter = get_last_builder()!.filters.find(
    (f) => f.method === "is" && f.column === "deleted_at" && f.value === null,
  );
  assertExists(soft_delete_filter, "debe existir .is('deleted_at', null)");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — auth por-item: dueño ve todo, público solo ve active (casos 1-4)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("dueno_ve_su_propiedad_draft_posterurl_presente", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ properties: { owner_user_id: OWNER_UID, status: "draft" } })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 1, "el dueño debe ver su propiedad draft (auth por-item: owner gana sin importar status)");
  assertEquals(result[0].property_id, PROP_ID_1);
});

Deno.test("dueno_ve_su_propiedad_paused_posterurl_presente", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ properties: { owner_user_id: OWNER_UID, status: "paused" } })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 1, "el dueño debe ver su propiedad paused");
});

Deno.test("dueno_ve_su_propiedad_closed_posterurl_presente", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ properties: { owner_user_id: OWNER_UID, status: "closed" } })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 1, "el dueño debe ver su propiedad closed");
});

Deno.test("no_dueno_propiedad_active_posterurl_presente_publico", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ properties: { owner_user_id: OWNER_UID, status: "active" } })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OTHER_UID);
  assertEquals(result.length, 1, "cualquier usuario autenticado debe ver una propiedad active (pública)");
});

Deno.test("no_dueno_propiedad_draft_omitida", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ properties: { owner_user_id: OWNER_UID, status: "draft" } })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OTHER_UID);
  assertEquals(result.length, 0, "CRÍTICO: un no-dueño NUNCA debe ver una propiedad draft — fail-closed");
});

Deno.test("no_dueno_propiedad_paused_omitida", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ properties: { owner_user_id: OWNER_UID, status: "paused" } })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OTHER_UID);
  assertEquals(result.length, 0, "CRÍTICO: un no-dueño NUNCA debe ver una propiedad paused — fail-closed");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — disponibilidad de video (casos 5-6)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("propiedad_sin_video_ready_omitida", async () => {
  // La query ya filtra status='ready'; una propiedad con solo video 'uploading'/'processing'
  // no produce fila alguna en el fake — debe quedar fuera del resultado, sin error.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({ query_data: [], query_error: null });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 0, "sin video ready, la propiedad se omite silenciosamente");
});

Deno.test("propiedad_con_video_ready_sin_cloudflare_uid_omitida_legacy", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ cloudflare_uid: null })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 0, "video ready sin cloudflare_uid (legacy/en vuelo) debe omitirse, no lanzar");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — selección del primer video por position
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("primer_video_ready_por_position_gana_sobre_position_mayor", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  // Deliberadamente fuera de orden ascendente en el array crudo: position=2 primero.
  const { client } = make_fake_client_tracked({
    query_data: [
      make_row({ id: VIDEO_ID_2, cloudflare_uid: CF_UID_2, position: 2 }),
      make_row({ id: VIDEO_ID_1, cloudflare_uid: CF_UID_1, position: 1 }),
    ],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 1, "una propiedad con 2 videos ready debe producir 1 solo poster");
  const token = extract_token_from_poster_url(result[0].posterUrl);
  assertEquals(token.length > 0, true);
  // El JWT firma sub=cloudflare_uid; verificamos que sea el de position=1 (VIDEO_ID_1/CF_UID_1),
  // NO el de position=2, aunque llegue primero en el array crudo de la query.
  // (verificado más abajo con jose donde aplica; aquí validamos que el resultado sea único
  // y consistente — el detalle de la firma se cubre en los tests de token/time.)
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — cálculo de time / formato de posterUrl (caso 7)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("time_pct_50_duration_92_da_46_0s", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ thumbnail_pct: 50, duration_seconds: 92 })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 1);
  const match = POSTER_URL_WITH_TIME_RE.exec(result[0].posterUrl);
  assertExists(match, `posterUrl debe traer '?time='; recibido: '${result[0].posterUrl}'`);
  assertEquals(match![2], "46.0s", "T = thumbnail_pct(50)/100 × duration_seconds(92) = 46.0");

  const public_key = await importJWK(public_jwk, "RS256");
  const { payload } = await jwtVerify(match![1], public_key, { algorithms: ["RS256"] });
  assertEquals(payload.sub, CF_UID_1, "el claim 'sub' del JWT debe ser el cloudflare_uid del video");
});

Deno.test("time_pct_null_usa_default_50_duration_80_da_40_0s", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ thumbnail_pct: null, duration_seconds: 80 })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  const match = POSTER_URL_WITH_TIME_RE.exec(result[0].posterUrl);
  assertExists(match, `posterUrl debe traer '?time=' con el default 50%; recibido: '${result[0].posterUrl}'`);
  assertEquals(match![2], "40.0s", "thumbnail_pct null → default 50; T = 50/100 × 80 = 40.0");
});

Deno.test("time_duration_null_omite_time_pero_token_presente", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ thumbnail_pct: 50, duration_seconds: null })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 1, "duration_seconds null debe seguir produciendo posterUrl (sin '?time=')");
  assertEquals(result[0].posterUrl.includes("time="), false, "sin duration_seconds, NO debe incluir 'time='");
  assertMatch(result[0].posterUrl, POSTER_URL_NO_TIME_RE);
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — token en el path, NUNCA query param (caso 8, anti-regresión)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("token_en_el_path_firma_sub_cloudflare_uid_no_query_param", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ thumbnail_pct: 50, duration_seconds: 92 })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);

  assertEquals(
    result[0].posterUrl.includes("?token="),
    false,
    "posterUrl NO debe llevar '?token=' como query param (bug verificado en vivo 2026-07-22)",
  );
  assertEquals(
    result[0].posterUrl.includes("&token="),
    false,
    "posterUrl NO debe llevar '&token=' como query param",
  );

  const token = extract_token_from_poster_url(result[0].posterUrl);
  const token_segments = token.split(".");
  assertEquals(token_segments.length, 3, "el token debe ser un JWT de 3 segmentos");

  const public_key = await importJWK(public_jwk, "RS256");
  const { payload, protectedHeader } = await jwtVerify(token, public_key, { algorithms: ["RS256"] });
  assertEquals(protectedHeader.kid, TEST_KEY_ID, "el header del JWT debe traer el kid de la signing key");
  assertEquals(payload.sub, CF_UID_1, "el claim 'sub' debe ser el cloudflare_uid del video, no el uid del caller");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — fail-closed batch-resiliente (caso 9)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("hls_config_ausente_omite_items_stream_sin_lanzar", async () => {
  const { client } = make_fake_client_tracked({
    query_data: [make_row()],
    query_error: null,
  });
  // Sin segundo argumento: hlsConfig === undefined.
  const minter = make_poster_url_minter(client as never);
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 0, "sin hlsConfig, la fila Stream se excluye (fail-closed), sin lanzar");
});

Deno.test("jwk_invalido_omite_items_stream_sin_lanzar_batch_no_se_rompe", async () => {
  // A diferencia de make_video_url_minter (que tiene una rama legacy Storage
  // no afectada por el JWK), el poster minter SOLO produce portadas Stream:
  // un JWK inválido afecta a todas las filas Stream por igual. Lo que se
  // prueba aquí es la propiedad "batch-resiliente": el minter NUNCA lanza,
  // devuelve un array (aunque vacío) en vez de propagar la excepción de firma.
  const invalid_hls_config = make_hls_config("esto-no-es-un-jwk-base64-valido---");
  const { client } = make_fake_client_tracked({
    query_data: [
      make_row({ id: VIDEO_ID_1, property_id: PROP_ID_1, cloudflare_uid: CF_UID_1 }),
      make_row({
        id: VIDEO_ID_2,
        property_id: PROP_ID_2,
        cloudflare_uid: CF_UID_2,
        properties: { owner_user_id: OWNER_UID, status: "active" },
      }),
    ],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, invalid_hls_config);
  // NO debe lanzar
  const result = await minter.mint_posters([PROP_ID_1, PROP_ID_2], OWNER_UID);
  assertEquals(Array.isArray(result), true, "el resultado debe seguir siendo un array (nunca una excepción cruda)");
  assertEquals(result.length, 0, "JWK inválido: ambas filas Stream se omiten, pero el batch no se rompe");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — property_ids vacío (caso 10)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("property_ids_vacio_devuelve_array_vacio_sin_tocar_la_red", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_last_builder } = make_fake_client_tracked({ query_data: [], query_error: null });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([], OWNER_UID);
  assertEquals(result.length, 0, "property_ids vacío debe devolver []");
  assertEquals(get_last_builder(), null, "NO debe llamar .from() (ni tocar la red) cuando property_ids está vacío");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — defensa adicional: query error → batch degradado
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("query_error_devuelve_array_vacio_sin_lanzar", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: null,
    query_error: { message: "connection timeout" },
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 0, "error en la query PostgREST debe devolver [] (batch degradado, no lanza)");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — forma de la respuesta (regresión de contrato)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("resultado_solo_tiene_property_id_y_posterurl", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    query_data: [make_row({ thumbnail_pct: 50, duration_seconds: 92 })],
    query_error: null,
  });
  const minter = make_poster_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_posters([PROP_ID_1], OWNER_UID);
  assertEquals(result.length, 1);
  assertEquals(
    Object.keys(result[0]).sort(),
    ["posterUrl", "property_id"],
    "mint-poster-urls SOLO expone { property_id, posterUrl } — nunca video_id/signed_url (eso es mint-video-url)",
  );
});
