// supabase/functions/mint-ad-upload-url/handler.test.ts
// Tests RED — subtarea 169.4
// Edge Function: mint-ad-upload-url/handler.ts (Cloudflare Stream Direct Creator
// Upload, upload-first, PARA ANUNCIOS — calco de mint-upload-url/68.3)
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net --import-map=supabase/functions/deno.json \
//         supabase/functions/mint-ad-upload-url/handler.test.ts
//         (desde el repo raíz)
//
// SEAMS (interfaz bajo test):
// - Contrato público HTTP del handler(req, deps?): request → status + body JSON.
// - CallerVerifier.verify_caller (DI, fake) — frontera JWT; el uid SIEMPRE sale de
//   aquí, nunca del body.
// - AdvertiserAuthorizer.authorize_advertiser (DI, fake) — frontera de autorización
//   fail-closed: owner/admin de una organización con private.org_can_advertise
//   (168.1). Colapsa 3 causas (sin organización / rol no owner-admin / sin
//   capacidad) en el MISMO error FORBIDDEN, mismo criterio que private.org_can_advertise.
// - ActiveAdUploadChecker.count_active_ad_uploads(agency_id, stale_before) (DI,
//   fake) — frontera de la invariante de concurrencia SCOPED POR ORGANIZACIÓN
//   sobre ad_creatives (tabla PROPIA, distinta de property_videos que usa
//   mint-upload-url). El segundo argumento (`stale_before`) es el SEAM del
//   reaper (calco del de mint-upload-url/103.1 parte B — mismo bug heredado, ver
//   sección Reaper abajo).
// - StreamUploadCreator.create_direct_upload (DI, fake) — frontera de red con
//   Cloudflare Stream; NUNCA red real.
// - AdCreativeRegistrar.register_uploading_ad_creative (DI, fake) — frontera de
//   escritura en DB; NUNCA DB real.
//
// EDGE CASES (RED) — 169.4:
//
// ### Happy path
// - uploader llamado exactamente una vez con { creator: agency_id, maxDurationSeconds:
//   30, requireSignedURLs: true } (shape exacto — creator=agency_id, DECISIÓN DE
//   DISEÑO documentada en types.ts: el creativo pertenece a la organización, no al
//   uid del caller que lo sube)
// - registrar llamado exactamente una vez con { agency_id, status: 'uploading',
//   cloudflare_uid } (shape exacto, MÁS ANGOSTO que property_videos: sin
//   property_id/position/tus_upload_url, que ad_creatives no tiene — 169.1)
// - 200 con body { uploadUrl, uid } = los valores devueltos por Stream
// - la respuesta NUNCA filtra credenciales de Stream: aunque el fake de Stream
//   devuelva de más (accountId/apiToken simulados), el body de la respuesta debe
//   tener EXACTAMENTE las claves uploadUrl/uid — nada más
//
// ### Diferencia 1 — maxDurationSeconds = 30 (no 120)
// - el uploader recibe maxDurationSeconds=30 (assert sobre el doble de Stream, NO
//   sobre la respuesta al cliente — el mínimo de 6s NO lo impone esta EF)
// - STREAM_MAX_DURATION_SECONDS exportado vale exactamente 30 (oracle literal
//   independiente del código, no derivado de sí mismo)
//
// ### Diferencia 2 — concurrencia SCOPED POR ORGANIZACIÓN (núcleo de la subtarea)
// - agencia con 1 creativo propio en 'uploading' → 409 AD_UPLOAD_IN_PROGRESS;
//   uploader y registrar NO se llaman (cero llamadas)
// - agencia con 1 creativo propio en 'processing' → 409 AD_UPLOAD_IN_PROGRESS
// - el checker se consulta con el agency_id resuelto por AdvertiserAuthorizer, NUNCA
//   con el uid del caller: un checker que SOLO conoce actividad keyeada por uid
//   (simulando por error el criterio de property_videos) no debe bloquear —
//   demuestra que la concurrencia vive en una clave/tabla distinta
// - ausencia de 409 cruzado: un owner que también es agente puede tener un video de
//   PROPIEDAD en vuelo (simulado como actividad bajo su uid) y aun así mintear un
//   upload de anuncio con éxito (200) — la separación es por dominio (agency_id
//   sobre ad_creatives), no por condicionales sobre el mismo checker
//
// ### Reaper de subidas colgadas (bug heredado de #103, agregado por corrección
//     del orquestador 2026-08-16 — copiar el pipeline de mint-upload-url SIN copiar
//     su arreglo hereda el bug: un creativo 'uploading' que nunca llega a Stream
//     dejaría a la organización con un 409 PERMANENTE, arreglable solo con SQL a
//     mano) — mismo nombre y semántica de constante que mint-upload-url/types.ts,
//     NO un umbral nuevo inventado:
// - el handler calcula un `stale_before` ISO ≈ 15 minutos en el pasado (tolerancia
//   de segundos) y se lo pasa al checker como 2do argumento — aserción sobre el
//   argumento capturado por el fake
// - STALE_UPLOAD_MS está exportado y vale 15 minutos en ms (900000) — aserción
//   directa contra un literal independiente (oracle fijo, no derivado de sí mismo)
// - creativo en 'uploading' MÁS VIEJO que el umbral → NO produce 409 (se considera
//   muerto, el checker con filtro real lo excluye, la subida nueva procede a 200)
// - creativo en 'uploading' DENTRO del umbral → SÍ produce 409 AD_UPLOAD_IN_PROGRESS
//   (confirma que el caso "reciente" sigue bloqueando con el filtro real, no solo
//   con un count fijo)
// - creativo en 'processing', AUNQUE VIEJO, sigue produciendo 409 — verificado
//   contra el comentario real de mint-upload-url/types.ts:56-60 ("'processing'
//   nunca expira aquí — lo resuelve el webhook"): NO existe un par
//   viejo/reciente para 'processing' porque ese estado no tiene ventana de
//   expiración en absoluto, a propósito (no es una omisión de este RED)
// - no-regresión: checker (fijo, sin filtrar por edad) en 0 → sigue el flujo
//   feliz 200; checker (fijo) en 1 → sigue 409 sin llamar a Stream ni insertar
//
// ### Autz fail-closed (AdvertiserAuthorizer) — 3 causas, mismo 403 FORBIDDEN
// NOTA DE HONESTIDAD (guardián, 2026-08-16): a nivel del SEAM del handler, las 3
// pruebas de causa usan el mismo fake authorizer_forbidden() — documentan que el
// handler responde igual ante cualquier `{ok:false}`, NO que las 3 causas se
// distinguen de verdad (eso vive en el adapter, ver
// _shared/advertiser_authorizer.test.ts).
// - sin organización (agente sin membresía activa) → 403 FORBIDDEN
// - organización sin la capacidad de anunciar (org_can_advertise=false) → 403 FORBIDDEN
// - miembro no-owner/admin (viewer/agent) de una organización que SÍ puede
//   anunciarse → 403 FORBIDDEN (el rol también fail-closed, no solo la capacidad)
// - el mensaje del 403 es un LITERAL FIJO y nunca contiene el uid del caller
//   (el 403 puede filtrar información por el body aunque status/code estén bien)
// - 403: ni el checker de concurrencia, ni el uploader, ni el registrar se llaman
//   (fail-closed real, cero efectos secundarios)
// - el authorizer se consulta con el uid del CALLER (nunca con un agency_id del body)
//
// ### Auth (frontera de confianza, fail-closed) — mismos casos base que mint-upload-url
// - sin header Authorization → 401 UNAUTHENTICATED
// - JWT inválido (callerVerifier ok:false) → 401 UNAUTHENTICATED
// - JWT inválido: ni authorizer, ni checker, ni uploader, ni registrar se llaman
//
// ### Fallo de Stream → 502, sin fila huérfana
// - uploader lanza (Stream no-2xx / success:false) → 502 STREAM_UPLOAD_FAILED
// - uploader lanza → registrar NO se llama (cero filas huérfanas)
//
// ### Fallo del insert → 500
// - registrar lanza → 500 INTERNAL_ERROR
//
// ### Método HTTP
// - GET → 405 METHOD_NOT_ALLOWED
// - PUT → 405 METHOD_NOT_ALLOWED
//
// ### CORS
// - OPTIONS → 200-204 con header Access-Control-Allow-Origin
//
// ### Boundary
// - deps undefined → 500 INTERNAL_ERROR (nunca propagar excepción cruda)
//
// ### Forma invariante de errores
// - toda respuesta de error sigue { error: { code: string, message: string } }
//
// AMBIGÜEDAD DOCUMENTADA (no inventada a ciegas — reportada): el plan no fija si
// `creator` (el parámetro que se manda a Stream) debe ser el agency_id o el uid del
// caller. Esta suite fija `creator: agency_id` porque el creativo pertenece a la
// organización (mismo razonamiento que agency_id scoped en TODO lo demás de esta
// EF); si el GREEN real difiere, es una decisión a revisar con Abraham/analista, no
// un bug de este RED.

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import {
  STALE_UPLOAD_MS,
  STREAM_MAX_DURATION_SECONDS,
  type AdCreativeRegistrar,
  type AdvertiserAuthorizeResult,
  type AdvertiserAuthorizer,
  type ActiveAdUploadChecker,
  type CallerVerifier,
  type CallerVerifyResult,
  type MintAdUploadUrlDeps,
  type RegisterUploadingAdCreativeParams,
  type StreamDirectUploadParams,
  type StreamDirectUploadResult,
  type StreamUploadCreator,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENT_UID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "10000000-0000-0000-0000-000000000001";
const STREAM_UID = "aaaaaaaabbbbccccdddd000000000001";
const STREAM_UPLOAD_URL = "https://upload.cloudflarestream.com/abcdef123456";

const STREAM_RESULT: StreamDirectUploadResult = {
  uploadURL: STREAM_UPLOAD_URL,
  uid: STREAM_UID,
};

// ── Fakes — CallerVerifier ───────────────────────────────────────────────────

interface FakeCallerVerifier extends CallerVerifier {
  calls: number;
}

function caller_ok(user_id: string): FakeCallerVerifier {
  return {
    calls: 0,
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      this.calls++;
      return Promise.resolve({ ok: true, user_id });
    },
  } as FakeCallerVerifier;
}

