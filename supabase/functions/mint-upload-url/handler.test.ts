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

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  ActiveUploadChecker,
  CallerVerifier,
  CallerVerifyResult,
  MintUploadUrlDeps,
  RegisterUploadingVideoParams,
  StreamDirectUploadParams,
  StreamDirectUploadResult,
  StreamUploadCreator,
  VideoRegistrar,
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
