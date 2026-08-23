/**
 * Tests RED — subtarea 169.5 (EF mint-ad-urls, calco de mint-poster-urls)
 * SUT: make_ad_url_minter(client, hlsConfig?) en _shared/clients.ts
 *
 * Framework: Deno.test + @std/assert + jose (verificación de JWT RS256)
 * Ejecutar:
 *   cd supabase/functions && deno test --allow-env --allow-net --allow-read \
 *     --config deno.json _shared/ad_url_minter.test.ts
 *
 * SEAMS (interfaz bajo test):
 * - AdUrlMinter.mint_ad_urls(creative_ids, caller_id) — el adapter real, NUNCA la
 *   EF completa (eso es mint-ad-urls/handler.test.ts, con un fake determinista).
 * - El SupabaseClient real se sustituye por un fake que registra cada llamada a
 *   .from(table)/.select()/.in()/.eq()/.maybeSingle() por tabla, para verificar la
 *   shape EXACTA de la query (lección #8 del repo: mock-vs-prod; y el bug real de
 *   169.4 — un .rpc() a una función `private` que PostgREST no expone pasó 32
 *   tests con dobles y dio 403 a todo el mundo en el stack real).
 * - La firma RS256 real se verifica con jose contra una clave pública de prueba
 *   (frontera de confianza real, nunca mockeada) — mismo patrón que
 *   poster_url_minter.test.ts / video_url_minter.test.ts.
 *
 * ⚠️ DECISIÓN DE DISEÑO DE ESTE RED (documentada para que GREEN y el guardian la
 * puedan confirmar o corregir — el plan de 169.5 solo dice "calco de
 * mint-poster-urls, autz por item, nunca URL sin firmar"; el mecanismo EXACTO de
 * autorización no estaba fijado en ninguna migración ni doc):
 *   - ad_creatives (20260816000005) NO tiene un owner_user_id directo como
 *     property_videos⋈properties — la "dueña" de un creativo es su agencia
 *     (agency_id, columna directa). Auth por-item = MIEMBRO ACTIVO de esa agencia
 *     (private.agency_role_of, mismo criterio que la RLS ad_creatives_select,
 *     20260816000005_ads_schema.sql:192-198: CUALQUIER rol activo, no solo
 *     owner/admin) O el creativo está referenciado por al menos un `ads` con
 *     status='active' Y vigente (now() BETWEEN starts_at AND ends_at) — el
 *     análogo de "properties.status = 'active'" en mint-poster-urls.
 *   - Resolución de la agencia del caller: MISMA query que
 *     make_advertiser_authorizer (169.4, clients.ts) —
 *     agency_members.select('agency_id').eq('user_id',caller_id).eq('status','active').maybeSingle()
 *     — reuso deliberado del mecanismo ya establecido, SIN el paso adicional de
 *     org_can_advertise (ver aquí no hace falta: mint-ad-urls solo lee, no publica).
 *   - ad_creatives NO tiene thumbnail_pct (a diferencia de property_videos) — el
 *     time del poster SIEMPRE usa el default 50% de build_poster_url (se le pasa
 *     thumbnail_pct=null, nunca un valor propio).
 * Si esta interpretación no es la intención real, es un bloqueante a resolver
 * ANTES de GREEN — repórtalo, no lo asumas en la implementación.
 *
 * ─── EDGE CASES CUBIERTOS (169.5) ────────────────────────────────────────────
 *
 * ### Shape de la query (lección #8 + el bug real de 169.4)
 * - query_ad_creatives_usa_tabla_correcta_filtro_in_y_status_ready
 * - select_incluye_agency_id_cloudflare_uid_duration_seconds_y_relacion_ads
 * - resuelve_agencia_del_caller_consultando_agency_members_status_active
 *
 * ### Auth por-item: miembro de la agencia ve todo, público solo ve ads activos vigentes
 * - miembro_de_la_agencia_ve_su_creativo_ready_sin_anuncio_activo
 * - no_miembro_sin_anuncio_activo_omitido_fail_closed
 * - no_miembro_con_ads_active_vigente_ve_posterurl_publico
 * - no_miembro_con_ads_active_pero_fuera_de_vigencia_omitido
 * - no_miembro_con_ads_pending_review_omitido
 *
 * ### Ronda 2 (guardián FAIL, 2026-08-16): "no aborta el lote" no tenía un
 * solo test con MÁS de 1 fila — los 14 datasets previos eran de una sola fila,
 * donde continue/break/return[] son indistinguibles. Este SÍ diferencia:
 * - lote_mixto_autorizada_no_autorizada_autorizada_omite_solo_la_del_medio
 *
 * ### Nunca una URL sin firmar / fail-closed batch-resiliente
 * - token_en_el_path_nunca_query_param
 * - sin_cloudflare_uid_omitida_sin_lanzar
 * - hls_config_ausente_omite_sin_lanzar
 * - jwk_invalido_omite_sin_lanzar_batch_no_se_rompe
 *
 * ### Boundary
 * - creative_ids_vacio_no_toca_la_red
 * - query_error_devuelve_array_vacio_sin_lanzar
 *
 * ### Forma de la respuesta (regresión de contrato)
 * - resultado_solo_tiene_creative_id_y_posterurl
 */

