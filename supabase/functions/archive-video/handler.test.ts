// supabase/functions/archive-video/handler.test.ts
// Tests RED — subtarea 68.8 (Superficie B)
// Edge Function: archive-video/handler.ts (Cloudflare Stream → Cloudflare R2 cold-store,
// modelo síncrono con backoff corto, ORDERING SEGURO: R2 confirmado ANTES de borrar Stream).
// Framework: Deno.test + @std/assert
// Runner: cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//         --config deno.json archive-video/handler.test.ts
//
// SEAMS (interfaz bajo test):
// - Contrato público HTTP del handler(req, deps?): request → status + body JSON.
// - CallerVerifier.verify_caller (DI, fake) — frontera JWT + rol (agent/admin).
// - VideoLoader.load (DI, fake) — frontera de lectura en DB; NUNCA DB real.
// - StreamArchiver.{enable_download,fetch_mp4,delete_video} (DI, fake) — frontera de red
//   con Cloudflare Stream; NUNCA red real.
// - ArchiveUploader.upload (DI, fake) — frontera de red con Cloudflare R2; NUNCA red real.
// - VideoArchiver.mark_archived (DI, fake) — frontera de escritura en DB; NUNCA DB real.
// - Sleep (DI, fake) — frontera de tiempo; NUNCA espera real (el fake resuelve al toque
//   y solo registra el delay pedido).
//
// EDGE CASES (RED) — 68.8:
//
// ### Happy path (ready inmediato, sin backoff)
// - enable_download se llama con el cloudflare_uid del video cargado
// - ORDEN de llamadas es el contrato central: archiveUploader.upload ANTES de
//   streamArchiver.delete_video ANTES de videoArchiver.mark_archived (spy de orden)
// - archiveUploader.upload recibe key = 'archive/<cloudflare_uid>.mp4' (convención) y los
//   bytes exactos que devolvió fetch_mp4
// - videoArchiver.mark_archived recibe { property_video_id, r2_archive_key } exactos
// - 200 con body { archived: true, r2_archive_key } exacto
//
// ### Backoff corto (síncrono, sleep inyectable — nunca espera real)
// - state='inprogress' 2 veces y luego 'ready': enable_download llamado 3 veces, sleep
//   llamado con los delays exactos [1000, 2000] (backoff exponencial x2, arranca en 1000ms)
// - backoff agotado (siempre 'inprogress'): 202, enable_download llamado EXACTAMENTE 6 veces,
//   sleep llamado EXACTAMENTE 5 veces con delays [1000,2000,4000,5000,5000] (cap en 5000ms,
//   suma acumulada llega a 15000ms = ARCHIVE_BACKOFF_MAX_TOTAL_MS)
// - backoff agotado: streamArchiver.delete_video NO se llama, videoArchiver.mark_archived NO
//   se llama (status en DB queda intacto — idempotente: una re-invocación reintenta)
//
// ### Fail-closed R2 (el test más importante — invariante anti-pérdida-de-datos)
// - archiveUploader.upload lanza (PUT no-2xx) → 502 R2_UPLOAD_FAILED
// - archiveUploader.upload lanza → streamArchiver.delete_video NO se llama Y
//   videoArchiver.mark_archived NO se llama (Stream intacto, feed intacto, cero pérdida)
//
// ### Fallo de descarga del MP4 (mismo principio fail-closed, simétrico a R2)
// - streamArchiver.fetch_mp4 lanza → 502 STREAM_DOWNLOAD_FAILED, sin tocar R2 (upload NO se
//   llama) ni Stream.delete ni mark_archived
//
// ### Fallo de Stream.delete DESPUÉS de que R2 ya confirmó (decisión de diseño)
// - streamArchiver.delete_video lanza tras un upload a R2 exitoso → la copia en R2 YA es el
//   punto de no-retorno: el handler marca 'archived' de todos modos (los datos están a salvo;
//   el borrado de Stream se reintenta aparte) y responde 200 igual
//
// ### Video inexistente / sin referencia / status no archivable
// - property_video_id que VideoLoader no encuentra → 404 VIDEO_NOT_FOUND
// - video sin cloudflare_uid (defensivo) → 422 VIDEO_MISSING_CLOUDFLARE_UID
// - video en status 'uploading' → 409 VIDEO_STATUS_NOT_ARCHIVABLE
// - video en status 'processing' → 409 VIDEO_STATUS_NOT_ARCHIVABLE
// - video YA 'archived' (idempotencia decidida como conflicto, no no-op) → 409
//   VIDEO_STATUS_NOT_ARCHIVABLE
//
// ### Auth y autorización (frontera de confianza, fail-closed)
// - sin header Authorization → 401 UNAUTHENTICATED
// - rol 'user' (ni agente ni admin) → 403 FORBIDDEN
// - agente autenticado que NO es el dueño (agent_id) ni admin → 403 FORBIDDEN_NOT_OWNER
// - admin puede archivar el video de OTRO agente → 200 (bypass de ownership por rol)
//
// ### Método HTTP / CORS / body
// - GET → 405 METHOD_NOT_ALLOWED
// - OPTIONS → 200-204 con header Access-Control-Allow-Origin
// - body no-JSON → 400 INVALID_INPUT
// - property_video_id ausente → 400 INVALID_INPUT
// - property_video_id vacío ('' o solo espacios) → 400 INVALID_INPUT
//
// ### Boundary
// - deps undefined → 500 INTERNAL_ERROR (nunca propagar excepción cruda)
//
// ### Forma invariante de errores
// - toda respuesta de error sigue { error: { code: string, message: string } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  ArchivableVideoRow,
  ArchiveUploadResult,
  ArchiveUploader,
  ArchiveVideoDeps,
  CallerVerifier,
  CallerVerifyResult,
  EnableDownloadResult,
  MarkArchivedParams,
  StreamArchiver,
  VideoArchiver,
  VideoLoader,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENT_UID = "00000000-0000-0000-0000-0000000000a1"; // dueño del video
