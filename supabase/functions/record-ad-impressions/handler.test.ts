// supabase/functions/record-ad-impressions/handler.test.ts
// Tests RED — subtarea 170.6 (EF record-ad-impressions: batch fire-and-forget,
// service_role, valida elegibilidad, recalcula zona server-side, deriva el id
// del cliente — #193).
// Edge Function: record-ad-impressions/handler.ts — orquestación HTTP +
// la lógica de elegibilidad/derivación/zona vive EN el handler (lección de
// #73/169: el adaptador que la esconde detrás de un mock es lo que se
// escapa con la suite en verde), NO detrás de un servicio mockeado opaco.
// Framework: Deno.test + @std/assert
// Runner: cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//         --config deno.json record-ad-impressions/handler.test.ts
//
// SEAMS (interfaz bajo test):
// - Contrato HTTP público de handler(req, deps?): POST
//   { impressions?: AdImpressionEventInput[], cta_taps?: AdCtaTapInput[] } →
//   200 { impressions_accepted, impressions_rejected, cta_taps_recorded } |
//   error { error: { code, message } }.
// - CallerVerifier.verify_caller (DI, fake) — frontera JWT; user_id SIEMPRE
//   sale de aquí, nunca del body.
// - AdsRepository.fetch_ads(ad_ids) (DI, fake DETERMINISTA) — devuelve ads
//   CRUDOS sin pre-filtrar; la decisión de elegibilidad (status='active' AND
//   deps.now() BETWEEN starts_at/ends_at) vive EN el handler, no detrás del
//   mock.
// - ZoneResolver.resolve_zone(lat,lng) (DI, fake) — única fuente de la zona
//   que termina en la fila escrita.
// - ImpressionsWriter.upsert_impressions / .record_cta_tap (DI, fake) — se
//   assertan argumentos EXACTOS; record_cta_tap tiene firma que
//   estructuralmente no puede tocar watched_ms/viewed/completed.
// - derive_impression_id / is_ad_viewed (funciones puras exportadas de
//   types.ts) — testeadas DIRECTO, fuera del handler, con valores esperados
//   de fuente independiente (uuid v5 calculado con `python3 -c
//   "import uuid; print(uuid.uuid5(...))"`, namespace
//   45eeb944-da5b-442f-8139-0a2bc3efe50b — NUNCA recomputado con la misma
//   librería que usaría el GREEN).
//
// EDGE CASES (RED) — 170.6:
//
// ### Happy path
// - impresión elegible → 200 impressions_accepted=1/rejected=0;
//   upsert_impressions llamado 1 vez con la fila EXACTA completa.
// - cta_tap → 200 cta_taps_recorded=1; record_cta_tap llamado con (id
//   derivado exacto, cta_tapped_at exacto).
// - batch mixto (2 impressions con ad_ids distintos + 1 cta_tap) en la
//   misma petición → los 3 contadores correctos; fetch_ads llamado con
//   ambos ad_ids; upsert_impressions llamado 1 vez con 2 filas;
//   record_cta_tap llamado 1 vez.
// - agency_id de la fila escrita sale del AdRecord del ad correspondiente
//   (no un valor fijo) — 2 ads de agencias distintas en el mismo batch.
//
// ### Derivación del id (#193)
// - mismo (user_id, ad_id, session_id) → siempre el mismo id.
// - ejemplo trabajado: id EXACTO verificado con uuid5 independiente.
// - cambiar session_id → id distinto, valor exacto verificado.
// - cambiar user_id → id distinto, valor exacto verificado.
// - cambiar ad_id → id distinto, valor exacto verificado.
// - id/user_id que manda el cliente en el payload se IGNORAN — la fila
//   escrita usa SIEMPRE derive_impression_id(uid del JWT, ad_id,
//   session_id), incluso si el payload trae id/user_id de otra persona.
//
// ### El vector de #193 — A no puede escribir sobre la fila de B, y no lo revela
// - A autenticado envía una impresión con el session_id que B ya usó para
//   su propia fila → el id escrito es derive_impression_id(A, ad_id,
//   session_id), NUNCA derive_impression_id(B, ad_id, session_id).
// - la respuesta 200 tiene la MISMA forma exitosa sin importar si el id
//   calculado ya existía o no en la base — no hay campo que distinga
//   "nueva" de "ya existía".
//
// ### Rechazo de elegibilidad (boundary = deps.now(), NUNCA shown_at)
// - ad_id inexistente → rechazado, nunca llega al writer.
// - ad status='paused' → rechazado.
// - ad status='pending_review' → rechazado.
// - ad NO ha iniciado vigencia (starts_at = now+1ms) → rechazado.
// - ad JUSTO expiró (ends_at = now-1ms) → rechazado — assert explícito:
//   subcontar es el error correcto en algo facturable, sobrecontar no.
// - ad en el límite starts_at===now → ACEPTADO (boundary inclusive).
// - ad en el límite ends_at===now → ACEPTADO (boundary inclusive).
// - cada rechazo anterior convive con una impresión válida en el MISMO
//   batch que SÍ se acepta.
//
// ### Zona — recalculada, nunca la declarada
// - cliente declara municipality_id/neighborhood_id en el payload → la
//   fila escrita usa EXCLUSIVAMENTE lo que devuelve
//   zoneResolver.resolve_zone, nunca lo declarado.
// - zoneResolver es llamado con (lat, lng) EXACTOS del payload.
// - zoneResolver devuelve {municipality_id:null, neighborhood_id:null}
//   (hueco total) → la fila se escribe igual (inventario nacional), NO se
//   rechaza el item por falta de zona.
//
// ### Upsert / cta_tapped_at — solo esta columna es actualizable
// - record_cta_tap NUNCA recibe watched_ms/viewed/completed — firma (id,
//   cta_tapped_at) exclusiva.
// - un evento de SOLO cta_tap NUNCA dispara upsert_impressions.
// - reenviar el mismo batch de impresiones dos veces → upsert_impressions
//   se llama 2 veces con el MISMO id derivado y el MISMO contenido de fila.
// - doble tap al CTA (2 items con el mismo ad_id/session_id) →
//   record_cta_tap se llama 2 veces con el MISMO id derivado ambas veces.
// - CTA que llega en una petición SEPARADA y posterior al batch de
//   impresiones → usa el MISMO id que derive_impression_id calcula
//   independientemente para ese trío.
//
// ### Umbral de viewed (>=3s, definido por esta EF)
// - watched_ms=2999 → viewed=false en la fila escrita.
// - watched_ms=3000 → viewed=true (boundary inclusive).
// - watched_ms=3001 → viewed=true.
// - viewed que manda el cliente en el payload se IGNORA.
// - consistencia estructural en un batch con watched_ms variados: NINGUNA
//   fila escrita tiene viewed=true con watched_ms < 3000.
//
// ### Batch parcial
// - 3 impressions (1 inexistente + 1 no-active + 1 válida) →
//   accepted=1/rejected=2; upsert_impressions llamado 1 vez con SOLO la
//   fila válida.
// - item malformado (ad_id vacío) en medio del batch → no tumba el lote,
//   se cuenta como rechazado, fetch_ads no lo incluye, el resto se procesa.
//
// ### Auth (frontera de confianza, fail-closed)
// - sin Authorization → 401 UNAUTHENTICATED; fetch_ads/writer NUNCA se llaman.
// - callerVerifier ok:false → 401 UNAUTHENTICATED; fetch_ads/writer NUNCA se llaman.
//
// ### Método HTTP
// - GET → 405. PUT → 405.
//
// ### CORS
// - OPTIONS → 200-204 con Access-Control-Allow-Origin.
//
// ### Body / parse / validación
// - body no-JSON → 400 INVALID_INPUT.
// - body no es objeto (array) → 400 INVALID_INPUT.
// - impressions presente pero no es array → 400 INVALID_INPUT.
// - cta_taps presente pero no es array → 400 INVALID_INPUT.
// - body {} (ambos ausentes) → 200 con los 3 contadores en 0, NINGÚN
//   dependiente se llama.
//
// ### Defensivo
// - adsRepository.fetch_ads lanza Error → 500 INTERNAL_ERROR.
// - zoneResolver.resolve_zone lanza Error para 1 item → ese item se
//   rechaza, el resto del batch se procesa (NO 500 batch-wide).
// - deps undefined → 500 INTERNAL_ERROR.
//
// ### Forma invariante
// - 200 tiene forma { impressions_accepted, impressions_rejected,
//   cta_taps_recorded } (todos number).
// - error sigue { error: { code: string, message: string } }.

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import { derive_impression_id, is_ad_viewed, VIEWED_THRESHOLD_MS } from "./types.ts";
import type {
  AdCtaTapInput,
  AdImpressionEventInput,
  AdRecord,
  AdsRepository,
  CallerVerifier,
  CallerVerifyResult,
  ImpressionRow,
  ImpressionsWriter,
  RecordAdImpressionsDeps,
  ResolvedZone,
  ZoneResolver,
} from "./types.ts";