import { assertEquals, assertExists } from "@std/assert";
import { exportJWK, generateKeyPair, importJWK, type JWK, jwtVerify } from "jose";
import { make_ad_url_minter } from "./clients.ts";
import type { HlsSignerConfig } from "../mint-video-url/types.ts";

// ── Tipos internos del fake ───────────────────────────────────────────────────

interface FilterCall {
  method: "in" | "eq" | "is";
  column: string;
  value: unknown;
}

interface AdRow {
  status: string;
  starts_at: string;
  ends_at: string;
}

interface AdCreativeUrlRow {
  id: string;
  agency_id: string;
  cloudflare_uid: string | null;
  duration_seconds: number | null;
  status: string;
  ads: AdRow[];
}

// ── FakeQueryBuilder (thenable y chainable, con soporte a maybeSingle) ───────

class FakeQueryBuilder {
  table: string;
  select_str = "";
  filters: FilterCall[] = [];
  private _single = false;
  private _data: unknown;
  private _error: { message: string } | null;

  constructor(table: string, data: unknown, error: { message: string } | null) {
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

  maybeSingle(): this {
    this._single = true;
    return this;
  }

  then<T>(
    onfulfilled: (value: { data: unknown; error: { message: string } | null }) => T,
    onrejected?: (reason: unknown) => T,
  ): Promise<T> {
    const data = this._single
      ? (Array.isArray(this._data) ? (this._data[0] ?? null) : this._data)
      : this._data;
    return Promise.resolve({ data, error: this._error }).then(onfulfilled, onrejected);
  }
}

// ── FakeSupabaseClient — enruta por tabla, cada tabla con su propio dataset ──

function make_fake_client_tracked(opts: {
  ad_creatives_data: AdCreativeUrlRow[] | null;
  ad_creatives_error?: { message: string } | null;
  agency_members_data?: { agency_id: string } | null;
  agency_members_error?: { message: string } | null;
  // 208.5: la tabla `users` resuelve si el caller es admin de plataforma.
  users_data?: { role: string } | null;
  users_error?: { message: string } | null;
}): {
  get_builder(table: string): FakeQueryBuilder | null;
  from_calls: string[];
  client: unknown;
} {
  const builders: Record<string, FakeQueryBuilder> = {};
  const from_calls: string[] = [];
  const client = {
    from(table: string): FakeQueryBuilder {
      from_calls.push(table);
      let builder: FakeQueryBuilder;
      if (table === "agency_members") {
        builder = new FakeQueryBuilder(
          table,
          opts.agency_members_data ?? null,
          opts.agency_members_error ?? null,
        );
      } else if (table === "users") {
        builder = new FakeQueryBuilder(table, opts.users_data ?? null, opts.users_error ?? null);
      } else {
        builder = new FakeQueryBuilder(table, opts.ad_creatives_data, opts.ad_creatives_error ?? null);
      }
      builders[table] = builder;
      return builder;
    },
  };
  return { get_builder: (table: string) => builders[table] ?? null, from_calls, client };
}

// ── Constantes / factories de filas ───────────────────────────────────────────

const MEMBER_UID = "00000000-0000-0000-0005-000000000001";
const OUTSIDER_UID = "00000000-0000-0000-0005-000000000099";
const AGENCY_ID = "00000000-0000-0000-0006-000000000001";
const OTHER_AGENCY_ID = "00000000-0000-0000-0006-000000000002";
const CREATIVE_ID_1 = "00000000-0000-0000-0007-000000000001";
const CREATIVE_ID_2 = "00000000-0000-0000-0007-000000000002";
const CREATIVE_ID_3 = "00000000-0000-0000-0007-000000000003";
const CF_UID_1 = "cf-uid-ad-0000000000000001";
const CF_UID_2 = "cf-uid-ad-0000000000000002";
const CF_UID_3 = "cf-uid-ad-0000000000000003";

const NOW_MS = Date.now();
function iso(offset_ms: number): string {
  return new Date(NOW_MS + offset_ms).toISOString();
}

const VIGENTE: AdRow = { status: "active", starts_at: iso(-86_400_000), ends_at: iso(86_400_000) };
const EXPIRADO: AdRow = { status: "active", starts_at: iso(-172_800_000), ends_at: iso(-86_400_000) };
const PENDING_REVIEW: AdRow = { status: "pending_review", starts_at: iso(-86_400_000), ends_at: iso(86_400_000) };

function make_row(overrides: Partial<AdCreativeUrlRow> = {}): AdCreativeUrlRow {
  return {
    id: CREATIVE_ID_1,
    agency_id: AGENCY_ID,
    cloudflare_uid: CF_UID_1,
    duration_seconds: null,
    status: "ready",
    ads: [],
    ...overrides,
  };
}

// ── Firma RS256 de prueba (mismo patrón que poster_url_minter.test.ts) ───────

const TEST_KEY_ID = "test-ad-url-signing-key-01";
const DEFAULT_TTL_SECONDS = 14400;

async function generate_test_signing_key(): Promise<{ public_jwk: JWK; private_jwk_base64: string }> {
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

function extract_token_from_poster_url(url: string): string {
  const match = /^https:\/\/[a-z0-9.-]+\/([^/]+)\/thumbnails\/thumbnail\.jpg(?:\?.*)?$/i.exec(url);
  if (!match) throw new Error(`posterUrl no matchea el patrón esperado: '${url}'`);
  return match[1];
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — shape de la query
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("query_ad_creatives_usa_tabla_correcta_filtro_in_y_status_ready", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_builder } = make_fake_client_tracked({
    ad_creatives_data: [make_row()],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);

  const builder = get_builder("ad_creatives");
  assertExists(builder, "el adapter debe llamar .from('ad_creatives')");
  const in_filter = builder!.filters.find((f) => f.method === "in" && f.column === "id");
  assertExists(in_filter, "debe existir .in('id', creative_ids)");
  assertEquals(in_filter!.value, [CREATIVE_ID_1]);
  const ready_filter = builder!.filters.find(
    (f) => f.method === "eq" && f.column === "status" && f.value === "ready",
  );
  assertExists(ready_filter, "debe existir .eq('status','ready') para excluir creativos no procesados");
});

Deno.test("select_incluye_agency_id_cloudflare_uid_duration_seconds_y_relacion_ads", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_builder } = make_fake_client_tracked({
    ad_creatives_data: [make_row()],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  const sel = get_builder("ad_creatives")!.select_str;
  for (const col of ["agency_id", "cloudflare_uid", "duration_seconds", "ads"]) {
    assertEquals(sel.includes(col), true, `select debe incluir '${col}'; recibido: '${sel}'`);
  }
});

Deno.test("resuelve_agencia_del_caller_consultando_agency_members_status_active", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, get_builder } = make_fake_client_tracked({
    ad_creatives_data: [make_row()],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  const builder = get_builder("agency_members");
  assertExists(builder, "el adapter debe resolver la agencia activa del caller consultando agency_members");
  const user_filter = builder!.filters.find((f) => f.method === "eq" && f.column === "user_id" && f.value === MEMBER_UID);
  assertExists(user_filter, ".eq('user_id', caller_id) debe usar el caller_id exacto");
  const status_filter = builder!.filters.find((f) => f.method === "eq" && f.column === "status" && f.value === "active");
  assertExists(status_filter, "debe filtrar por membresía ACTIVA (status='active')");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — auth por-item
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("miembro_de_la_agencia_ve_su_creativo_ready_sin_anuncio_activo", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [] })],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(result.length, 1, "un miembro de la agencia dueña debe ver su propio creativo, aun sin ads activos");
});