const OTHER_AGENT_UID = "00000000-0000-0000-0000-0000000000a2"; // NO dueño, NO admin
const ADMIN_UID = "00000000-0000-0000-0000-0000000000ad";
const VIDEO_ID = "00000000-0000-0000-0000-0000000000f1";
const CF_UID = "cfuid-archive-001";
const ARCHIVE_KEY = "archive/cfuid-archive-001.mp4";
const MP4_URL = "https://videodelivery.net/cfuid-archive-001/downloads/default.mp4";
const MP4_BYTES = new Uint8Array([1, 2, 3, 4]);

function video_row(overrides: Partial<ArchivableVideoRow> = {}): ArchivableVideoRow {
  return {
    id: VIDEO_ID,
    agent_id: AGENT_UID,
    cloudflare_uid: CF_UID,
    status: "ready",
    ...overrides,
  };
}

// ── Fakes — CallerVerifier ───────────────────────────────────────────────────

function caller_ok(user_id: string, role: "agent" | "admin"): CallerVerifier {
  return {
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      return Promise.resolve({ ok: true, user_id, role });
    },
  };
}

function caller_unauthenticated(): CallerVerifier {
  return {
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  };
}

function caller_forbidden(): CallerVerifier {
  return {
    verify_caller(_authHeader: string | null): Promise<CallerVerifyResult> {
      return Promise.resolve({ ok: false, error_code: "FORBIDDEN" });
    },
  };
}

// ── Fakes — VideoLoader ───────────────────────────────────────────────────────

interface FakeVideoLoader extends VideoLoader {
  calls: string[];
}

function loader_returns(row: ArchivableVideoRow | null): FakeVideoLoader {
  return {
    calls: [],
    load(property_video_id: string): Promise<ArchivableVideoRow | null> {
      this.calls.push(property_video_id);
      return Promise.resolve(row);
    },
  } as FakeVideoLoader;
}

// ── Fakes — StreamArchiver ────────────────────────────────────────────────────

interface FakeStreamArchiver extends StreamArchiver {
  enable_download_calls: string[];
  fetch_mp4_calls: string[];
  delete_video_calls: string[];
}