// ── Constantes — reusadas también como vector del ejemplo trabajado de uuid5 ──
// (mismos literales usados para calcular los ids EXACTOS de abajo con
// `python3 -c "import uuid; print(uuid.uuid5(uuid.UUID('45eeb944-da5b-442f-
// 8139-0a2bc3efe50b'), '<user_id>:<ad_id>:<session_id>'))"`.)

const CALLER_UID = "11111111-1111-1111-1111-111111111111"; // persona A
const OTHER_UID = "55555555-5555-5555-5555-555555555555"; // persona B
const AD_ACTIVE = "22222222-2222-2222-2222-222222222222";
const AD_ACTIVE_2 = "66666666-6666-6666-6666-666666666666";
const SESSION_1 = "33333333-3333-3333-3333-333333333333";
const SESSION_2 = "44444444-4444-4444-4444-444444444444";

const EXPECTED_ID_BASE = "cd33a4b4-8d6b-5186-9cf0-c8ab08e6f1bd"; // (CALLER_UID, AD_ACTIVE, SESSION_1)
const EXPECTED_ID_SESSION_2 = "50fef8b4-9d2c-59d8-9910-7ea37c1c22f1"; // (CALLER_UID, AD_ACTIVE, SESSION_2)
const EXPECTED_ID_OTHER_UID = "0ddd96f9-2174-5dfc-88d6-6a1b43ca18c4"; // (OTHER_UID, AD_ACTIVE, SESSION_1)
const EXPECTED_ID_AD_2 = "6e82c6a2-93e0-5d61-a817-935031ce6ddf"; // (CALLER_UID, AD_ACTIVE_2, SESSION_1)