Deno.test("no_miembro_sin_anuncio_activo_omitido_fail_closed", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [] })],
    agency_members_data: { agency_id: OTHER_AGENCY_ID }, // el caller es de OTRA agencia
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], OUTSIDER_UID);
  assertEquals(result.length, 0, "CRÍTICO: sin membresía y sin ad activo, el creativo debe omitirse — fail-closed");
});

Deno.test("no_miembro_con_ads_active_vigente_ve_posterurl_publico", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [VIGENTE] })],
    agency_members_data: { agency_id: OTHER_AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], OUTSIDER_UID);
  assertEquals(result.length, 1, "un ad activo y vigente debe ser visible para cualquier caller autenticado");
});

Deno.test("no_miembro_con_ads_active_pero_fuera_de_vigencia_omitido", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [EXPIRADO] })],
    agency_members_data: { agency_id: OTHER_AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], OUTSIDER_UID);
  assertEquals(result.length, 0, "status=active pero fuera de [starts_at,ends_at] NO es público — fail-closed");
});

Deno.test("no_miembro_con_ads_pending_review_omitido", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [PENDING_REVIEW] })],
    agency_members_data: { agency_id: OTHER_AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], OUTSIDER_UID);
  assertEquals(result.length, 0, "CRÍTICO: un ad pending_review NUNCA debe ser visible a un no-miembro — fail-closed");
});

