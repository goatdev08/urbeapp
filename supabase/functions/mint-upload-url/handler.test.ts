// supabase/functions/mint-upload-url/handler.test.ts
// Tests RED — subtarea 68.3
// Edge Function: mint-upload-url/handler.ts (Cloudflare Stream Direct Creator Upload, upload-first)
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net supabase/functions/mint-upload-url/handler.test.ts
//         (desde el repo raíz, con el import map de supabase/functions/deno.json)
//
// SEAMS (interfaz bajo test):
// - Contrato público HTTP del handler(req, deps?): request → status + body JSON.
// - CallerVerifier.verify_caller (DI, fake) — frontera JWT; el uid SIEMPRE sale de aquí,
//   nunca del body.
// - ActiveUploadChecker.count_active_uploads (DI, fake) — frontera de la invariante de
//   concurrencia §13.2 (1 video en uploading/processing por agente).
// - StreamUploadCreator.create_direct_upload (DI, fake) — frontera de red con Cloudflare
//   Stream; NUNCA red real.
// - VideoRegistrar.register_uploading_video (DI, fake) — frontera de escritura en DB;
//   NUNCA DB real.
//
// EDGE CASES (RED) — 68.3:
//
// ### Happy path
// - uploader llamado exactamente una vez con { creator: uid, maxDurationSeconds: 120,
//   requireSignedURLs: true } (shape exacto)
// - registrar llamado exactamente una vez con { agent_id: uid, property_id: null,
//   status: 'uploading', position: 1, cloudflare_uid, tus_upload_url } provenientes de
//   la respuesta de Stream (shape exacto)
// - property_id del insert es NULL explícito (upload-first — EC9, aserción dedicada)
// - 200 con body { uploadUrl, uid } = los valores devueltos por Stream
//
// ### Concurrencia por agente (invariante §13.2, fail-closed) — núcleo de la subtarea
// - agente con 1 video propio en 'uploading' → 409 UPLOAD_IN_PROGRESS; uploader y
//   registrar NO se llaman (verificado con spies — cero llamadas)
// - agente con 1 video propio en 'processing' → 409 UPLOAD_IN_PROGRESS
// - el checker se consulta con el uid del CALLER, no de otro agente: otro agente con
//   upload activo no bloquea al caller (scoping por uid — EC8)
//
// ### Auth (frontera de confianza, fail-closed)
// - sin header Authorization → 401 UNAUTHENTICATED
// - JWT inválido (callerVerifier ok:false) → 401 UNAUTHENTICATED
// - JWT inválido: ni checker, ni uploader, ni registrar se llaman (fail-closed real)
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
// ── EDGE CASES (RED) — 103.1 parte B: reaper de subidas colgadas ──────────────
// Bug derivado de #103: count_active_uploads() (hoy) cuenta CUALQUIER fila
// 'uploading'/'processing' del agente sin ventana de expiración. Si el binario
// nunca llega (falla real, no falso negativo), la fila queda 'uploading' PARA
// SIEMPRE → 409 UPLOAD_IN_PROGRESS eterno, el agente no puede volver a publicar
// jamás. Diseño acordado: el HANDLER calcula `stale_before` (ISO, ahora - 15 min,
// constante exportada STALE_UPLOAD_MS) y se lo pasa al checker; el filtro
// `created_at > stale_before` para 'uploading' vive en el adapter (_shared/clients.ts,
// fuera de alcance de este archivo — no se testea aquí, solo el contrato del handler).
//
// SEAM adicional: ActiveUploadChecker.count_active_uploads(agent_id, stale_before) —
// el segundo argumento capturado por el fake es la interfaz bajo test aquí.
//
// ### DELTA (falla hoy — el handler NO calcula ni pasa stale_before)
// - el handler llama al checker con un stale_before ISO ≈ 15 minutos en el pasado
//   (tolerancia de unos segundos) — aserción sobre el argumento capturado por el fake
// - STALE_UPLOAD_MS está exportado y vale 15 minutos en ms (900000) — aserción directa
//   contra el valor; hoy es un stub placeholder (0), así que falla por ASERCIÓN
//
// ### INVARIANTE / no-regresión (el shape de retorno del checker ya determina el
//     flujo hoy, independientemente de si stale_before viaja o no — no debe romperse
//     cuando GREEN empiece a pasarlo)
// - checker devuelve 0 → sigue el flujo feliz (Stream + insert + 200)
// - checker devuelve 1 → 409 UPLOAD_IN_PROGRESS sin llamar a Stream ni insertar

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import {
  STALE_UPLOAD_MS,
  type ActiveUploadChecker,
  type CallerVerifier,
  type CallerVerifyResult,
  type MintUploadUrlDeps,
  type PendingUploadCanceller,
  type RegisterUploadingVideoParams,
  type StreamDirectUploadParams,
  type StreamDirectUploadResult,
  type StreamUploadCreator,
  type VideoRegistrar,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENT_UID = "00000000-0000-0000-0000-000000000001";
const OTHER_AGENT_UID = "00000000-0000-0000-0000-000000000099";
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

// ── Fakes — ActiveUploadChecker ───────────────────────────────────────────────

interface FakeActiveUploadChecker extends ActiveUploadChecker {
  calls: string[];
}

/**
 * count_by_agent mapea agent_id → count; cualquier agent_id ausente usa default_count.
 * Un count de 1 representa "tiene 1 video en uploading o processing" (la distinción
 * entre esos dos estados vive en el WHERE ... IN (...) del adapter real, GREEN;
 * a este seam solo le importa el count agregado que ya filtró ambos estados).
 */
function checker_count(
  count_by_agent: Record<string, number>,
  default_count = 0,
): FakeActiveUploadChecker {
  return {
    calls: [],
    count_active_uploads(agent_id: string): Promise<number> {
      this.calls.push(agent_id);
      return Promise.resolve(count_by_agent[agent_id] ?? default_count);
    },
  } as FakeActiveUploadChecker;
}

// ── Fake — ActiveUploadChecker que además captura stale_before (103.1 parte B) ──
// Distinto del fake de arriba: aquí nos importa el SEGUNDO argumento tal cual el
// handler lo invoca (o no lo invoca — hoy no lo pasa, por eso queda undefined).

interface FakeActiveUploadCheckerWithArgs extends ActiveUploadChecker {
  calls: Array<{ agent_id: string; stale_before?: string }>;
}

function checker_count_capturing_args(count = 0): FakeActiveUploadCheckerWithArgs {
  return {
    calls: [],
    count_active_uploads(agent_id: string, stale_before?: string): Promise<number> {
      this.calls.push({ agent_id, stale_before });
      return Promise.resolve(count);
    },
  } as FakeActiveUploadCheckerWithArgs;
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
    // 192.1: los tests legados NUNCA mandan size_bytes → este camino no debe tocarse.
    create_tus_upload(): Promise<StreamDirectUploadResult> {
      return Promise.reject(new Error("create_tus_upload no debe llamarse sin size_bytes"));
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
    create_tus_upload(): Promise<StreamDirectUploadResult> {
      return Promise.reject(new Error("create_tus_upload no debe llamarse sin size_bytes"));
    },
  } as FakeStreamUploadCreator;
}

// ── Fakes — VideoRegistrar ────────────────────────────────────────────────────

interface FakeVideoRegistrar extends VideoRegistrar {
  calls: RegisterUploadingVideoParams[];
}

function registrar_ok(): FakeVideoRegistrar {
  return {
    calls: [],
    register_uploading_video(params: RegisterUploadingVideoParams): Promise<void> {
      this.calls.push(params);
      return Promise.resolve();
    },
  } as FakeVideoRegistrar;
}

function registrar_throws(): FakeVideoRegistrar {
  return {
    calls: [],
    register_uploading_video(params: RegisterUploadingVideoParams): Promise<void> {
      this.calls.push(params);
      return Promise.reject(new Error("insert into property_videos failed"));
    },
  } as FakeVideoRegistrar;
}

// ── Helpers de Request/Deps ───────────────────────────────────────────────────

function post_request(with_auth = true): Request {
  const headers: Record<string, string> = {};
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/mint-upload-url", { method: "POST", headers });
}

function method_request(method: string): Request {
  return new Request("http://localhost/mint-upload-url", {
    method,
    headers: { Authorization: "Bearer fake.jwt.token" },
  });
}

function make_deps(overrides: Partial<MintUploadUrlDeps> = {}): MintUploadUrlDeps {
  return {
    callerVerifier: caller_ok(AGENT_UID),
    activeUploadChecker: checker_count({}),
    streamUploadCreator: uploader_ok(STREAM_RESULT),
    videoRegistrar: registrar_ok(),
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_llama_uploader_con_creator_uid_y_parametros_fijos_de_stream", async () => {
  const uploader = uploader_ok(STREAM_RESULT);
  const deps = make_deps({ streamUploadCreator: uploader });
  await handler(post_request(), deps);
  assertEquals(uploader.calls.length, 1, "el uploader de Stream debe llamarse exactamente una vez");
  assertEquals(uploader.calls[0], {
    creator: AGENT_UID,
    maxDurationSeconds: 120,
    requireSignedURLs: true,
  }, "el uploader debe recibir creator=uid del caller y los parámetros fijos de Stream");
});

Deno.test("happy_path_inserta_con_agent_id_status_uploading_position_1_y_datos_de_stream", async () => {
  const registrar = registrar_ok();
  const deps = make_deps({ videoRegistrar: registrar });
  await handler(post_request(), deps);
  assertEquals(registrar.calls.length, 1, "debe insertarse exactamente una fila");
  assertEquals(registrar.calls[0], {
    agent_id: AGENT_UID,
    property_id: null,
    status: "uploading",
    position: 1,
    cloudflare_uid: STREAM_UID,
    tus_upload_url: STREAM_UPLOAD_URL,
  }, "el insert debe tener el shape exacto derivado de la respuesta de Stream");
});

Deno.test("happy_path_property_id_del_insert_es_null_upload_first", async () => {
  // EC9: upload-first — el video existe antes de asociarse a una propiedad.
  const registrar = registrar_ok();
  const deps = make_deps({ videoRegistrar: registrar });
  await handler(post_request(), deps);
  assertEquals(
    registrar.calls[0].property_id,
    null,
    "property_id debe ser NULL: el video se sube antes de publicar la propiedad",
  );
});

Deno.test("happy_path_responde_200_con_uploadUrl_y_uid_de_stream", async () => {
  const res = await handler(post_request(), make_deps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.uploadUrl, STREAM_UPLOAD_URL, "body.uploadUrl debe ser la uploadURL que devolvió Stream");
  assertEquals(body.uid, STREAM_UID, "body.uid debe ser el uid que Stream asignó al video");
});

// ── Concurrencia por agente (invariante §13.2, fail-closed) ──────────────────

Deno.test("agente_con_video_en_uploading_retorna_409_sin_llamar_stream_ni_insertar", async () => {
  const checker = checker_count({ [AGENT_UID]: 1 }); // representa 1 video en 'uploading'
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeUploadChecker: checker,
    streamUploadCreator: uploader,
    videoRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409, "un video propio ya en curso debe rechazarse con 409");
  const body = await res.json();
  assertEquals(body.error.code, "UPLOAD_IN_PROGRESS");
  assertEquals(uploader.calls.length, 0, "el uploader de Stream NO debe llamarse si hay concurrencia");
  assertEquals(registrar.calls.length, 0, "no debe insertarse ninguna fila si hay concurrencia");
});