function caller_unauthenticated(): FakeCallerVerifier {
  return {
    calls: 0,
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      this.calls++;
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeCallerVerifier;
}

// ── Fakes — AdvertiserAuthorizer ─────────────────────────────────────────────

interface FakeAdvertiserAuthorizer extends AdvertiserAuthorizer {
  calls: string[];
}

function authorizer_ok(agency_id: string): FakeAdvertiserAuthorizer {
  return {
    calls: [],
    authorize_advertiser(user_id: string): Promise<AdvertiserAuthorizeResult> {
      this.calls.push(user_id);
      return Promise.resolve({ ok: true, agency_id });
    },
  } as FakeAdvertiserAuthorizer;
}

/**
 * forbidden() representa, indistintamente, cualquiera de las 3 causas que
 * AdvertiserAuthorizer colapsa en FORBIDDEN (sin organización / rol no
 * owner-admin / sin capacidad) — el handler responde IGUAL en las tres, por
 * diseño fail-closed (mismo criterio que private.org_can_advertise). Los
 * tests de cada causa usan este mismo fake documentando el escenario de
 * negocio en el nombre del test, no en el fake.
 */
function authorizer_forbidden(): FakeAdvertiserAuthorizer {
  return {
    calls: [],
    authorize_advertiser(user_id: string): Promise<AdvertiserAuthorizeResult> {
      this.calls.push(user_id);
      return Promise.resolve({ ok: false, error_code: "FORBIDDEN" });
    },
  } as FakeAdvertiserAuthorizer;
}

// ── Fakes — ActiveAdUploadChecker ────────────────────────────────────────────

interface FakeActiveAdUploadChecker extends ActiveAdUploadChecker {
  calls: string[];
}

/**
 * count_by_agency mapea agency_id → count; cualquier agency_id ausente usa
 * default_count. Clave DISTINTA (agency_id) del ActiveUploadChecker de
 * mint-upload-url (agent_id) — es justo lo que separa los dos invariantes.
 */
function checker_count_by_agency(
  count_by_agency: Record<string, number>,
  default_count = 0,
): FakeActiveAdUploadChecker {
  return {
    calls: [],
    count_active_ad_uploads(agency_id: string): Promise<number> {
      this.calls.push(agency_id);
      return Promise.resolve(count_by_agency[agency_id] ?? default_count);
    },
  } as FakeActiveAdUploadChecker;
}

// ── Fake — ActiveAdUploadChecker que captura (agency_id, stale_before) ────────
// Reaper (bug heredado de #103, mint-upload-url/types.ts:23-35): distinto del
// fake de arriba — aquí nos importa el SEGUNDO argumento tal cual el handler lo
// invoca, con un count FIJO (no filtra por edad; eso lo testea el fake de abajo).

interface FakeActiveAdUploadCheckerWithArgs extends ActiveAdUploadChecker {
  calls: Array<{ agency_id: string; stale_before?: string }>;
}

function checker_count_capturing_args(count = 0): FakeActiveAdUploadCheckerWithArgs {
  return {
    calls: [],
    count_active_ad_uploads(agency_id: string, stale_before?: string): Promise<number> {
      this.calls.push({ agency_id, stale_before });
      return Promise.resolve(count);
    },
  } as FakeActiveAdUploadCheckerWithArgs;
}

// ── Fake — ActiveAdUploadChecker con FILTRO REAL por edad (reaper) ────────────
// Simula, en memoria, la MISMA semántica que el adapter real de mint-upload-url
// (_shared/clients.ts, count_active_uploads): 'processing' SIEMPRE cuenta (sin
// ventana — el webhook lo resuelve), 'uploading' SOLO cuenta si created_at es
// MÁS RECIENTE que el stale_before que el handler pasó. A diferencia de los fakes
// de arriba (count fijo), este SÍ ejercita si el `stale_before` que calculó el
// handler realmente excluye una fila vieja — si el handler no lo calculara (o lo
// calculara mal), una fila 'uploading' vieja seguiría contando como activa.

interface FakeAdCreativeRow {
  status: "uploading" | "processing";
  created_at: string; // ISO
}

function checker_with_rows(
  rows_by_agency: Record<string, FakeAdCreativeRow[]>,
): FakeActiveAdUploadChecker {
  return {
    calls: [],
    count_active_ad_uploads(agency_id: string, stale_before: string): Promise<number> {
      this.calls.push(agency_id);
      const rows = rows_by_agency[agency_id] ?? [];
      const count = rows.filter((r) =>
        r.status === "processing" || (r.status === "uploading" && r.created_at > stale_before)
      ).length;
      return Promise.resolve(count);
    },
  } as FakeActiveAdUploadChecker;
}

// ── Fakes — StreamUploadCreator ───────────────────────────────────────────────

interface FakeStreamUploadCreator extends StreamUploadCreator {
  calls: StreamDirectUploadParams[];
}

function uploader_ok(result: StreamDirectUploadResult): FakeStreamUploadCreator {
  return {
    calls: [],
    create_direct_upload(params: StreamDirectUploadParams): Promise<StreamDirectUploadResult> {
      this.calls.push(params);
      return Promise.resolve(result);
    },
  } as FakeStreamUploadCreator;
}

function uploader_throws(): FakeStreamUploadCreator {
  return {
    calls: [],
    create_direct_upload(params: StreamDirectUploadParams): Promise<StreamDirectUploadResult> {
      this.calls.push(params);
      return Promise.reject(new Error("cloudflare stream direct_upload failed"));
    },
  } as FakeStreamUploadCreator;
}

// ── Fakes — AdCreativeRegistrar ───────────────────────────────────────────────

interface FakeAdCreativeRegistrar extends AdCreativeRegistrar {
  calls: RegisterUploadingAdCreativeParams[];
}

function registrar_ok(): FakeAdCreativeRegistrar {
  return {
    calls: [],
    register_uploading_ad_creative(params: RegisterUploadingAdCreativeParams): Promise<void> {
      this.calls.push(params);
      return Promise.resolve();
    },
  } as FakeAdCreativeRegistrar;
}

function registrar_throws(): FakeAdCreativeRegistrar {
  return {
    calls: [],
    register_uploading_ad_creative(params: RegisterUploadingAdCreativeParams): Promise<void> {
      this.calls.push(params);
      return Promise.reject(new Error("insert into ad_creatives failed"));
    },
  } as FakeAdCreativeRegistrar;
}

// ── Helpers de Request/Deps ───────────────────────────────────────────────────

function post_request(with_auth = true): Request {
  const headers: Record<string, string> = {};
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/mint-ad-upload-url", { method: "POST", headers });
}

function method_request(method: string): Request {
  return new Request("http://localhost/mint-ad-upload-url", {
    method,
    headers: { Authorization: "Bearer fake.jwt.token" },
  });
}

function make_deps(overrides: Partial<MintAdUploadUrlDeps> = {}): MintAdUploadUrlDeps {
  return {
    callerVerifier: caller_ok(AGENT_UID),
    advertiserAuthorizer: authorizer_ok(AGENCY_ID),
    activeAdUploadChecker: checker_count_by_agency({}),
    streamUploadCreator: uploader_ok(STREAM_RESULT),
    adCreativeRegistrar: registrar_ok(),
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_llama_uploader_con_creator_agency_id_y_maxDuration_30", async () => {
  const uploader = uploader_ok(STREAM_RESULT);
  const deps = make_deps({ streamUploadCreator: uploader });
  await handler(post_request(), deps);
  assertEquals(uploader.calls.length, 1, "el uploader de Stream debe llamarse exactamente una vez");
  assertEquals(uploader.calls[0], {
    creator: AGENCY_ID,
    maxDurationSeconds: 30,
    requireSignedURLs: true,
  }, "el uploader debe recibir creator=agency_id y maxDurationSeconds=30 (diferencia 1)");
});

Deno.test("happy_path_inserta_con_agency_id_status_uploading_y_cloudflare_uid_de_stream", async () => {
  const registrar = registrar_ok();
  const deps = make_deps({ adCreativeRegistrar: registrar });
  await handler(post_request(), deps);
  assertEquals(registrar.calls.length, 1, "debe insertarse exactamente una fila en ad_creatives");
  assertEquals(registrar.calls[0], {
    agency_id: AGENCY_ID,
    status: "uploading",
    cloudflare_uid: STREAM_UID,
  }, "el insert debe tener el shape exacto de ad_creatives (sin property_id/position/tus_upload_url)");
});

Deno.test("happy_path_responde_200_con_uploadUrl_y_uid_de_stream", async () => {
  const res = await handler(post_request(), make_deps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.uploadUrl, STREAM_UPLOAD_URL, "body.uploadUrl debe ser la uploadURL que devolvió Stream");
  assertEquals(body.uid, STREAM_UID, "body.uid debe ser el uid que Stream asignó al video");
});

Deno.test("happy_path_nunca_filtra_credenciales_de_stream_en_la_respuesta", async () => {
  // Stream (fake) devuelve de más — simula un adapter real que expusiera el
  // accountId o cualquier otro campo interno. El handler debe filtrar al shape
  // exacto MintAdUploadUrlResponse, no hacer spread de lo que Stream regresó.
  const leaky_result = {
    uploadURL: STREAM_UPLOAD_URL,
    uid: STREAM_UID,
    accountId: "SECRET_STREAM_ACCOUNT_ID",
    apiToken: "SECRET_STREAM_API_TOKEN",
  } as StreamDirectUploadResult;
  const deps = make_deps({ streamUploadCreator: uploader_ok(leaky_result) });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(
    Object.keys(body).sort(),
    ["uid", "uploadUrl"],
    "el body de 200 debe tener EXACTAMENTE las claves uploadUrl/uid, nunca credenciales de Stream",
  );
});

// ── Diferencia 1 — maxDurationSeconds = 30 ───────────────────────────────────

Deno.test("stream_max_duration_seconds_exportado_vale_exactamente_30", () => {
  assertEquals(
    STREAM_MAX_DURATION_SECONDS,
    30,
    "anuncios usa 30s (propiedades usa 120) — el mínimo de 6s NO lo impone esta EF",
  );
});

// ── Diferencia 2 — concurrencia SCOPED POR ORGANIZACIÓN (núcleo) ────────────

Deno.test("agencia_con_creativo_en_uploading_retorna_409_ad_upload_in_progress_sin_llamar_stream_ni_insertar", async () => {
  const checker = checker_count_by_agency({ [AGENCY_ID]: 1 }); // representa 1 creativo en 'uploading'
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409, "un creativo propio ya en curso debe rechazarse con 409");
  const body = await res.json();
  assertEquals(body.error.code, "AD_UPLOAD_IN_PROGRESS");
  assertEquals(uploader.calls.length, 0, "el uploader de Stream NO debe llamarse si hay concurrencia");
  assertEquals(registrar.calls.length, 0, "no debe insertarse ninguna fila si hay concurrencia");
});