Deno.test("lote_mixto_autorizada_no_autorizada_autorizada_omite_solo_la_del_medio", async () => {
  // Diferenciador de continue vs break vs return[] (guardián, ronda 2): con
  // UNA sola fila los tres son indistinguibles. Con 3 filas en el MISMO
  // .in(), donde la del medio NO está autorizada, el comportamiento correcto
  // (continue) debe seguir evaluando la 3ª — break/return[] la perderían.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [
      make_row({ id: CREATIVE_ID_1, cloudflare_uid: CF_UID_1, agency_id: AGENCY_ID, ads: [] }), // miembro → autorizada
      make_row({ id: CREATIVE_ID_2, cloudflare_uid: CF_UID_2, agency_id: OTHER_AGENCY_ID, ads: [] }), // ni miembro ni ad activo → NO autorizada
      make_row({ id: CREATIVE_ID_3, cloudflare_uid: CF_UID_3, agency_id: OTHER_AGENCY_ID, ads: [VIGENTE] }), // pública (ad activo vigente) → autorizada
    ],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1, CREATIVE_ID_2, CREATIVE_ID_3], MEMBER_UID);

  assertEquals(
    result.length,
    2,
    "un continue/return[]/break equivocado en la fila del medio produciría 0, 1 (solo la 1ª) o 3 en vez de 2",
  );
  const returned_ids = result.map((r) => r.creative_id).sort();
  assertEquals(
    returned_ids,
    [CREATIVE_ID_1, CREATIVE_ID_3].sort(),
    "deben regresar EXACTAMENTE la 1ª y la 3ª — la del medio se omite SIN abortar ni truncar el resto del lote",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — nunca una URL sin firmar / fail-closed batch-resiliente
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("token_en_el_path_nunca_query_param", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ duration_seconds: 20 })],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(result.length, 1);
  assertEquals(result[0].posterUrl.includes("?token="), false, "NUNCA como query param");
  assertEquals(result[0].posterUrl.includes("&token="), false, "NUNCA como query param");

  const token = extract_token_from_poster_url(result[0].posterUrl);
  const public_key = await importJWK(public_jwk, "RS256");
  const { payload, protectedHeader } = await jwtVerify(token, public_key, { algorithms: ["RS256"] });
  assertEquals(protectedHeader.kid, TEST_KEY_ID);
  assertEquals(payload.sub, CF_UID_1, "el claim 'sub' debe ser el cloudflare_uid del creativo");
});