const AGENCY_1 = "00000000-0000-0000-0000-000000000301";
const AGENCY_2 = "00000000-0000-0000-0000-000000000302";

const AD_PAUSED = "00000000-0000-0000-0000-0000000a0001";
const AD_PENDING_REVIEW = "00000000-0000-0000-0000-0000000a0002";
const AD_NOT_STARTED_1MS = "00000000-0000-0000-0000-0000000a0003";
const AD_JUST_EXPIRED_1MS = "00000000-0000-0000-0000-0000000a0004";
const AD_STARTS_EXACT = "00000000-0000-0000-0000-0000000a0005";
const AD_ENDS_EXACT = "00000000-0000-0000-0000-0000000a0006";
const AD_DOES_NOT_EXIST = "00000000-0000-0000-0000-0000000a0099";

const NOW = new Date("2026-08-19T12:00:00.000Z");
const DAY_MS = 86_400_000;

function iso_plus(base: Date, delta_ms: number): string {
  return new Date(base.getTime() + delta_ms).toISOString();
}

function ad_record(overrides: Partial<AdRecord> & { id: string }): AdRecord {
  return {
    agency_id: AGENCY_1,
    status: "active",
    starts_at: iso_plus(NOW, -DAY_MS),
    ends_at: iso_plus(NOW, DAY_MS),
    ...overrides,
  };
}

const AD_ACTIVE_RECORD = ad_record({ id: AD_ACTIVE, agency_id: AGENCY_1 });
const AD_ACTIVE_2_RECORD = ad_record({ id: AD_ACTIVE_2, agency_id: AGENCY_2 });
const AD_PAUSED_RECORD = ad_record({ id: AD_PAUSED, status: "paused" });
const AD_PENDING_REVIEW_RECORD = ad_record({ id: AD_PENDING_REVIEW, status: "pending_review" });
const AD_NOT_STARTED_RECORD = ad_record({ id: AD_NOT_STARTED_1MS, starts_at: iso_plus(NOW, 1) });
const AD_JUST_EXPIRED_RECORD = ad_record({ id: AD_JUST_EXPIRED_1MS, ends_at: iso_plus(NOW, -1) });
const AD_STARTS_EXACT_RECORD = ad_record({ id: AD_STARTS_EXACT, starts_at: NOW.toISOString() });
const AD_ENDS_EXACT_RECORD = ad_record({ id: AD_ENDS_EXACT, ends_at: NOW.toISOString() });

const DEFAULT_ZONE: ResolvedZone = { municipality_id: "51001", neighborhood_id: 777 };

// ── Fakes — CallerVerifier ───────────────────────────────────────────────────

function caller_ok(user_id: string): CallerVerifier & { calls: number } {
  return {
    calls: 0,
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      this.calls++;
      return Promise.resolve({ ok: true, user_id });
    },
  };
}

function caller_unauthenticated(): CallerVerifier & { calls: number } {
  return {
    calls: 0,
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      this.calls++;
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  };
}

// ── Fakes — AdsRepository ───────────────────────────────────────────────────

function ads_repo(records: AdRecord[]): AdsRepository & { calls: string[][] } {
  return {
    calls: [],
    fetch_ads(ad_ids: string[]): Promise<AdRecord[]> {
      this.calls.push(ad_ids);
      const set = new Set(ad_ids);
      return Promise.resolve(records.filter((r) => set.has(r.id)));
    },
  };
}

function ads_repo_throws(): AdsRepository & { calls: string[][] } {
  return {
    calls: [],
    fetch_ads(ad_ids: string[]): Promise<AdRecord[]> {
      this.calls.push(ad_ids);
      return Promise.reject(new Error("db caída"));
    },
  };
}

// ── Fakes — ZoneResolver ─────────────────────────────────────────────────────

function zone_resolver(
  result: ResolvedZone,
): ZoneResolver & { calls: Array<{ lat: number; lng: number }> } {
  return {
    calls: [],
    resolve_zone(lat: number, lng: number): Promise<ResolvedZone> {
      this.calls.push({ lat, lng });
      return Promise.resolve(result);
    },
  };
}

/** Lanza SOLO cuando lat === 999 (sentinela del item "problemático" del batch parcial). */
function zone_resolver_selective_throw(
  result: ResolvedZone,
): ZoneResolver & { calls: Array<{ lat: number; lng: number }> } {
  return {
    calls: [],
    resolve_zone(lat: number, lng: number): Promise<ResolvedZone> {
      this.calls.push({ lat, lng });
      if (lat === 999) return Promise.reject(new Error("resolver caído para este item"));
      return Promise.resolve(result);
    },
  };
}

// ── Fakes — ImpressionsWriter ────────────────────────────────────────────────

interface FakeWriter extends ImpressionsWriter {
  upsert_calls: ImpressionRow[][];
  cta_calls: Array<{ id: string; cta_tapped_at: string }>;
}