Deno.test("agencia_con_creativo_en_processing_retorna_409_ad_upload_in_progress", async () => {
  const checker = checker_count_by_agency({ [AGENCY_ID]: 1 }); // representa 1 creativo en 'processing'
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409);
  assertEquals(uploader.calls.length, 0);
  assertEquals(registrar.calls.length, 0);
});

Deno.test("checker_de_concurrencia_se_consulta_con_agency_id_no_con_uid_del_caller", async () => {
  // Trampa: si el checker SOLO conoce actividad keyeada por AGENT_UID (como el
  // ActiveUploadChecker de property_videos), y el handler consultara por error
  // esa clave, el default_count=1 lo bloquearía. Debe consultarse con AGENCY_ID
  // (default_count=0 para cualquier clave no listada, incluida AGENT_UID).
  const checker = checker_count_by_agency({ [AGENT_UID]: 1 }, 0);
  const deps = make_deps({ activeAdUploadChecker: checker });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "el checker debe consultarse con agency_id, no con el uid del caller");
  assertEquals(
    checker.calls,
    [AGENCY_ID],
    "la concurrencia de anuncios se consulta con el agency_id resuelto por el authorizer",
  );
});

Deno.test("ausencia_de_409_cruzado_video_de_propiedad_en_vuelo_del_mismo_usuario_no_bloquea_el_anuncio", async () => {
  // Escenario PRD: un owner que también es agente tiene un video de PROPIEDAD en
  // vuelo (actividad bajo su propio uid, tabla property_videos — fuera del alcance
  // de esta EF). El checker de anuncios, scoped por agency_id sobre ad_creatives,
  // no tiene forma de verla: default_count=0 para cualquier clave que no sea
  // AGENCY_ID explícitamente. Debe mintear el anuncio con éxito de todas formas.
  const checker = checker_count_by_agency({ [AGENT_UID]: 1, [AGENCY_ID]: 0 });
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(
    res.status,
    200,
    "un video de propiedad en vuelo del mismo usuario NO debe bloquear la subida de un anuncio (separación por dominio)",
  );
  assertEquals(uploader.calls.length, 1);
  assertEquals(registrar.calls.length, 1);
});