Deno.test("sin_cloudflare_uid_omitida_sin_lanzar", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ cloudflare_uid: null })],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(result.length, 0, "sin cloudflare_uid no hay nada que firmar — se omite, no se lanza");
});

Deno.test("hls_config_ausente_omite_sin_lanzar", async () => {
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row()],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never); // sin hlsConfig
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(result.length, 0, "sin hlsConfig, fail-closed: se excluye sin lanzar");
});

Deno.test("jwk_invalido_omite_sin_lanzar_batch_no_se_rompe", async () => {
  const invalid_hls_config = make_hls_config("esto-no-es-un-jwk-base64-valido---");
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row()],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, invalid_hls_config);
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(Array.isArray(result), true, "el resultado debe seguir siendo un array, nunca una excepción cruda");
  assertEquals(result.length, 0, "JWK inválido: la fila se omite, pero el batch no se rompe");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — boundary
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("creative_ids_vacio_no_toca_la_red", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client, from_calls } = make_fake_client_tracked({ ad_creatives_data: [] });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([], MEMBER_UID);
  assertEquals(result, []);
  assertEquals(from_calls.length, 0, "creative_ids vacío no debe tocar la red (ni ad_creatives ni agency_members)");
});

Deno.test("query_error_devuelve_array_vacio_sin_lanzar", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: null,
    ad_creatives_error: { message: "connection timeout" },
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(result.length, 0, "error en la query de ad_creatives debe degradar a [] sin lanzar");
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — forma de la respuesta
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("resultado_solo_tiene_creative_id_posterurl_y_videourl", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ duration_seconds: 20 })],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(result.length, 1);
  assertEquals(
    Object.keys(result[0]).sort(),
    ["creative_id", "posterUrl", "videoUrl"],
    "mint-ad-urls SOLO expone { creative_id, posterUrl, videoUrl } — nunca agency_id/status/cloudflare_uid",
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 170.8 — URL DE REPRODUCCIÓN del creativo.
//
// mint-ad-urls solo firmaba el PÓSTER, así que un anuncio en el feed no podía
// reproducir: era una tarjeta estática dentro de un feed de video, y el
// anunciante paga por una impresión de VIDEO.
//
// No hace falta un mecanismo nuevo: `sign_stream_token` ya emite un JWT con
// `sub = cloudflare_uid`, y ese MISMO token sirve el manifest HLS igual que
// sirve el thumbnail. La ruta la arma `build_hls_url`, que ya existe y ya
// documenta el gotcha de Cloudflare (el token va en el PATH, nunca como query
// param — con `?token=` Stream responde 401).
// ═══════════════════════════════════════════════════════════════════════════

function extract_token_from_video_url(url: string): string {
  const match = /^https:\/\/[a-z0-9.-]+\/([^/]+)\/manifest\/video\.m3u8$/i.exec(url);
  if (!match) throw new Error(`videoUrl no matchea el patrón esperado: '${url}'`);
  return match[1];
}

Deno.test("videoUrl_es_el_manifest_hls_firmado", async () => {
  const { public_jwk, private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ duration_seconds: 20 })],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);

  assertEquals(result.length, 1);
  const token = extract_token_from_video_url(result[0].videoUrl);
  const public_key = await importJWK(public_jwk, "RS256");
  const { payload, protectedHeader } = await jwtVerify(token, public_key, { algorithms: ["RS256"] });
  assertEquals(protectedHeader.kid, TEST_KEY_ID);
  assertEquals(payload.sub, CF_UID_1, "el claim 'sub' debe ser el cloudflare_uid del creativo");
});

Deno.test("videoUrl_token_en_el_path_nunca_query_param", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ duration_seconds: 20 })],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);
  assertEquals(result[0].videoUrl.includes("?token="), false, "NUNCA como query param (Stream da 401)");
  assertEquals(result[0].videoUrl.includes("&token="), false, "NUNCA como query param");
});