function writer_ok(): FakeWriter {
  return {
    upsert_calls: [],
    cta_calls: [],
    upsert_impressions(rows: ImpressionRow[]): Promise<void> {
      this.upsert_calls.push(rows);
      return Promise.resolve();
    },
    record_cta_tap(id: string, cta_tapped_at: string): Promise<void> {
      this.cta_calls.push({ id, cta_tapped_at });
      return Promise.resolve();
    },
  } as FakeWriter;
}

// ── Helpers de Request/Deps/Fixtures ────────────────────────────────────────

function post_request(body: unknown, with_auth = true): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/record-ad-impressions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function raw_post_request(raw_body: string, with_auth = true): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/record-ad-impressions", {
    method: "POST",
    headers,
    body: raw_body,
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/record-ad-impressions", {
    method,
    headers: { Authorization: "Bearer fake.jwt.token" },
  });
}

function make_deps(overrides: Partial<RecordAdImpressionsDeps> = {}): RecordAdImpressionsDeps {
  return {
    callerVerifier: caller_ok(CALLER_UID),
    adsRepository: ads_repo([AD_ACTIVE_RECORD, AD_ACTIVE_2_RECORD]),
    zoneResolver: zone_resolver(DEFAULT_ZONE),
    impressionsWriter: writer_ok(),
    now: () => NOW,
    ...overrides,
  };
}

function impression_item(overrides: Partial<AdImpressionEventInput> = {}): AdImpressionEventInput {
  return {
    ad_id: AD_ACTIVE,
    session_id: SESSION_1,
    shown_at: NOW.toISOString(),
    watched_ms: 5000,
    completed: false,
    lat: 19.4326,
    lng: -99.1332,
    device: "android",
    ...overrides,
  };
}

function cta_item(overrides: Partial<AdCtaTapInput> = {}): AdCtaTapInput {
  return {
    ad_id: AD_ACTIVE,
    session_id: SESSION_1,
    cta_tapped_at: NOW.toISOString(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Funciones puras — derive_impression_id / is_ad_viewed (fuera del handler)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("derive_determinismo_mismo_trio_da_siempre_el_mismo_id", () => {
  const id1 = derive_impression_id(CALLER_UID, AD_ACTIVE, SESSION_1);
  const id2 = derive_impression_id(CALLER_UID, AD_ACTIVE, SESSION_1);
  assertEquals(id1, id2, "el mismo trío debe producir siempre el mismo id");
});

Deno.test("derive_ejemplo_trabajado_valor_exacto_verificado_con_uuid5_independiente", () => {
  assertEquals(derive_impression_id(CALLER_UID, AD_ACTIVE, SESSION_1), EXPECTED_ID_BASE);
});

Deno.test("derive_cambiar_session_id_da_un_id_distinto_valor_exacto", () => {
  assertEquals(derive_impression_id(CALLER_UID, AD_ACTIVE, SESSION_2), EXPECTED_ID_SESSION_2);
});

Deno.test("derive_cambiar_user_id_da_un_id_distinto_valor_exacto", () => {
  assertEquals(derive_impression_id(OTHER_UID, AD_ACTIVE, SESSION_1), EXPECTED_ID_OTHER_UID);
});

Deno.test("derive_cambiar_ad_id_da_un_id_distinto_valor_exacto", () => {
  assertEquals(derive_impression_id(CALLER_UID, AD_ACTIVE_2, SESSION_1), EXPECTED_ID_AD_2);
});

Deno.test("is_ad_viewed_bajo_el_umbral_2999ms_es_false", () => {
  assertEquals(is_ad_viewed(2999), false);
});

Deno.test("is_ad_viewed_en_el_umbral_exacto_3000ms_es_true_boundary_inclusive", () => {
  assertEquals(is_ad_viewed(3000), true);
});

Deno.test("is_ad_viewed_sobre_el_umbral_3001ms_es_true", () => {
  assertEquals(is_ad_viewed(3001), true);
});

Deno.test("viewed_threshold_ms_constante_es_3000", () => {
  assertEquals(VIEWED_THRESHOLD_MS, 3000);
});

// ═══════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("happy_una_impresion_elegible_200_accepted_1_y_fila_exacta_al_writer", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  const res = await handler(post_request({ impressions: [impression_item()] }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 0);
  assertEquals(body.cta_taps_recorded, 0);

  assertEquals(writer.upsert_calls.length, 1, "upsert_impressions debe llamarse exactamente una vez");
  assertEquals(writer.upsert_calls[0].length, 1);
  const row = writer.upsert_calls[0][0];
  const expected: ImpressionRow = {
    id: EXPECTED_ID_BASE,
    ad_id: AD_ACTIVE,
    agency_id: AGENCY_1,
    user_id: CALLER_UID,
    session_id: SESSION_1,
    municipality_id: DEFAULT_ZONE.municipality_id,
    neighborhood_id: DEFAULT_ZONE.neighborhood_id,
    shown_at: NOW.toISOString(),
    watched_ms: 5000,
    viewed: true,
    completed: false,
    device: "android",
  };
  assertEquals(row, expected, "la fila escrita debe ser EXACTAMENTE la esperada, campo a campo");
});

Deno.test("happy_cta_tap_200_cta_taps_recorded_1_y_args_exactos_al_writer", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  const res = await handler(post_request({ cta_taps: [cta_item()] }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.cta_taps_recorded, 1);
  assertEquals(body.impressions_accepted, 0);
  assertEquals(body.impressions_rejected, 0);

  assertEquals(writer.cta_calls.length, 1);
  assertEquals(writer.cta_calls[0], { id: EXPECTED_ID_BASE, cta_tapped_at: NOW.toISOString() });
});

Deno.test("happy_batch_mixto_impresiones_y_cta_tap_en_la_misma_peticion", async () => {
  const writer = writer_ok();
  const ads = ads_repo([AD_ACTIVE_RECORD, AD_ACTIVE_2_RECORD]);
  const deps = make_deps({ impressionsWriter: writer, adsRepository: ads });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
        impression_item({ ad_id: AD_ACTIVE_2, session_id: SESSION_1 }),
      ],
      cta_taps: [cta_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 })],
    }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.impressions_accepted, 2);
  assertEquals(body.impressions_rejected, 0);
  assertEquals(body.cta_taps_recorded, 1);

  assertEquals(ads.calls.length, 1, "fetch_ads debe llamarse exactamente una vez para todo el batch");
  assertEquals(new Set(ads.calls[0]), new Set([AD_ACTIVE, AD_ACTIVE_2]));
  assertEquals(writer.upsert_calls.length, 1);
  assertEquals(writer.upsert_calls[0].length, 2);
  assertEquals(writer.cta_calls.length, 1);
});