// ── Reaper de subidas colgadas (bug heredado de #103) ────────────────────────
// Copiar el pipeline de mint-upload-url sin copiar su arreglo hereda el bug: un
// creativo 'uploading' que nunca llega a Stream dejaría a la organización con un
// 409 PERMANENTE (arreglable solo con SQL a mano). Mismo nombre/semántica de
// constante que mint-upload-url/types.ts:35 — NO un umbral nuevo inventado.

// Literal independiente (15 minutos en ms) — NO se deriva de STALE_UPLOAD_MS: el
// propósito de esta constante en el test es servir de oráculo fijo, para que un
// futuro GREEN que deje STALE_UPLOAD_MS con un valor incorrecto (p.ej. 5 min)
// siga haciendo fallar este test, en vez de "pasar por construcción" contra sí mismo.
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

Deno.test("stale_upload_ms_exportado_vale_15_minutos_en_milisegundos", () => {
  assertEquals(
    STALE_UPLOAD_MS,
    FIFTEEN_MINUTES_MS,
    "STALE_UPLOAD_MS debe ser exactamente 15 minutos en ms (900000), mismo umbral que mint-upload-url",
  );
});

Deno.test("reaper_handler_llama_checker_con_stale_before_15_min_atras", async () => {
  const checker = checker_count_capturing_args(0);
  const deps = make_deps({ activeAdUploadChecker: checker });

  const before_call_ms = Date.now();
  await handler(post_request(), deps);
  const after_call_ms = Date.now();

  assertEquals(checker.calls.length, 1, "el checker debe consultarse exactamente una vez");
  const { agency_id, stale_before } = checker.calls[0];
  assertEquals(agency_id, AGENCY_ID, "el checker debe seguir consultándose con el agency_id resuelto");
  assertExists(
    stale_before,
    "el handler debe pasar un stale_before al checker (calco del reaper de mint-upload-url)",
  );

  const stale_before_ms = Date.parse(stale_before as string);
  assertEquals(Number.isNaN(stale_before_ms), false, "stale_before debe ser una fecha ISO parseable");

  // Tolerancia de unos segundos para absorber el tiempo de ejecución del propio
  // test, NO una condición de carrera real.
  const TOLERANCE_MS = 5000;
  const expected_min_ms = before_call_ms - FIFTEEN_MINUTES_MS - TOLERANCE_MS;
  const expected_max_ms = after_call_ms - FIFTEEN_MINUTES_MS + TOLERANCE_MS;
  const within_window = stale_before_ms >= expected_min_ms && stale_before_ms <= expected_max_ms;
  assertEquals(
    within_window,
    true,
    `stale_before (${stale_before}) debe ser ~15 minutos antes de "ahora" (ventana esperada ` +
      `${new Date(expected_min_ms).toISOString()}..${new Date(expected_max_ms).toISOString()})`,
  );
});