Deno.test("videoUrl_y_posterUrl_comparten_EXACTAMENTE_el_mismo_token", async () => {
  // Firmar dos veces sería gastar dos JWT por creativo y —peor— podría producir
  // TTLs distintos, con el póster expirando en otro momento que el video.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ duration_seconds: 20 })],
    agency_members_data: { agency_id: AGENCY_ID },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], MEMBER_UID);

  assertEquals(
    extract_token_from_video_url(result[0].videoUrl),
    extract_token_from_poster_url(result[0].posterUrl),
    "un solo sign_stream_token por creativo: mismo token para póster y manifest",
  );
});


// ═══════════════════════════════════════════════════════════════════════════
// 208.5 — EL ADMIN DEBE PODER VER EL CREATIVO QUE VA A MODERAR
//
// 🔴 EL HUECO. La autorización por item era
// `authorized = is_owner_member || has_active_vigente_ad`, sin ninguna rama de
// admin (`grep -rn 'is_admin|admin' mint-ad-urls/handler.ts` → CERO). Un admin
// moderando un anuncio en `pending_review` no es miembro de esa organización y
// el anuncio todavía NO está `active`: falla las dos condiciones. Como el
// fail-closed es POR ITEM y silencioso, recibía `{ urls: [] }` — ni video ni
// portada. La cola de moderación de 208.3 sería una pantalla donde no se puede
// ver lo que se modera, y aprobar a ciegas es peor que no tener la pantalla.
//
// Es el análogo exacto de lo que la policy `ads_select` YA hace
// (20260816000005:205-210): `agency_role_of(...) OR private.is_admin() OR
// (activo y vigente)`. El minter implementó las cláusulas 1 y 3 y se saltó la
// 2. No se revierte una decisión de diseño: se cierra una omisión, igual que
// 208.1 con el grafo de estados.
//
// 🔴 EL ADMIN GANA LECTURA, NADA MÁS. Sigue firmando con sign_stream_token y
// el token sigue en el PATH (#68). El resto del fail-closed por item queda
// intacto.
//
// 🔴 LA CONSULTA A `users` ES PEREZOSA. mint-ad-urls es camino caliente: el
// feed lo llama por cada lote de anuncios. Si todas las filas ya están
// autorizadas (el caso normal del feed), `users` NO debe consultarse — de lo
// contrario esta corrección le cobra una query extra a cada scroll de cada
// usuario para servir a un puñado de admins.
// ═══════════════════════════════════════════════════════════════════════════

const ADMIN_UID = "00000000-0000-0000-0005-000000000042";

Deno.test("208.5 admin_no_miembro_ve_el_creativo_de_un_ad_en_pending_review", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [PENDING_REVIEW] })],
    agency_members_data: null, // el admin no es miembro de ninguna organización
    users_data: { role: "admin" },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], ADMIN_UID);

  assertEquals(
    result.length,
    1,
    "CRÍTICO: sin esto la cola de moderación de 208.3 no puede mostrar el video que se modera",
  );
  assertExists(result[0].posterUrl);
  assertExists(result[0].videoUrl);
});

Deno.test("208.5 admin_ve_tambien_un_creativo_sin_ningun_ad_asociado", async () => {
  // Un creativo recién subido y aún sin campaña: el admin igual debe poder
  // revisarlo. `ads: []` no autoriza por vigencia y tampoco hay membresía.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [] })],
    agency_members_data: null,
    users_data: { role: "admin" },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], ADMIN_UID);
  assertEquals(result.length, 1);
});

Deno.test("208.5 no_admin_sin_membresia_ni_ad_activo_sigue_omitido", async () => {
  // REGRESIÓN: la puerta se abre para `role='admin'`, no para cualquiera que
  // exista en `users`. Un usuario normal debe seguir sin ver nada.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [PENDING_REVIEW] })],
    agency_members_data: { agency_id: OTHER_AGENCY_ID },
    users_data: { role: "user" },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], OUTSIDER_UID);
  assertEquals(result.length, 0, "role='user' NO es admin — el fail-closed se mantiene");
});

Deno.test("208.5 agente_con_role_agent_no_gana_acceso", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [PENDING_REVIEW] })],
    agency_members_data: { agency_id: OTHER_AGENCY_ID },
    users_data: { role: "agent" },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], OUTSIDER_UID);
  assertEquals(result.length, 0);
});