Deno.test("happy_agency_id_de_la_fila_sale_del_ad_correspondiente_no_es_fijo", async () => {
  const writer = writer_ok();
  const ads = ads_repo([AD_ACTIVE_RECORD, AD_ACTIVE_2_RECORD]);
  const deps = make_deps({ impressionsWriter: writer, adsRepository: ads });
  await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
        impression_item({ ad_id: AD_ACTIVE_2, session_id: SESSION_2 }),
      ],
    }),
    deps,
  );
  const rows = writer.upsert_calls[0];
  const row_1 = rows.find((r) => r.ad_id === AD_ACTIVE)!;
  const row_2 = rows.find((r) => r.ad_id === AD_ACTIVE_2)!;
  assertEquals(row_1.agency_id, AGENCY_1);
  assertEquals(row_2.agency_id, AGENCY_2);
});

// ═══════════════════════════════════════════════════════════════════════════
// Derivación del id (#193) a través del handler — id/user_id del payload IGNORADOS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("payload_con_id_y_user_id_ajenos_se_ignoran_fila_usa_uid_del_jwt", async () => {
  const writer = writer_ok();
  const deps = make_deps({ callerVerifier: caller_ok(CALLER_UID), impressionsWriter: writer });
  await handler(
    post_request({
      impressions: [
        impression_item({
          // deno-lint-ignore no-explicit-any
          ...({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", user_id: OTHER_UID } as any),
        }),
      ],
    }),
    deps,
  );
  assertEquals(writer.upsert_calls[0][0].id, EXPECTED_ID_BASE);
  assertEquals(writer.upsert_calls[0][0].user_id, CALLER_UID);
});

// ═══════════════════════════════════════════════════════════════════════════
// El vector de #193 — A no puede escribir sobre la fila de B, y no lo revela
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("vector_193_persona_a_no_puede_producir_el_id_de_la_fila_de_b", async () => {
  const writer = writer_ok();
  // A está autenticado como CALLER_UID pero intenta reusar el mismo
  // session_id que B (OTHER_UID) usa para su propia fila.
  const deps = make_deps({ callerVerifier: caller_ok(CALLER_UID), impressionsWriter: writer });
  await handler(post_request({ impressions: [impression_item({ session_id: SESSION_1 })] }), deps);
  const written_id = writer.upsert_calls[0][0].id;
  assertEquals(written_id, EXPECTED_ID_BASE, "debe usar el id derivado de A");
  const would_be_bs_id = derive_impression_id(OTHER_UID, AD_ACTIVE, SESSION_1);
  if (written_id === would_be_bs_id) {
    throw new Error("A jamás debe poder producir el id de la fila de B");
  }
});

Deno.test("vector_193_respuesta_200_identica_no_distingue_fila_nueva_de_existente", async () => {
  const deps1 = make_deps();
  const res1 = await handler(post_request({ impressions: [impression_item()] }), deps1);
  const body1 = await res1.json();

  const deps2 = make_deps();
  const res2 = await handler(post_request({ impressions: [impression_item()] }), deps2);
  const body2 = await res2.json();

  assertEquals(res1.status, res2.status);
  assertEquals(body1, body2, "la forma de la respuesta no debe cambiar si la fila ya existía");
  assertEquals(Object.keys(body1).includes("exists") || Object.keys(body1).includes("created"), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Rechazo de elegibilidad — boundary = deps.now(), NUNCA shown_at
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("elegibilidad_ad_inexistente_rechazado_valida_convive_con_aceptada", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_DOES_NOT_EXIST, session_id: SESSION_2 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
      ],
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 1);
  assertEquals(writer.upsert_calls[0].length, 1);
  assertEquals(writer.upsert_calls[0][0].ad_id, AD_ACTIVE);
});