Deno.test("creativo_en_uploading_mas_viejo_que_el_umbral_no_produce_409", async () => {
  // 20 minutos atrás: más viejo que STALE_UPLOAD_MS (15 min) → el filtro real
  // (checker_with_rows, misma semántica que el adapter de mint-upload-url) lo
  // excluye del count. Si el handler NO calculara stale_before correctamente
  // (p.ej. lo dejara undefined o mal calculado), el filtro `created_at > stale_before`
  // se comportaría distinto y este test lo cazaría.
  const twenty_minutes_ago = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const checker = checker_with_rows({
    [AGENCY_ID]: [{ status: "uploading", created_at: twenty_minutes_ago }],
  });
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(
    res.status,
    200,
    "un creativo 'uploading' más viejo que el umbral se considera muerto y no bloquea",
  );
  assertEquals(uploader.calls.length, 1);
  assertEquals(registrar.calls.length, 1);
});

Deno.test("creativo_en_uploading_dentro_del_umbral_si_produce_409", async () => {
  // 1 minuto atrás: dentro de STALE_UPLOAD_MS (15 min) → SÍ cuenta. Confirma,
  // contra el filtro real (no un count fijo), que el caso "reciente" del test
  // original (agencia_con_creativo_en_uploading_retorna_409...) sigue sosteniéndose.
  const one_minute_ago = new Date(Date.now() - 60 * 1000).toISOString();
  const checker = checker_with_rows({
    [AGENCY_ID]: [{ status: "uploading", created_at: one_minute_ago }],
  });
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409, "un creativo 'uploading' reciente sigue bloqueando con el filtro real");
  const body = await res.json();
  assertEquals(body.error.code, "AD_UPLOAD_IN_PROGRESS");
  assertEquals(uploader.calls.length, 0);
  assertEquals(registrar.calls.length, 0);
});