Deno.test("agente_con_video_en_processing_retorna_409_sin_llamar_stream_ni_insertar", async () => {
  const checker = checker_count({ [AGENT_UID]: 1 }); // representa 1 video en 'processing'
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeUploadChecker: checker,
    streamUploadCreator: uploader,
    videoRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409);
  assertEquals(uploader.calls.length, 0);
  assertEquals(registrar.calls.length, 0);
});

Deno.test("checker_de_concurrencia_se_consulta_con_el_uid_del_caller_no_bloquea_por_otro_agente", async () => {
  // El OTRO agente sí tiene un upload activo; el caller (AGENT_UID) no tiene ninguno.
  const checker = checker_count({ [OTHER_AGENT_UID]: 1 }, 0);
  const deps = make_deps({ activeUploadChecker: checker });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "el conflicto de OTRO agente no debe bloquear al caller");
  assertEquals(
    checker.calls,
    [AGENT_UID],
    "el checker debe consultarse exactamente con el uid del propio caller",
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

Deno.test("jwt_invalido_no_llama_a_checker_uploader_ni_registrar", async () => {
  const checker = checker_count({});
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    callerVerifier: caller_unauthenticated(),
    activeUploadChecker: checker,
    streamUploadCreator: uploader,
    videoRegistrar: registrar,
  });
  await handler(post_request(), deps);
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
  const deps = make_deps({ streamUploadCreator: uploader_throws(), videoRegistrar: registrar });
  await handler(post_request(), deps);
  assertEquals(registrar.calls.length, 0, "si Stream falla no debe existir fila property_videos huérfana");
});