Deno.test("208.5 la_consulta_a_users_usa_el_id_del_caller", async () => {
  const { private_jwk_base64 } = await generate_test_signing_key();
  const tracked = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [PENDING_REVIEW] })],
    agency_members_data: null,
    users_data: { role: "admin" },
  });
  const minter = make_ad_url_minter(tracked.client as never, make_hls_config(private_jwk_base64));
  await minter.mint_ad_urls([CREATIVE_ID_1], ADMIN_UID);

  const builder = tracked.get_builder("users");
  assertExists(builder, "el adapter debe consultar la tabla users para resolver el rol");
  const eq_id = builder.filters.find((f) => f.method === "eq" && f.column === "id");
  assertExists(eq_id, "el rol se resuelve por el id del CALLER, nunca por algo del body");
  assertEquals(eq_id.value, ADMIN_UID);
});

Deno.test("208.5 error_en_la_query_de_users_falla_cerrado_y_omite", async () => {
  // Si no se puede confirmar que es admin, NO es admin. Nunca al revés.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [PENDING_REVIEW] })],
    agency_members_data: null,
    users_data: null,
    users_error: { message: "conexión perdida" },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], ADMIN_UID);
  assertEquals(result.length, 0, "sin confirmación de admin ⇒ omitido, jamás autorizado por defecto");
});

Deno.test("208.5 camino_caliente_del_feed_no_consulta_users", async () => {
  // 🔴 mint-ad-urls lo llama el feed en cada lote. Si todas las filas ya están
  // autorizadas por vigencia, la corrección de 208.5 NO debe cobrarle una query
  // extra a cada scroll de cada usuario. La resolución del rol es perezosa.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const tracked = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [VIGENTE] })],
    agency_members_data: { agency_id: OTHER_AGENCY_ID },
    users_data: { role: "user" },
  });
  const minter = make_ad_url_minter(tracked.client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], OUTSIDER_UID);

  assertEquals(result.length, 1, "el ad vigente sigue siendo público");
  assertEquals(
    tracked.from_calls.includes("users"),
    false,
    "camino caliente: nada que denegar ⇒ el rol no se resuelve",
  );
});

Deno.test("208.5 el_rol_se_resuelve_UNA_sola_vez_por_lote", async () => {
  // Tres creativos no autorizados en el mismo lote no deben producir tres
  // consultas a `users`.
  const { private_jwk_base64 } = await generate_test_signing_key();
  const tracked = make_fake_client_tracked({
    ad_creatives_data: [
      make_row({ id: CREATIVE_ID_1, cloudflare_uid: CF_UID_1, ads: [PENDING_REVIEW] }),
      make_row({ id: CREATIVE_ID_2, cloudflare_uid: CF_UID_2, ads: [PENDING_REVIEW] }),
      make_row({ id: CREATIVE_ID_3, cloudflare_uid: CF_UID_3, ads: [PENDING_REVIEW] }),
    ],
    agency_members_data: null,
    users_data: { role: "admin" },
  });
  const minter = make_ad_url_minter(tracked.client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls(
    [CREATIVE_ID_1, CREATIVE_ID_2, CREATIVE_ID_3],
    ADMIN_UID,
  );

  assertEquals(result.length, 3);
  assertEquals(
    tracked.from_calls.filter((t) => t === "users").length,
    1,
    "memoizado: una consulta de rol por lote, no una por creativo",
  );
});

Deno.test("208.5 el_admin_gana_lectura_pero_el_token_sigue_en_el_PATH", async () => {
  // El acceso nuevo no relaja el mecanismo de firma (#68).
  const { private_jwk_base64 } = await generate_test_signing_key();
  const { client } = make_fake_client_tracked({
    ad_creatives_data: [make_row({ ads: [PENDING_REVIEW] })],
    agency_members_data: null,
    users_data: { role: "admin" },
  });
  const minter = make_ad_url_minter(client as never, make_hls_config(private_jwk_base64));
  const result = await minter.mint_ad_urls([CREATIVE_ID_1], ADMIN_UID);

  assertEquals(result[0].posterUrl.includes("?token="), false);
  assertEquals(result[0].videoUrl.includes("?token="), false);
  assertEquals(result[0].videoUrl.includes("&token="), false);
  assertExists(extract_token_from_video_url(result[0].videoUrl));
});