Deno.test("elegibilidad_ad_paused_rechazado_convive_con_aceptada", async () => {
  const writer = writer_ok();
  const deps = make_deps({
    adsRepository: ads_repo([AD_ACTIVE_RECORD, AD_PAUSED_RECORD]),
    impressionsWriter: writer,
  });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_PAUSED, session_id: SESSION_2 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
      ],
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 1);
  assertEquals(writer.upsert_calls[0].length, 1);
  assertEquals(writer.upsert_calls[0][0].ad_id, AD_ACTIVE);
});

Deno.test("elegibilidad_ad_pending_review_rechazado_convive_con_aceptada", async () => {
  const writer = writer_ok();
  const deps = make_deps({
    adsRepository: ads_repo([AD_ACTIVE_RECORD, AD_PENDING_REVIEW_RECORD]),
    impressionsWriter: writer,
  });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_PENDING_REVIEW, session_id: SESSION_2 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
      ],
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 1);
});

Deno.test("elegibilidad_ad_no_ha_iniciado_vigencia_1ms_rechazado_convive_con_aceptada", async () => {
  const writer = writer_ok();
  const deps = make_deps({
    adsRepository: ads_repo([AD_ACTIVE_RECORD, AD_NOT_STARTED_RECORD]),
    impressionsWriter: writer,
  });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_NOT_STARTED_1MS, session_id: SESSION_2 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
      ],
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 1);
});

Deno.test("elegibilidad_ad_justo_expiro_1ms_rechazado_subcontar_es_correcto", async () => {
  const writer = writer_ok();
  const deps = make_deps({
    adsRepository: ads_repo([AD_ACTIVE_RECORD, AD_JUST_EXPIRED_RECORD]),
    impressionsWriter: writer,
  });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_JUST_EXPIRED_1MS, session_id: SESSION_2 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
      ],
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(
    body.impressions_rejected,
    1,
    "una impresión que llega justo después de expirar la vigencia SE DESCARTA — sobrecontar no es aceptable en algo facturable",
  );
  assertEquals(body.impressions_accepted, 1);
  assertEquals(writer.upsert_calls[0].every((r) => r.ad_id !== AD_JUST_EXPIRED_1MS), true);
});