/** enable_download responde 'ready' de inmediato con MP4_URL. */
function stream_archiver_ready_immediately(
  opts: { fetch_throws?: boolean; delete_throws?: boolean; order_log?: string[] } = {},
): FakeStreamArchiver {
  return {
    enable_download_calls: [],
    fetch_mp4_calls: [],
    delete_video_calls: [],
    enable_download(cloudflare_uid: string): Promise<EnableDownloadResult> {
      this.enable_download_calls.push(cloudflare_uid);
      return Promise.resolve({ state: "ready", url: MP4_URL, percentComplete: 100 });
    },
    fetch_mp4(url: string): Promise<Uint8Array> {
      this.fetch_mp4_calls.push(url);
      if (opts.fetch_throws) {
        return Promise.reject(new Error("descarga del mp4 falló"));
      }
      return Promise.resolve(MP4_BYTES);
    },
    delete_video(cloudflare_uid: string): Promise<void> {
      this.delete_video_calls.push(cloudflare_uid);
      if (opts.delete_throws) {
        return Promise.reject(new Error("stream delete falló"));
      }
      opts.order_log?.push("stream_delete");
      return Promise.resolve();
    },
  } as FakeStreamArchiver;
}

/** enable_download responde 'inprogress' N veces y luego 'ready'. */
function stream_archiver_inprogress_then_ready(times_inprogress: number): FakeStreamArchiver {
  let calls_made = 0;
  return {
    enable_download_calls: [],
    fetch_mp4_calls: [],
    delete_video_calls: [],
    enable_download(cloudflare_uid: string): Promise<EnableDownloadResult> {
      this.enable_download_calls.push(cloudflare_uid);
      calls_made++;
      if (calls_made <= times_inprogress) {
        return Promise.resolve({ state: "inprogress", percentComplete: 10 * calls_made });
      }
      return Promise.resolve({ state: "ready", url: MP4_URL, percentComplete: 100 });
    },
    fetch_mp4(url: string): Promise<Uint8Array> {
      this.fetch_mp4_calls.push(url);
      return Promise.resolve(MP4_BYTES);
    },
    delete_video(cloudflare_uid: string): Promise<void> {
      this.delete_video_calls.push(cloudflare_uid);
      return Promise.resolve();
    },
  } as FakeStreamArchiver;
}

/** enable_download SIEMPRE responde 'inprogress' (backoff nunca resuelve). */
function stream_archiver_always_inprogress(): FakeStreamArchiver {
  return {
    enable_download_calls: [],
    fetch_mp4_calls: [],
    delete_video_calls: [],
    enable_download(cloudflare_uid: string): Promise<EnableDownloadResult> {
      this.enable_download_calls.push(cloudflare_uid);
      return Promise.resolve({ state: "inprogress", percentComplete: 5 });
    },
    fetch_mp4(url: string): Promise<Uint8Array> {
      this.fetch_mp4_calls.push(url);
      return Promise.resolve(MP4_BYTES);
    },
    delete_video(cloudflare_uid: string): Promise<void> {
      this.delete_video_calls.push(cloudflare_uid);
      return Promise.resolve();
    },
  } as FakeStreamArchiver;
}

// ── Fakes — ArchiveUploader ───────────────────────────────────────────────────

interface FakeArchiveUploader extends ArchiveUploader {
  calls: Array<{ key: string; body: Uint8Array }>;
}

function uploader_ok(order_log?: string[]): FakeArchiveUploader {
  return {
    calls: [],
    upload(key: string, body: Uint8Array): Promise<ArchiveUploadResult> {
      this.calls.push({ key, body });
      order_log?.push("r2_put");
      return Promise.resolve({ ok: true, key });
    },
  } as FakeArchiveUploader;
}

function uploader_throws(): FakeArchiveUploader {
  return {
    calls: [],
    upload(key: string, body: Uint8Array): Promise<ArchiveUploadResult> {
      this.calls.push({ key, body });
      return Promise.reject(new Error("PUT a R2 falló (no-2xx)"));
    },
  } as FakeArchiveUploader;
}

// ── Fakes — VideoArchiver ─────────────────────────────────────────────────────

interface FakeVideoArchiver extends VideoArchiver {
  calls: MarkArchivedParams[];
}