// ── Fallo del insert → 500 ────────────────────────────────────────────────────

Deno.test("insert_en_db_falla_retorna_500_internal_error", async () => {
  const deps = make_deps({ videoRegistrar: registrar_throws() });
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

// ════════════════════════════════════════════════════════════════════════════
// 103.1 (parte B) — Reaper de subidas colgadas: count_active_uploads necesita
// ventana de expiración (bug derivado de #103, ver comentario EDGE CASES arriba).
// ════════════════════════════════════════════════════════════════════════════

// Literal independiente (15 minutos en ms) — NO se deriva de STALE_UPLOAD_MS: el
// propósito de esta constante en el test es servir de oráculo fijo, para que un
// futuro GREEN que deje STALE_UPLOAD_MS con un valor incorrecto (p.ej. 5 min) siga
// haciendo fallar este test, en vez de "pasar por construcción" contra sí mismo.
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

// ── DELTA — el handler HOY no calcula ni pasa stale_before al checker ─────────

Deno.test("reaper_handler_llama_checker_con_stale_before_15_min_atras", async () => {
  const checker = checker_count_capturing_args(0);
  const deps = make_deps({ activeUploadChecker: checker });

  const before_call_ms = Date.now();
  await handler(post_request(), deps);
  const after_call_ms = Date.now();

  assertEquals(checker.calls.length, 1, "el checker debe consultarse exactamente una vez");
  const { agent_id, stale_before } = checker.calls[0];
  assertEquals(agent_id, AGENT_UID, "el checker debe seguir consultándose con el uid del caller");
  assertExists(
    stale_before,
    "el handler debe pasar un stale_before al checker (hoy NO lo pasa — RED)",
  );

  const stale_before_ms = Date.parse(stale_before as string);
  assertEquals(Number.isNaN(stale_before_ms), false, "stale_before debe ser una fecha ISO parseable");

  // Tolerancia de unos segundos para absorber el tiempo de ejecución del propio test,
  // NO una condición de carrera real: stale_before debe caer en la ventana
  // [antes_de_llamar - 15min - tolerancia, después_de_llamar - 15min + tolerancia].
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

Deno.test("stale_upload_ms_exportado_vale_15_minutos_en_milisegundos", () => {
  assertEquals(
    STALE_UPLOAD_MS,
    FIFTEEN_MINUTES_MS,
    "STALE_UPLOAD_MS debe ser exactamente 15 minutos en ms (900000) — hoy es un stub placeholder",
  );
});

// ── INVARIANTE / no-regresión — el shape de retorno del checker sigue mandando ─

Deno.test("reaper_no_regresion_checker_en_0_sigue_flujo_feliz_200", async () => {
  const checker = checker_count_capturing_args(0);
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    activeUploadChecker: checker,
    streamUploadCreator: uploader,
    videoRegistrar: registrar,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "checker en 0 no debe bloquear el flujo feliz (no regresión)");
  assertEquals(uploader.calls.length, 1);
  assertEquals(registrar.calls.length, 1);
});

Deno.test(
  "reaper_no_regresion_checker_en_1_sigue_409_sin_llamar_stream_ni_insertar",
  async () => {
    const checker = checker_count_capturing_args(1);
    const uploader = uploader_ok(STREAM_RESULT);
    const registrar = registrar_ok();
    const deps = make_deps({
      activeUploadChecker: checker,
      streamUploadCreator: uploader,
      videoRegistrar: registrar,
    });
    const res = await handler(post_request(), deps);
    assertEquals(res.status, 409);
    const body = await res.json();
    assertEquals(body.error.code, "UPLOAD_IN_PROGRESS");
    assertEquals(uploader.calls.length, 0, "no regresión: sigue sin llamar a Stream con >=1 activo");
    assertEquals(registrar.calls.length, 0, "no regresión: sigue sin insertar con >=1 activo");
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Quick fix 2026-08-15 (hallazgo del smoke manual, sin tarea de Taskmaster):
// "Cambiar video" durante una subida debe CANCELAR la anterior y dejar subir
// otra — no 409 hasta que pase el reaper de 15 min. Contrato ADITIVO:
//   body { replace: true } → antes del chequeo de concurrencia, el handler
//   pide a PendingUploadCanceller.cancel_unattached_uploads(uid) soft-borrar
//   las filas del caller con property_id IS NULL en uploading/processing (los
//   videos "del wizard en curso"); luego sigue el flujo normal (el count solo
//   verá filas ya asociadas a una propiedad). Sin `replace` (builds viejos) →
//   comportamiento idéntico al anterior.
// EDGE CASES:
// - (RP-1) replace_true_llama_canceller_con_uid_del_caller_y_luego_200
// - (RP-2) sin_replace_no_llama_canceller_y_conserva_409
// - (RP-3) replace_true_pero_count_sigue_en_1_retorna_409 (fila asociada a una
//          propiedad ya publicada — el replace NO la toca)
// - (RP-4) canceller_lanza_retorna_500_sin_llamar_stream
// - (RP-5) body_invalido_no_json_se_trata_como_sin_replace
// ─────────────────────────────────────────────────────────────────────────────

interface FakePendingUploadCanceller extends PendingUploadCanceller {
  calls: string[];
}

function canceller_ok(): FakePendingUploadCanceller {
  return {
    calls: [],
    cancel_unattached_uploads(agent_id: string): Promise<number> {
      this.calls.push(agent_id);
      return Promise.resolve(1);
    },
  } as FakePendingUploadCanceller;
}

function canceller_throws(): FakePendingUploadCanceller {
  return {
    calls: [],
    cancel_unattached_uploads(agent_id: string): Promise<number> {
      this.calls.push(agent_id);
      return Promise.reject(new Error("update property_videos failed"));
    },
  } as FakePendingUploadCanceller;
}

function post_request_with_body(body: string): Request {
  return new Request("http://localhost/mint-upload-url", {
    method: "POST",
    headers: { Authorization: "Bearer fake.jwt.token", "Content-Type": "application/json" },
    body,
  });
}

Deno.test("(RP-1) replace_true_llama_canceller_con_uid_del_caller_y_luego_200", async () => {
  const canceller = canceller_ok();
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    pendingUploadCanceller: canceller,
    activeUploadChecker: checker_count({}),
    streamUploadCreator: uploader,
    videoRegistrar: registrar,
  });
  const res = await handler(post_request_with_body(JSON.stringify({ replace: true })), deps);
  assertEquals(res.status, 200);
  assertEquals(canceller.calls, [AGENT_UID], "debe cancelar los pendientes DEL CALLER (uid del JWT)");
  assertEquals(uploader.calls.length, 1);
  assertEquals(registrar.calls.length, 1);
});

Deno.test("(RP-2) sin_replace_no_llama_canceller_y_conserva_409", async () => {
  const canceller = canceller_ok();
  const deps = make_deps({
    pendingUploadCanceller: canceller,
    activeUploadChecker: checker_count({ [AGENT_UID]: 1 }),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409, "sin replace el contrato viejo se conserva (builds instalados)");
  assertEquals(canceller.calls.length, 0, "sin replace NO se cancela nada");
});

Deno.test("(RP-3) replace_true_pero_count_sigue_en_1_retorna_409", async () => {
  // El count representa una fila YA asociada a una propiedad (processing de un
  // video publicado) — el replace no la toca y la concurrencia sigue mandando.
  const canceller = canceller_ok();
  const uploader = uploader_ok(STREAM_RESULT);
  const deps = make_deps({
    pendingUploadCanceller: canceller,
    activeUploadChecker: checker_count({ [AGENT_UID]: 1 }),
    streamUploadCreator: uploader,
  });
  const res = await handler(post_request_with_body(JSON.stringify({ replace: true })), deps);
  assertEquals(res.status, 409);
  assertEquals(canceller.calls.length, 1, "el canceller SÍ corrió (antes del count)");
  assertEquals(uploader.calls.length, 0);
});

Deno.test("(RP-4) canceller_lanza_retorna_500_sin_llamar_stream", async () => {
  const uploader = uploader_ok(STREAM_RESULT);
  const registrar = registrar_ok();
  const deps = make_deps({
    pendingUploadCanceller: canceller_throws(),
    streamUploadCreator: uploader,
    videoRegistrar: registrar,
  });
  const res = await handler(post_request_with_body(JSON.stringify({ replace: true })), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
  assertEquals(uploader.calls.length, 0);
  assertEquals(registrar.calls.length, 0);
});

Deno.test("(RP-5) body_invalido_no_json_se_trata_como_sin_replace", async () => {
  const canceller = canceller_ok();
  const deps = make_deps({ pendingUploadCanceller: canceller });
  const res = await handler(post_request_with_body("{not json"), deps);
  assertEquals(res.status, 200, "un body ilegible no debe romper el flujo viejo");
  assertEquals(canceller.calls.length, 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// RED — 192.1: subida por TUS (resumable) cuando el cliente manda `size_bytes`
// ═════════════════════════════════════════════════════════════════════════════
// Origen: tester real (2026-08-17) bloqueado por "El video supera el máximo
// permitido (200 MB)". 200 MB es el techo del direct upload BÁSICO (POST
// multipart) de Cloudflare Stream; para 500 MB (MAX_VIDEO_SIZE_BYTES del
// cliente) hay que crear el upload por TUS: POST /stream?direct_user=true con
// Upload-Length → el `Location` de la respuesta es la URL de PATCH del cliente.
//
// Contrato retro-compatible (§0.5 — builds instalados siguen mandando solo
// { replace }): el nuevo cliente añade `size_bytes` al body.
//   - size_bytes entero válido → streamUploadCreator.create_tus_upload({ creator,
//     maxDurationSeconds, requireSignedURLs, uploadLength }) — create_direct_upload
//     NO se llama; 200 { uploadUrl, uid, protocol: 'tus' }.
//   - sin size_bytes (o inválido: no entero, ≤0, string) → camino básico EXACTO
//     de hoy; 200 { uploadUrl, uid, protocol: 'basic' }.
//   - size_bytes > MAX_UPLOAD_SIZE_BYTES (524288000) → 400 VIDEO_TOO_LARGE, sin
//     tocar Stream ni la tabla. == 524288000 → OK.
//   - create_tus_upload lanza → 502 STREAM_UPLOAD_FAILED, sin insert.
//   - replace:true + size_bytes → canceller corre Y luego TUS (ambos flags).
//   - la fila insertada guarda tus_upload_url = Location y cloudflare_uid = uid.
//
// SEAM nuevo: StreamUploadCreator.create_tus_upload (DI, fake) — nunca red real.

import {
  MAX_UPLOAD_SIZE_BYTES,
  type StreamTusUploadParams,
} from "./types.ts";

const TUS_LOCATION = "https://upload.cloudflarestream.com/tus/aaaaaaaabbbbccccdddd000000000002?tusv2=true";
const TUS_UID = "aaaaaaaabbbbccccdddd000000000002";
const TUS_RESULT: StreamDirectUploadResult = { uploadURL: TUS_LOCATION, uid: TUS_UID };
const SIZE_250MB = 250 * 1024 * 1024;

interface FakeStreamUploadCreatorBoth extends StreamUploadCreator {
  basic_calls: StreamDirectUploadParams[];
  tus_calls: StreamTusUploadParams[];
}

function uploader_both(
  opts: { tus_throws?: boolean } = {},
): FakeStreamUploadCreatorBoth {
  return {
    basic_calls: [],
    tus_calls: [],
    create_direct_upload(params: StreamDirectUploadParams): Promise<StreamDirectUploadResult> {
      this.basic_calls.push(params);
      return Promise.resolve(STREAM_RESULT);
    },
    create_tus_upload(params: StreamTusUploadParams): Promise<StreamDirectUploadResult> {
      this.tus_calls.push(params);
      if (opts.tus_throws) return Promise.reject(new Error("cloudflare stream tus create failed"));
      return Promise.resolve(TUS_RESULT);
    },
  } as FakeStreamUploadCreatorBoth;
}

Deno.test("(T-0) MAX_UPLOAD_SIZE_BYTES_es_500_MiB_espejo_de_MAX_VIDEO_SIZE_BYTES_del_cliente", () => {
  assertEquals(MAX_UPLOAD_SIZE_BYTES, 524288000);
});

Deno.test("(T-1) size_bytes_valido_crea_upload_por_tus_con_uploadLength_y_no_llama_al_basico", async () => {
  const uploader = uploader_both();
  const deps = make_deps({ streamUploadCreator: uploader });
  const res = await handler(
    post_request_with_body(JSON.stringify({ replace: true, size_bytes: SIZE_250MB })),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(uploader.tus_calls.length, 1, "create_tus_upload exactamente una vez");
  assertEquals(uploader.tus_calls[0], {
    creator: AGENT_UID,
    maxDurationSeconds: 120,
    requireSignedURLs: true,
    uploadLength: SIZE_250MB,
  });
  assertEquals(uploader.basic_calls.length, 0, "el POST básico NO debe usarse cuando hay size_bytes");
});

Deno.test("(T-2) tus_responde_uploadUrl_uid_y_protocol_tus_e_inserta_location_como_tus_upload_url", async () => {
  const registrar = registrar_ok();
  const deps = make_deps({ streamUploadCreator: uploader_both(), videoRegistrar: registrar });
  const res = await handler(
    post_request_with_body(JSON.stringify({ size_bytes: SIZE_250MB })),
    deps,
  );
  const body = await res.json();
  assertEquals(body, { uploadUrl: TUS_LOCATION, uid: TUS_UID, protocol: "tus" });
  assertEquals(registrar.calls.length, 1);
  assertEquals(registrar.calls[0].cloudflare_uid, TUS_UID);
  assertEquals(registrar.calls[0].tus_upload_url, TUS_LOCATION);
  assertEquals(registrar.calls[0].status, "uploading");
  assertEquals(registrar.calls[0].property_id, null);
});

Deno.test("(T-3) sin_size_bytes_conserva_el_camino_basico_y_responde_protocol_basic", async () => {
  const uploader = uploader_both();
  const deps = make_deps({ streamUploadCreator: uploader });
  const res = await handler(post_request_with_body(JSON.stringify({ replace: true })), deps);
  const body = await res.json();
  assertEquals(uploader.basic_calls.length, 1);
  assertEquals(uploader.tus_calls.length, 0);
  assertEquals(body, { uploadUrl: STREAM_UPLOAD_URL, uid: STREAM_UID, protocol: "basic" });
});

Deno.test("(T-3b) sin_body_en_absoluto_conserva_el_camino_basico", async () => {
  const uploader = uploader_both();
  const deps = make_deps({ streamUploadCreator: uploader });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200);
  assertEquals(uploader.basic_calls.length, 1);
  assertEquals(uploader.tus_calls.length, 0);
});

Deno.test("(T-4) size_bytes_mayor_al_maximo_retorna_400_VIDEO_TOO_LARGE_sin_tocar_stream_ni_tabla", async () => {
  const uploader = uploader_both();
  const registrar = registrar_ok();
  const deps = make_deps({ streamUploadCreator: uploader, videoRegistrar: registrar });
  const res = await handler(
    post_request_with_body(JSON.stringify({ size_bytes: MAX_UPLOAD_SIZE_BYTES + 1 })),
    deps,
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_TOO_LARGE");
  assertEquals(typeof body.error.message, "string");
  assertEquals(uploader.tus_calls.length, 0);
  assertEquals(uploader.basic_calls.length, 0);
  assertEquals(registrar.calls.length, 0);
});

Deno.test("(T-4b) size_bytes_exactamente_el_maximo_es_valido_y_va_por_tus", async () => {
  const uploader = uploader_both();
  const deps = make_deps({ streamUploadCreator: uploader });
  const res = await handler(
    post_request_with_body(JSON.stringify({ size_bytes: MAX_UPLOAD_SIZE_BYTES })),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(uploader.tus_calls.length, 1);
  assertEquals(uploader.tus_calls[0].uploadLength, MAX_UPLOAD_SIZE_BYTES);
});

Deno.test("(T-5) size_bytes_invalido_se_ignora_y_cae_al_camino_basico", async () => {
  for (const bad of ["abc", 0, -1, 1.5, null, true]) {
    const uploader = uploader_both();
    const deps = make_deps({ streamUploadCreator: uploader });
    const res = await handler(post_request_with_body(JSON.stringify({ size_bytes: bad })), deps);
    assertEquals(res.status, 200, `size_bytes=${JSON.stringify(bad)} no debe romper el flujo`);
    assertEquals(uploader.tus_calls.length, 0, `size_bytes=${JSON.stringify(bad)} no debe ir por tus`);
    assertEquals(uploader.basic_calls.length, 1, `size_bytes=${JSON.stringify(bad)} debe ir por básico`);
  }
});

Deno.test("(T-6) create_tus_upload_lanza_retorna_502_STREAM_UPLOAD_FAILED_sin_insertar", async () => {
  const registrar = registrar_ok();
  const deps = make_deps({
    streamUploadCreator: uploader_both({ tus_throws: true }),
    videoRegistrar: registrar,
  });
  const res = await handler(post_request_with_body(JSON.stringify({ size_bytes: SIZE_250MB })), deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error.code, "STREAM_UPLOAD_FAILED");
  assertEquals(registrar.calls.length, 0, "cero filas huérfanas");
});

Deno.test("(T-7) replace_true_y_size_bytes_juntos_corre_canceller_y_luego_tus", async () => {
  const canceller = canceller_ok();
  const uploader = uploader_both();
  const deps = make_deps({ pendingUploadCanceller: canceller, streamUploadCreator: uploader });
  const res = await handler(
    post_request_with_body(JSON.stringify({ replace: true, size_bytes: SIZE_250MB })),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(canceller.calls.length, 1, "replace sigue funcionando junto a size_bytes");
  assertEquals(uploader.tus_calls.length, 1);
});

Deno.test("(T-8) tus_con_concurrencia_activa_retorna_409_sin_llamar_a_stream", async () => {
  const uploader = uploader_both();
  const deps = make_deps({
    activeUploadChecker: checker_count({ [AGENT_UID]: 1 }),
    streamUploadCreator: uploader,
  });
  const res = await handler(post_request_with_body(JSON.stringify({ size_bytes: SIZE_250MB })), deps);
  assertEquals(res.status, 409);
  assertEquals(uploader.tus_calls.length, 0);
});