Deno.test("creativo_en_processing_aunque_viejo_igual_produce_409_sin_ventana_de_expiracion", async () => {
  // 'processing' NO tiene ventana de expiración a propósito (el webhook lo
  // resuelve solo — mismo criterio que mint-upload-url/types.ts:56-60). Un
  // creativo 'processing' de hace 2 horas debe bloquear igual que uno de hace
  // 1 segundo — NO existe un par viejo/reciente para este estado.
  const two_hours_ago = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const checker = checker_with_rows({
    [AGENCY_ID]: [{ status: "processing", created_at: two_hours_ago }],
  });
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(
    res.status,
    409,
    "'processing' bloquea sin importar la edad — no tiene ventana de expiración",
  );
  const body = await res.json();
  assertEquals(body.error.code, "AD_UPLOAD_IN_PROGRESS");
  assertEquals(uploader.calls.length, 0);
  assertEquals(registrar.calls.length, 0);
});

Deno.test("reaper_no_regresion_checker_en_0_sigue_flujo_feliz_200", async () => {
  const checker = checker_count_capturing_args(0);
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "checker en 0 no debe bloquear el flujo feliz (no regresión)");
  assertEquals(uploader.calls.length, 1);
  assertEquals(registrar.calls.length, 1);
});

Deno.test("reaper_no_regresion_checker_en_1_sigue_409_sin_llamar_stream_ni_insertar", async () => {
  const checker = checker_count_capturing_args(1);
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "AD_UPLOAD_IN_PROGRESS");
  assertEquals(uploader.calls.length, 0, "no regresión: sigue sin llamar a Stream con >=1 activo");
  assertEquals(registrar.calls.length, 0, "no regresión: sigue sin insertar con >=1 activo");
});