function archiver_ok(order_log?: string[]): FakeVideoArchiver {
  return {
    calls: [],
    mark_archived(params: MarkArchivedParams): Promise<void> {
      this.calls.push(params);
      order_log?.push("mark_archived");
      return Promise.resolve();
    },
  } as FakeVideoArchiver;
}

// ── Fake — Sleep ──────────────────────────────────────────────────────────────

interface FakeSleep {
  fn: (ms: number) => Promise<void>;
  delays: number[];
}

function fake_sleep(): FakeSleep {
  const delays: number[] = [];
  return {
    delays,
    fn(ms: number): Promise<void> {
      delays.push(ms);
      return Promise.resolve(); // nunca espera de verdad
    },
  };
}

// ── Helpers de Request/Deps ───────────────────────────────────────────────────

function post_request(
  body: unknown = { property_video_id: VIDEO_ID },
  with_auth = true,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/archive-video", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function raw_body_request(raw: string, with_auth = true): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/archive-video", { method: "POST", headers, body: raw });
}

function method_request(method: string): Request {
  return new Request("http://localhost/archive-video", {
    method,
    headers: { Authorization: "Bearer fake.jwt.token" },
  });
}

function make_deps(overrides: Partial<ArchiveVideoDeps> = {}): ArchiveVideoDeps {
  const sleep = fake_sleep();
  return {
    callerVerifier: caller_ok(AGENT_UID, "agent"),
    videoLoader: loader_returns(video_row()),
    streamArchiver: stream_archiver_ready_immediately(),
    archiveUploader: uploader_ok(),
    videoArchiver: archiver_ok(),
    sleep: sleep.fn,
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_enable_download_se_llama_con_el_cloudflare_uid_del_video", async () => {
  const stream = stream_archiver_ready_immediately();
  const deps = make_deps({ streamArchiver: stream });
  await handler(post_request(), deps);
  assertEquals(stream.enable_download_calls, [CF_UID]);
});

Deno.test("happy_path_orden_r2_put_antes_de_stream_delete_antes_de_mark_archived", async () => {
  const order: string[] = [];
  const stream = stream_archiver_ready_immediately({ order_log: order });
  const uploader = uploader_ok(order);
  const archiver = archiver_ok(order);
  const deps = make_deps({ streamArchiver: stream, archiveUploader: uploader, videoArchiver: archiver });
  await handler(post_request(), deps);
  assertEquals(
    order,
    ["r2_put", "stream_delete", "mark_archived"],
    "el orden de efectos de lado debe ser: R2 confirmado -> borrar de Stream -> marcar archived en DB",
  );
});

Deno.test("happy_path_sube_a_r2_con_key_convencion_y_bytes_exactos_de_fetch_mp4", async () => {
  const uploader = uploader_ok();
  const deps = make_deps({ archiveUploader: uploader });
  await handler(post_request(), deps);
  assertEquals(uploader.calls.length, 1);
  assertEquals(uploader.calls[0].key, ARCHIVE_KEY, "archive_key debe ser 'archive/<cloudflare_uid>.mp4'");
  assertEquals(uploader.calls[0].body, MP4_BYTES, "el body subido a R2 debe ser exactamente lo que devolvió fetch_mp4");
});

Deno.test("happy_path_mark_archived_recibe_property_video_id_y_r2_archive_key_exactos", async () => {
  const archiver = archiver_ok();
  const deps = make_deps({ videoArchiver: archiver });
  await handler(post_request(), deps);
  assertEquals(archiver.calls.length, 1);
  assertEquals(archiver.calls[0], { property_video_id: VIDEO_ID, r2_archive_key: ARCHIVE_KEY });
});

Deno.test("happy_path_responde_200_con_archived_true_y_r2_archive_key", async () => {
  const res = await handler(post_request(), make_deps());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { archived: true, r2_archive_key: ARCHIVE_KEY });
});

// ── Backoff corto (sleep inyectable, nunca espera real) ──────────────────────