Deno.test("elegibilidad_boundary_starts_at_exacto_now_es_aceptado_inclusive", async () => {
  const writer = writer_ok();
  const deps = make_deps({
    adsRepository: ads_repo([AD_STARTS_EXACT_RECORD]),
    impressionsWriter: writer,
  });
  const res = await handler(
    post_request({ impressions: [impression_item({ ad_id: AD_STARTS_EXACT, session_id: SESSION_2 })] }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1, "starts_at === now debe ser boundary INCLUSIVE, igual que SQL BETWEEN");
  assertEquals(body.impressions_rejected, 0);
});

Deno.test("elegibilidad_boundary_ends_at_exacto_now_es_aceptado_inclusive", async () => {
  const writer = writer_ok();
  const deps = make_deps({
    adsRepository: ads_repo([AD_ENDS_EXACT_RECORD]),
    impressionsWriter: writer,
  });
  const res = await handler(
    post_request({ impressions: [impression_item({ ad_id: AD_ENDS_EXACT, session_id: SESSION_2 })] }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1, "ends_at === now debe ser boundary INCLUSIVE, igual que SQL BETWEEN");
  assertEquals(body.impressions_rejected, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Zona — recalculada, nunca la declarada
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("zona_declarada_por_el_cliente_se_ignora_fila_usa_la_del_resolver", async () => {
  const writer = writer_ok();
  const resolver = zone_resolver({ municipality_id: "51002", neighborhood_id: 42 });
  const deps = make_deps({ impressionsWriter: writer, zoneResolver: resolver });
  await handler(
    post_request({
      impressions: [
        impression_item({
          // deno-lint-ignore no-explicit-any
          ...({ municipality_id: "99999", neighborhood_id: 1 } as any),
        }),
      ],
    }),
    deps,
  );
  const row = writer.upsert_calls[0][0];
  assertEquals(row.municipality_id, "51002");
  assertEquals(row.neighborhood_id, 42);
});

Deno.test("zona_resolver_llamado_con_lat_lng_exactos_del_payload", async () => {
  const resolver = zone_resolver(DEFAULT_ZONE);
  const deps = make_deps({ zoneResolver: resolver });
  await handler(post_request({ impressions: [impression_item({ lat: 20.6597, lng: -103.3496 })] }), deps);
  assertEquals(resolver.calls, [{ lat: 20.6597, lng: -103.3496 }]);
});

Deno.test("zona_resolver_devuelve_null_null_hueco_total_no_rechaza_el_item", async () => {
  const writer = writer_ok();
  const resolver = zone_resolver({ municipality_id: null, neighborhood_id: null });
  const deps = make_deps({ impressionsWriter: writer, zoneResolver: resolver });
  const res = await handler(post_request({ impressions: [impression_item()] }), deps);
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1, "sin zona resuelta la impresión SIGUE siendo válida (inventario nacional)");
  assertEquals(writer.upsert_calls[0][0].municipality_id, null);
  assertEquals(writer.upsert_calls[0][0].neighborhood_id, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// Upsert / cta_tapped_at — solo esta columna es actualizable
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("cta_tap_solo_evento_de_cta_nunca_dispara_upsert_impressions", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(post_request({ cta_taps: [cta_item()] }), deps);
  assertEquals(writer.upsert_calls.length, 0, "un evento de SOLO cta_tap nunca debe llamar upsert_impressions");
  assertEquals(writer.cta_calls.length, 1);
});

Deno.test("cta_tap_firma_solo_acepta_id_y_cta_tapped_at_nunca_watched_ms", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(post_request({ cta_taps: [cta_item()] }), deps);
  const call = writer.cta_calls[0];
  assertEquals(Object.keys(call).sort(), ["cta_tapped_at", "id"]);
});

Deno.test("reenviar_el_mismo_batch_de_impresiones_dos_veces_produce_el_mismo_id_y_contenido", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  const item = impression_item();
  await handler(post_request({ impressions: [item] }), deps);
  await handler(post_request({ impressions: [item] }), deps);
  assertEquals(writer.upsert_calls.length, 2, "el handler debe procesar cada reintento (idempotencia real la da el id derivado + unique de #193)");
  assertEquals(writer.upsert_calls[0][0], writer.upsert_calls[1][0], "reenviar el mismo batch debe producir EXACTAMENTE la misma fila");
});

Deno.test("doble_tap_al_cta_mismo_ad_session_produce_el_mismo_id_derivado_ambas_veces", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(post_request({ cta_taps: [cta_item(), cta_item()] }), deps);
  assertEquals(writer.cta_calls.length, 2);
  assertEquals(writer.cta_calls[0].id, writer.cta_calls[1].id, "el doble tap NUNCA debe producir ids distintos para el mismo (ad_id, session_id)");
  assertEquals(writer.cta_calls[0].id, EXPECTED_ID_BASE);
});

Deno.test("cta_tap_en_peticion_separada_posterior_usa_el_mismo_id_que_la_impresion_original", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(post_request({ impressions: [impression_item()] }), deps);
  await handler(post_request({ cta_taps: [cta_item()] }), deps);
  const impression_id = writer.upsert_calls[0][0].id;
  const cta_id = writer.cta_calls[0].id;
  assertEquals(cta_id, impression_id, "el tap posterior debe apuntar a la MISMA fila que la impresión original");
});

// ═══════════════════════════════════════════════════════════════════════════
// Umbral de viewed
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("viewed_bajo_el_umbral_2999ms_fila_escrita_con_viewed_false", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(post_request({ impressions: [impression_item({ watched_ms: 2999 })] }), deps);
  assertEquals(writer.upsert_calls[0][0].viewed, false);
});

Deno.test("viewed_en_el_umbral_exacto_3000ms_fila_escrita_con_viewed_true", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(post_request({ impressions: [impression_item({ watched_ms: 3000 })] }), deps);
  assertEquals(writer.upsert_calls[0][0].viewed, true);
});

Deno.test("viewed_declarado_por_el_cliente_se_ignora_se_deriva_de_watched_ms", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(
    post_request({
      impressions: [
        impression_item({
          watched_ms: 500,
          // deno-lint-ignore no-explicit-any
          ...({ viewed: true } as any),
        }),
      ],
    }),
    deps,
  );
  assertEquals(
    writer.upsert_calls[0][0].viewed,
    false,
    "viewed=true declarado por el cliente con watched_ms bajo el umbral debe ignorarse",
  );
});

Deno.test("viewed_consistencia_estructural_ninguna_fila_viewed_true_con_watched_ms_bajo_el_umbral", async () => {
  const writer = writer_ok();
  const deps = make_deps({ impressionsWriter: writer });
  await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1, watched_ms: 100 }),
        impression_item({ ad_id: AD_ACTIVE_2, session_id: SESSION_1, watched_ms: 2999 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_2, watched_ms: 3000 }),
      ],
    }),
    deps,
  );
  const rows = writer.upsert_calls[0];
  for (const row of rows) {
    if (row.viewed) {
      if (row.watched_ms < VIEWED_THRESHOLD_MS) {
        throw new Error(`fila con viewed=true y watched_ms=${row.watched_ms} < ${VIEWED_THRESHOLD_MS}`);
      }
    }
  }
  assertEquals(rows.filter((r) => r.viewed).length, 1, "solo la fila con watched_ms>=3000 debe quedar viewed=true");
});

// ═══════════════════════════════════════════════════════════════════════════
// Batch parcial
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("batch_parcial_inexistente_mas_no_active_mas_valida_solo_la_valida_llega_al_writer", async () => {
  const writer = writer_ok();
  const deps = make_deps({
    adsRepository: ads_repo([AD_ACTIVE_RECORD, AD_PAUSED_RECORD]),
    impressionsWriter: writer,
  });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_DOES_NOT_EXIST, session_id: SESSION_2 }),
        impression_item({ ad_id: AD_PAUSED, session_id: SESSION_2 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
      ],
    }),
    deps,
  );
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 2);
  assertEquals(writer.upsert_calls.length, 1);
  assertEquals(writer.upsert_calls[0].length, 1);
  assertEquals(writer.upsert_calls[0][0].ad_id, AD_ACTIVE);
});