// ── Autz fail-closed (AdvertiserAuthorizer) ──────────────────────────────────
// HONESTIDAD (guardián de 169.4, 2026-08-16): las 3 pruebas siguientes usan el
// MISMO fake authorizer_forbidden() y las MISMAS aserciones — el fake colapsa
// las 3 causas de negocio ANTES de que el handler las vea, así que a nivel de
// ESTE seam (contrato del handler) documentan que el handler responde IGUAL
// ante cualquier `{ok:false}`, no que las 3 causas se disparen de verdad. La
// verificación de que las 3 causas se DISTINGUEN correctamente (sin membresía /
// rol no owner-admin / sin capacidad) vive en el adapter real y está en
// supabase/functions/_shared/advertiser_authorizer.test.ts (make_advertiser_authorizer).

Deno.test("agente_sin_organizacion_retorna_403_forbidden", async () => {
  const deps = make_deps({ advertiserAuthorizer: authorizer_forbidden() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 403, "sin organización activa debe rechazarse con 403, nunca 404 ni 500");
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("organizacion_sin_capacidad_de_anunciar_retorna_403_forbidden", async () => {
  // org_can_advertise=false (168.1) — el caller SÍ es owner/admin de una
  // organización real, pero esa organización no tiene la capacidad encendida.
  const deps = make_deps({ advertiserAuthorizer: authorizer_forbidden() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("miembro_no_owner_admin_de_organizacion_que_si_puede_anunciar_retorna_403_forbidden", async () => {
  // El caller es viewer/agent (no owner/admin) de una organización con
  // can_advertise=true — el rol también es fail-closed, no solo la capacidad.
  const deps = make_deps({ advertiserAuthorizer: authorizer_forbidden() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("forbidden_403_mensaje_es_literal_fijo_y_no_filtra_el_uid_del_caller", async () => {
  // Guardián de 169.4: mutar el handler para que `message` incluya detalle de
  // autz (o el uid) dejaba los demás tests verdes porque solo fijan status y
  // error.code. El mensaje del 403 es información hacia el cliente — debe ser
  // un literal fijo, sin interpolar el uid ni ningún dato del caller.
  const deps = make_deps({ advertiserAuthorizer: authorizer_forbidden() });
  const res = await handler(post_request(), deps);
  const body = await res.json();
  assertEquals(
    body.error.message,
    "No tienes permiso para publicar anuncios de esta organización",
    "el mensaje del 403 debe ser el literal fijo, no una interpolación con detalle de autz",
  );
  assertEquals(
    body.error.message.includes(AGENT_UID),
    false,
    "el mensaje del 403 NUNCA debe filtrar el uid del caller",
  );
});

Deno.test("403_forbidden_no_llama_a_checker_uploader_ni_registrar", async () => {
  const checker = checker_count_by_agency({});
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    advertiserAuthorizer: authorizer_forbidden(),
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  await handler(post_request(), deps);
  assertEquals(checker.calls.length, 0, "sin autorización no debe consultarse la concurrencia");
  assertEquals(uploader.calls.length, 0, "sin autorización no debe llamarse a Stream");
  assertEquals(registrar.calls.length, 0, "sin autorización no debe insertarse nada");
});

Deno.test("advertiser_authorizer_se_consulta_con_el_uid_del_caller", async () => {
  const authorizer = authorizer_ok(AGENCY_ID);
  const deps = make_deps({ advertiserAuthorizer: authorizer });
  await handler(post_request(), deps);
  assertEquals(
    authorizer.calls,
    [AGENT_UID],
    "el authorizer debe consultarse con el uid del caller (nunca un agency_id del body)",
  );
});

// ── Auth (frontera de confianza, fail-closed) ─────────────────────────────────

Deno.test("sin_authorization_header_retorna_401_unauthenticated", async () => {
  const res = await handler(post_request(false), make_deps());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_callerVerifier_falla_retorna_401_unauthenticated", async () => {
  const deps = make_deps({ callerVerifier: caller_unauthenticated() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_no_llama_a_authorizer_checker_uploader_ni_registrar", async () => {
  const authorizer = authorizer_ok(AGENCY_ID);
  const checker = checker_count_by_agency({});
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    callerVerifier: caller_unauthenticated(),
    advertiserAuthorizer: authorizer,
    activeAdUploadChecker: checker,
    streamUploadCreator: uploader,
    adCreativeRegistrar: registrar,
  });
  await handler(post_request(), deps);
  assertEquals(authorizer.calls.length, 0, "sin auth válida no debe consultarse la autorización");
  assertEquals(checker.calls.length, 0, "sin auth válida no debe consultarse la concurrencia");
  assertEquals(uploader.calls.length, 0, "sin auth válida no debe llamarse a Stream");
  assertEquals(registrar.calls.length, 0, "sin auth válida no debe insertarse nada");
});

// ── Fallo de Stream → 502, sin fila huérfana ─────────────────────────────────

Deno.test("stream_falla_retorna_502_stream_upload_failed", async () => {
  const deps = make_deps({ streamUploadCreator: uploader_throws() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error.code, "STREAM_UPLOAD_FAILED");
});

Deno.test("stream_falla_no_inserta_fila_huerfana", async () => {
  const registrar = registrar_ok();
  const deps = make_deps({ streamUploadCreator: uploader_throws(), adCreativeRegistrar: registrar });
  await handler(post_request(), deps);
  assertEquals(registrar.calls.length, 0, "si Stream falla no debe existir fila ad_creatives huérfana");
});

// ── Fallo del insert → 500 ────────────────────────────────────────────────────

Deno.test("insert_en_db_falla_retorna_500_internal_error", async () => {
  const deps = make_deps({ adCreativeRegistrar: registrar_throws() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

// ── Método HTTP ───────────────────────────────────────────────────────────────

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

// ── CORS ──────────────────────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200_con_access_control_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status >= 200 && res.status <= 204, true, "OPTIONS debe retornar 200-204");
  assertExists(res.headers.get("Access-Control-Allow-Origin"), "preflight debe incluir el header CORS");
});

// ── Boundary ──────────────────────────────────────────────────────────────────

Deno.test("deps_undefined_retorna_500_internal_error", async () => {
  const res = await handler(post_request());
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

// ── Forma invariante de errores ────────────────────────────────────────────────

Deno.test("error_respuesta_sigue_forma_error_code_message", async () => {
  const res = await handler(post_request(false), make_deps());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error, "respuesta de error debe tener campo 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});