Deno.test("backoff_reconsulta_enable_download_hasta_ready_con_delays_exactos_1000_2000", async () => {
  const stream = stream_archiver_inprogress_then_ready(2);
  const sleep = fake_sleep();
  const deps = make_deps({ streamArchiver: stream, sleep: sleep.fn });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "tras el backoff debe completarse con éxito");
  assertEquals(stream.enable_download_calls.length, 3, "2 inprogress + 1 ready = 3 llamadas");
  assertEquals(sleep.delays, [1000, 2000], "backoff exponencial x2 arrancando en 1000ms");
});

Deno.test("backoff_agotado_responde_202_con_enable_download_6_veces_y_sleep_5_veces", async () => {
  const stream = stream_archiver_always_inprogress();
  const sleep = fake_sleep();
  const deps = make_deps({ streamArchiver: stream, sleep: sleep.fn });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 202, "backoff agotado sin ver 'ready' debe responder 202 (retry later)");
  assertEquals(stream.enable_download_calls.length, 6, "tope de reintentos: 6 llamadas a enable_download");
  assertEquals(
    sleep.delays,
    [1000, 2000, 4000, 5000, 5000],
    "delays acumulados (1000+2000+4000+5000+5000=17000 >= 15000ms) agotan el backoff",
  );
});

Deno.test("backoff_agotado_no_llama_stream_delete_ni_mark_archived_status_intacto", async () => {
  const stream = stream_archiver_always_inprogress();
  const uploader = uploader_ok();
  const archiver = archiver_ok();
  const deps = make_deps({ streamArchiver: stream, archiveUploader: uploader, videoArchiver: archiver, sleep: fake_sleep().fn });
  await handler(post_request(), deps);
  assertEquals(stream.delete_video_calls.length, 0, "backoff agotado no debe borrar el video de Stream");
  assertEquals(uploader.calls.length, 0, "backoff agotado no debe intentar subir a R2 (nunca hubo mp4 que descargar)");
  assertEquals(archiver.calls.length, 0, "backoff agotado no debe marcar 'archived' en DB (idempotente: reintentable)");
});

// ── Fail-closed R2 (invariante anti-pérdida-de-datos) ─────────────────────────

Deno.test("r2_falla_responde_502_r2_upload_failed", async () => {
  const deps = make_deps({ archiveUploader: uploader_throws() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error.code, "R2_UPLOAD_FAILED");
});

Deno.test("r2_falla_no_borra_de_stream_ni_marca_archived_invariante_anti_perdida", async () => {
  const stream = stream_archiver_ready_immediately();
  const archiver = archiver_ok();
  const deps = make_deps({ streamArchiver: stream, archiveUploader: uploader_throws(), videoArchiver: archiver });
  await handler(post_request(), deps);
  assertEquals(stream.delete_video_calls.length, 0, "si R2 falla NUNCA se borra el video de Stream (fail-closed)");
  assertEquals(archiver.calls.length, 0, "si R2 falla NUNCA se marca 'archived' (evita pérdida de datos)");
});

// ── Fallo de descarga del MP4 (simétrico a R2) ────────────────────────────────

Deno.test("fetch_mp4_falla_responde_502_stream_download_failed_sin_tocar_r2_ni_stream", async () => {
  const stream = stream_archiver_ready_immediately({ fetch_throws: true });
  const uploader = uploader_ok();
  const archiver = archiver_ok();
  const deps = make_deps({ streamArchiver: stream, archiveUploader: uploader, videoArchiver: archiver });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 502);
  const body = await res.json();
  assertEquals(body.error.code, "STREAM_DOWNLOAD_FAILED");
  assertEquals(uploader.calls.length, 0, "si la descarga del mp4 falla no debe intentarse el PUT a R2");
  assertEquals(stream.delete_video_calls.length, 0);
  assertEquals(archiver.calls.length, 0);
});

// ── Fallo de Stream.delete DESPUÉS de que R2 ya confirmó (decisión de diseño) ─