Deno.test("batch_parcial_item_malformado_ad_id_vacio_no_tumba_el_lote", async () => {
  const writer = writer_ok();
  const ads = ads_repo([AD_ACTIVE_RECORD]);
  const deps = make_deps({ adsRepository: ads, impressionsWriter: writer });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: "", session_id: SESSION_2 }),
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1 }),
      ],
    }),
    deps,
  );
  assertEquals(res.status, 200, "un item malformado NO debe tumbar el lote");
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 1);
  assertEquals(ads.calls[0].includes(""), false, "el item malformado no debe entrar a fetch_ads");
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth (frontera de confianza, fail-closed)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("sin_authorization_header_retorna_401_nada_se_llama", async () => {
  const ads = ads_repo([AD_ACTIVE_RECORD]);
  const writer = writer_ok();
  const deps = make_deps({ adsRepository: ads, impressionsWriter: writer });
  const res = await handler(post_request({ impressions: [impression_item()] }, false), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(ads.calls.length, 0);
  assertEquals(writer.upsert_calls.length, 0);
});

Deno.test("jwt_invalido_callerVerifier_falla_retorna_401_nada_se_llama", async () => {
  const ads = ads_repo([AD_ACTIVE_RECORD]);
  const writer = writer_ok();
  const deps = make_deps({
    callerVerifier: caller_unauthenticated(),
    adsRepository: ads,
    impressionsWriter: writer,
  });
  const res = await handler(post_request({ impressions: [impression_item()] }), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(ads.calls.length, 0);
  assertEquals(writer.upsert_calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Método HTTP
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("metodo_get_retorna_405_method_not_allowed", async () => {
  const res = await handler(method_request("GET"), make_deps());
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error.code, "METHOD_NOT_ALLOWED");
});

Deno.test("metodo_put_retorna_405_method_not_allowed", async () => {
  const res = await handler(method_request("PUT"), make_deps());
  assertEquals(res.status, 405);
});

// ═══════════════════════════════════════════════════════════════════════════
// CORS
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("cors_options_preflight_retorna_200_con_access_control_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status >= 200 && res.status <= 204, true);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

// ═══════════════════════════════════════════════════════════════════════════
// Body / parse / validación de input
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const res = await handler(raw_post_request("esto no es json{{{"), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("body_no_es_objeto_array_retorna_400_invalid_input", async () => {
  const res = await handler(raw_post_request("[1,2,3]"), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("impressions_no_es_array_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({ impressions: "no-array" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("cta_taps_no_es_array_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({ cta_taps: {} }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("body_vacio_ambos_ausentes_200_contadores_en_cero_nada_se_llama", async () => {
  const ads = ads_repo([AD_ACTIVE_RECORD]);
  const writer = writer_ok();
  const deps = make_deps({ adsRepository: ads, impressionsWriter: writer });
  const res = await handler(post_request({}), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { impressions_accepted: 0, impressions_rejected: 0, cta_taps_recorded: 0 });
  assertEquals(ads.calls.length, 0);
  assertEquals(writer.upsert_calls.length, 0);
  assertEquals(writer.cta_calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Defensivo
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("ads_repository_lanza_error_retorna_500_internal_error", async () => {
  const deps = make_deps({ adsRepository: ads_repo_throws() });
  const res = await handler(post_request({ impressions: [impression_item()] }), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

Deno.test("zone_resolver_lanza_error_para_1_item_ese_item_se_rechaza_resto_se_procesa", async () => {
  const writer = writer_ok();
  const resolver = zone_resolver_selective_throw(DEFAULT_ZONE);
  const deps = make_deps({ impressionsWriter: writer, zoneResolver: resolver });
  const res = await handler(
    post_request({
      impressions: [
        impression_item({ ad_id: AD_ACTIVE, session_id: SESSION_1, lat: 999, lng: 999 }),
        impression_item({ ad_id: AD_ACTIVE_2, session_id: SESSION_2, lat: 19, lng: -99 }),
      ],
    }),
    deps,
  );
  assertEquals(res.status, 200, "un resolver caído para 1 item NO debe tumbar el batch completo");
  const body = await res.json();
  assertEquals(body.impressions_accepted, 1);
  assertEquals(body.impressions_rejected, 1);
  assertEquals(writer.upsert_calls[0].length, 1);
  assertEquals(writer.upsert_calls[0][0].ad_id, AD_ACTIVE_2);
});

Deno.test("deps_undefined_retorna_500_internal_error", async () => {
  const res = await handler(post_request({ impressions: [impression_item()] }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

// ═══════════════════════════════════════════════════════════════════════════
// Forma invariante
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("respuesta_200_tiene_forma_de_los_3_contadores_numericos", async () => {
  const res = await handler(post_request({ impressions: [impression_item()] }), make_deps());
  const body = await res.json();
  assertEquals(typeof body.impressions_accepted, "number");
  assertEquals(typeof body.impressions_rejected, "number");
  assertEquals(typeof body.cta_taps_recorded, "number");
});

Deno.test("error_respuesta_tiene_forma_error_code_message", async () => {
  const res = await handler(post_request({ impressions: "no-array" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error);
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