Deno.test("stream_delete_falla_tras_r2_ok_marca_archived_igual_y_responde_200", async () => {
  const stream = stream_archiver_ready_immediately({ delete_throws: true });
  const archiver = archiver_ok();
  const deps = make_deps({ streamArchiver: stream, videoArchiver: archiver });
  const res = await handler(post_request(), deps);
  assertEquals(
    res.status,
    200,
    "la copia en R2 ya es el punto de no-retorno: un fallo al borrar de Stream no debe impedir marcar archived",
  );
  assertEquals(archiver.calls.length, 1, "mark_archived debe llamarse aunque delete_video haya lanzado");
  assertEquals(archiver.calls[0], { property_video_id: VIDEO_ID, r2_archive_key: ARCHIVE_KEY });
});

// ── Video inexistente / sin referencia / status no archivable ─────────────────

Deno.test("video_inexistente_responde_404_video_not_found", async () => {
  const deps = make_deps({ videoLoader: loader_returns(null) });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_NOT_FOUND");
});

Deno.test("video_sin_cloudflare_uid_responde_422_video_missing_cloudflare_uid", async () => {
  const deps = make_deps({
    videoLoader: loader_returns(video_row({ cloudflare_uid: null })),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_MISSING_CLOUDFLARE_UID");
});

Deno.test("video_en_uploading_responde_409_video_status_not_archivable", async () => {
  const deps = make_deps({ videoLoader: loader_returns(video_row({ status: "uploading" })) });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_STATUS_NOT_ARCHIVABLE");
});

Deno.test("video_en_processing_responde_409_video_status_not_archivable", async () => {
  const deps = make_deps({ videoLoader: loader_returns(video_row({ status: "processing" })) });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_STATUS_NOT_ARCHIVABLE");
});

Deno.test("video_ya_archived_responde_409_video_status_not_archivable_idempotencia", async () => {
  // Decisión de diseño: re-archivar un video YA archived es un CONFLICTO (409), no un no-op 200.
  const deps = make_deps({ videoLoader: loader_returns(video_row({ status: "archived" })) });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_STATUS_NOT_ARCHIVABLE");
});

// ── Auth y autorización (frontera de confianza, fail-closed) ─────────────────

Deno.test("sin_authorization_header_responde_401_unauthenticated", async () => {
  const res = await handler(post_request(undefined, false), make_deps());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("rol_user_no_permitido_responde_403_forbidden", async () => {
  const deps = make_deps({ callerVerifier: caller_forbidden() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("agente_no_dueño_ni_admin_responde_403_forbidden_not_owner", async () => {
  const deps = make_deps({
    callerVerifier: caller_ok(OTHER_AGENT_UID, "agent"),
    videoLoader: loader_returns(video_row({ agent_id: AGENT_UID })),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN_NOT_OWNER");
});

Deno.test("admin_puede_archivar_video_de_otro_agente_responde_200", async () => {
  const deps = make_deps({
    callerVerifier: caller_ok(ADMIN_UID, "admin"),
    videoLoader: loader_returns(video_row({ agent_id: AGENT_UID })),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "un admin puede archivar el video de cualquier agente");
});

// ── Método HTTP / CORS / body ─────────────────────────────────────────────────

Deno.test("metodo_get_responde_405_method_not_allowed", async () => {
  const res = await handler(method_request("GET"), make_deps());
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error.code, "METHOD_NOT_ALLOWED");
});

Deno.test("cors_options_preflight_responde_200_con_access_control_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status >= 200 && res.status <= 204, true, "OPTIONS debe retornar 200-204");
  assertExists(res.headers.get("Access-Control-Allow-Origin"), "preflight debe incluir el header CORS");
});

Deno.test("body_no_json_responde_400_invalid_input", async () => {
  const res = await handler(raw_body_request("esto no es json"), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_video_id_ausente_responde_400_invalid_input", async () => {
  const res = await handler(post_request({}), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_video_id_vacio_responde_400_invalid_input", async () => {
  const res = await handler(post_request({ property_video_id: "   " }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Boundary ──────────────────────────────────────────────────────────────────

Deno.test("deps_undefined_responde_500_internal_error", async () => {
  const res = await handler(post_request());
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

// ── Forma invariante de errores ────────────────────────────────────────────────

Deno.test("error_respuesta_sigue_forma_error_code_message", async () => {
  const res = await handler(post_request(undefined, false), make_deps());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error, "respuesta de error debe tener campo 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});
