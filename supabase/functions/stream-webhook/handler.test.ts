// supabase/functions/stream-webhook/handler.test.ts
// Tests RED — subtarea 68.5
// Edge Function: stream-webhook/handler.ts (webhook PÚBLICO de Cloudflare Stream —
// deploy --no-verify-jwt; el uid del video viaja en el payload, no en un JWT de Supabase).
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net --config supabase/functions/deno.json supabase/functions/stream-webhook/handler.test.ts
//
// SEAMS (interfaz bajo test):
// - Contrato público HTTP de make_stream_webhook_handler(deps) → (req) => Response:
//   request (headers + rawBody) → status + body JSON.
// - Verificación de firma HMAC (header Webhook-Signature) — NO se mockea: es el SUT de
//   seguridad. El HMAC se computa REAL en este archivo (crypto.subtle) con un
//   STREAM_WEBHOOK_SECRET conocido inyectado por deps.webhookSecret.
// - VideoStatusUpdater.mark_ready / mark_failed (DI, fake/spy) — frontera de escritura en
//   property_videos por cloudflare_uid; NUNCA DB real.
// - VideoEventNotifier.notify_video_event (DI, fake/spy) — frontera del gancho de push;
//   NUNCA envío real (eso es Ola 2).
//
// EDGE CASES (RED) — 68.5:
//
// ### Happy path
// - EC1: firma válida + state='ready' → mark_ready({ cloudflare_uid: uid, thumbnail_url })
//   con el thumbnail EXACTO del payload, notify_video_event('video_ready', uid) invocado,
//   200.
// - EC2: firma válida + state='error' → mark_failed({ cloudflare_uid: uid, failure_reason })
//   con el failure_reason EXACTO (errorReasonText del payload), notify_video_event
//   ('video_failed', uid) invocado, 200.
//
// ### Verificación de firma (frontera de seguridad — crypto real, sin mock)
// - EC3: firma inválida (sig1 alterado 1 char) → 401, sin UPDATE ni notify.
// - EC4: header Webhook-Signature ausente → 401, sin UPDATE ni notify.
// - EC5: header malformado sin 'time=' → 401.
// - EC6: header malformado sin 'sig1=' → 401.
// - EC7: header malformado ilegible (sin '=' ni ',') → 401.
// - EC8 (EC11 del contrato): firma computada sobre `${time}.${rawBody}` EXACTO — se firma
//   un body y se envía un body tamperado (1 byte distinto) con esos mismos headers →
//   401 (la firma NO debe validar contra un body distinto al firmado).
//
// ### Ramas de reglas no obvias (transición de estado)
// - EC9: firma válida pero state='inprogress' (ni ready ni error) → 200 no-op: NI mark_ready
//   NI mark_failed NI notify se invocan.
// - EC10: el UPDATE se hace SOLO con { cloudflare_uid, thumbnail_url } — sin property_id
//   (shape exacto de los argumentos que recibe el updater, verificado con el spy).
//
// ### Idempotencia / uid desconocido (boundary de negocio, nunca error)
// - EC11: re-entrega de 'ready' para un video YA ready — el updater (fake) devuelve 0 filas
//   afectadas → 200 igual, sin lanzar.
// - EC12: uid desconocido (0 filas afectadas) → 200 igual (evita reintentos de Cloudflare).
//
// ### Método HTTP
// - EC13: GET → 405 METHOD_NOT_ALLOWED.
//
// ### Boundary / error (parseo del payload)
// - EC14: firma válida pero body no es JSON válido → 400, sin UPDATE ni notify.
// - EC15: forma invariante de error: toda respuesta 401 sigue { error: { code, message } }.

import { assertEquals, assertNotEquals } from "@std/assert";
import { make_stream_webhook_handler } from "./handler.ts";
import type {
  MarkVideoFailedParams,
  MarkVideoReadyParams,
  StreamWebhookDeps,
  VideoEventNotifier,
  VideoNotifyEvent,
  VideoStatusUpdater,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test_stream_webhook_secret_68_5_no_es_el_real";
const STREAM_UID = "aaaaaaaabbbbccccdddd000000000001";

const READY_THUMBNAIL_URL =
  "https://videodelivery.net/aaaaaaaabbbbccccdddd000000000001/thumbnails/thumbnail.jpg";
const FAILURE_REASON_TEXT = "Video excede la duración máxima permitida";

const READY_PAYLOAD = JSON.stringify({
  uid: STREAM_UID,
  status: { state: "ready" },
  thumbnail: READY_THUMBNAIL_URL,
});

const ERROR_PAYLOAD = JSON.stringify({
  uid: STREAM_UID,
  status: {
    state: "error",
    errorReasonCode: "DURATION_LIMIT_EXCEEDED",
    errorReasonText: FAILURE_REASON_TEXT,
  },
});

const INPROGRESS_PAYLOAD = JSON.stringify({
  uid: STREAM_UID,
  status: { state: "inprogress", pctComplete: "42.000000" },
});

// ── Firma HMAC real (crypto.subtle de Deno) ──────────────────────────────────

async function hmac_sha256_hex(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign_body(
  raw_body: string,
  time = 1_753_000_000,
): Promise<{ header: string; time: number; sig1: string }> {
  const sig1 = await hmac_sha256_hex(WEBHOOK_SECRET, `${time}.${raw_body}`);
  return { header: `time=${time},sig1=${sig1}`, time, sig1 };
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function webhook_request(
  raw_body: string,
  signature_header: string | null,
  method = "POST",
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (signature_header !== null) headers["Webhook-Signature"] = signature_header;
  const has_body = method !== "GET" && method !== "HEAD";
  return new Request("http://localhost/stream-webhook", {
    method,
    headers,
    ...(has_body ? { body: raw_body } : {}),
  });
}

// ── Fakes — VideoStatusUpdater ────────────────────────────────────────────────

interface FakeVideoStatusUpdater extends VideoStatusUpdater {
  ready_calls: MarkVideoReadyParams[];
  failed_calls: MarkVideoFailedParams[];
}

function updater_ok(affected_rows = 1): FakeVideoStatusUpdater {
  return {
    ready_calls: [],
    failed_calls: [],
    mark_ready(params: MarkVideoReadyParams): Promise<number> {
      this.ready_calls.push(params);
      return Promise.resolve(affected_rows);
    },
    mark_failed(params: MarkVideoFailedParams): Promise<number> {
      this.failed_calls.push(params);
      return Promise.resolve(affected_rows);
    },
  } as FakeVideoStatusUpdater;
}

// ── Fakes — VideoEventNotifier ─────────────────────────────────────────────────

interface FakeVideoEventNotifier extends VideoEventNotifier {
  calls: Array<{ event: VideoNotifyEvent; cloudflare_uid: string }>;
}

function notifier_ok(): FakeVideoEventNotifier {
  return {
    calls: [],
    notify_video_event(event: VideoNotifyEvent, cloudflare_uid: string): Promise<void> {
      this.calls.push({ event, cloudflare_uid });
      return Promise.resolve();
    },
  } as FakeVideoEventNotifier;
}

// ── Deps helper ───────────────────────────────────────────────────────────────

function make_deps(overrides: Partial<StreamWebhookDeps> = {}): StreamWebhookDeps {
  return {
    webhookSecret: WEBHOOK_SECRET,
    videoStatusUpdater: updater_ok(),
    notifier: notifier_ok(),
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("firma_valida_state_ready_marca_ready_con_thumbnail_y_notifica_200", async () => {
  const { header } = await sign_body(READY_PAYLOAD);
  const updater = updater_ok();
  const notifier = notifier_ok();
  const deps = make_deps({ videoStatusUpdater: updater, notifier });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, header));

  assertEquals(res.status, 200);
  assertEquals(updater.ready_calls.length, 1, "mark_ready debe invocarse exactamente una vez");
  assertEquals(updater.ready_calls[0], {
    cloudflare_uid: STREAM_UID,
    thumbnail_url: READY_THUMBNAIL_URL,
  });
  assertEquals(updater.failed_calls.length, 0, "mark_failed NO debe invocarse en el camino ready");
  assertEquals(notifier.calls.length, 1, "el gancho de notificación debe invocarse una vez");
  assertEquals(notifier.calls[0], { event: "video_ready", cloudflare_uid: STREAM_UID });
});

Deno.test("firma_valida_state_error_marca_failed_con_failure_reason_y_notifica_200", async () => {
  const { header } = await sign_body(ERROR_PAYLOAD);
  const updater = updater_ok();
  const notifier = notifier_ok();
  const deps = make_deps({ videoStatusUpdater: updater, notifier });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(ERROR_PAYLOAD, header));

  assertEquals(res.status, 200);
  assertEquals(updater.failed_calls.length, 1, "mark_failed debe invocarse exactamente una vez");
  assertEquals(updater.failed_calls[0], {
    cloudflare_uid: STREAM_UID,
    failure_reason: FAILURE_REASON_TEXT,
  });
  assertEquals(updater.ready_calls.length, 0, "mark_ready NO debe invocarse en el camino error");
  assertEquals(notifier.calls.length, 1);
  assertEquals(notifier.calls[0], { event: "video_failed", cloudflare_uid: STREAM_UID });
});

// ── Verificación de firma (crypto real, sin mock) ────────────────────────────

Deno.test("firma_sig1_alterada_retorna_401_sin_update_ni_notify", async () => {
  const { header, sig1 } = await sign_body(READY_PAYLOAD);
  const tampered_sig1 = (sig1[0] === "a" ? "b" : "a") + sig1.slice(1);
  const tampered_header = header.replace(sig1, tampered_sig1);
  const updater = updater_ok();
  const notifier = notifier_ok();
  const deps = make_deps({ videoStatusUpdater: updater, notifier });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, tampered_header));

  assertEquals(res.status, 401);
  assertEquals(updater.ready_calls.length, 0);
  assertEquals(notifier.calls.length, 0);
});

Deno.test("header_webhook_signature_ausente_retorna_401_sin_update", async () => {
  const updater = updater_ok();
  const deps = make_deps({ videoStatusUpdater: updater });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, null));

  assertEquals(res.status, 401);
  assertEquals(updater.ready_calls.length, 0);
});

Deno.test("header_malformado_sin_time_retorna_401", async () => {
  const { sig1 } = await sign_body(READY_PAYLOAD);
  const deps = make_deps();
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, `sig1=${sig1}`));

  assertEquals(res.status, 401);
});

Deno.test("header_malformado_sin_sig1_retorna_401", async () => {
  const { time } = await sign_body(READY_PAYLOAD);
  const deps = make_deps();
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, `time=${time}`));

  assertEquals(res.status, 401);
});

Deno.test("header_malformado_ilegible_retorna_401", async () => {
  const deps = make_deps();
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, "esto-no-es-un-header-valido"));

  assertEquals(res.status, 401);
});

Deno.test("firma_valida_para_body_A_no_valida_si_se_envia_body_tamperado", async () => {
  // La firma se computa sobre `${time}.${rawBody}` EXACTO: si el body cambia 1 byte tras
  // firmarlo, la verificación debe fallar aunque el header de firma sea el correcto para
  // el body ORIGINAL.
  const { header } = await sign_body(READY_PAYLOAD);
  const tampered_body = READY_PAYLOAD.replace('"state":"ready"', '"state":"ready" ');
  assertNotEquals(tampered_body, READY_PAYLOAD, "el body tamperado debe diferir en al menos 1 byte");
  const updater = updater_ok();
  const deps = make_deps({ videoStatusUpdater: updater });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(tampered_body, header));

  assertEquals(res.status, 401);
  assertEquals(updater.ready_calls.length, 0);
});

// ── Ramas de reglas no obvias (transición de estado) ─────────────────────────

Deno.test("firma_valida_state_inprogress_no_actualiza_ni_notifica_200", async () => {
  const { header } = await sign_body(INPROGRESS_PAYLOAD);
  const updater = updater_ok();
  const notifier = notifier_ok();
  const deps = make_deps({ videoStatusUpdater: updater, notifier });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(INPROGRESS_PAYLOAD, header));

  assertEquals(res.status, 200);
  assertEquals(updater.ready_calls.length, 0, "state inprogress no debe marcar ready");
  assertEquals(updater.failed_calls.length, 0, "state inprogress no debe marcar failed");
  assertEquals(notifier.calls.length, 0, "state inprogress no debe disparar el gancho de notificación");
});

Deno.test("mark_ready_recibe_solo_cloudflare_uid_y_thumbnail_url_sin_property_id", async () => {
  const { header } = await sign_body(READY_PAYLOAD);
  const updater = updater_ok();
  const deps = make_deps({ videoStatusUpdater: updater });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(READY_PAYLOAD, header));

  assertEquals(
    Object.keys(updater.ready_calls[0]).sort(),
    ["cloudflare_uid", "thumbnail_url"],
    "el updater debe filtrar SOLO por cloudflare_uid; nunca por property_id",
  );
});

// ── Idempotencia / uid desconocido (nunca error) ─────────────────────────────

Deno.test("reentrega_ready_de_video_ya_ready_con_0_filas_afectadas_retorna_200", async () => {
  const { header } = await sign_body(READY_PAYLOAD);
  const updater = updater_ok(0); // 0 filas afectadas: ya estaba en 'ready'
  const deps = make_deps({ videoStatusUpdater: updater });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, header));

  assertEquals(res.status, 200, "la re-entrega idempotente no debe fallar");
});

Deno.test("uid_desconocido_con_0_filas_afectadas_retorna_200", async () => {
  const { header } = await sign_body(ERROR_PAYLOAD);
  const updater = updater_ok(0); // 0 filas afectadas: cloudflare_uid no existe en property_videos
  const deps = make_deps({ videoStatusUpdater: updater });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(ERROR_PAYLOAD, header));

  assertEquals(res.status, 200, "un uid desconocido no debe generar error (evita reintentos de Cloudflare)");
});

// ── Método HTTP ───────────────────────────────────────────────────────────────

Deno.test("metodo_get_retorna_405", async () => {
  const deps = make_deps();
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, null, "GET"));

  assertEquals(res.status, 405);
});

// ── Boundary / error (parseo del payload) ────────────────────────────────────

Deno.test("firma_valida_pero_body_no_es_json_retorna_400_sin_update_ni_notify", async () => {
  const raw_body = "esto no es json";
  const { header } = await sign_body(raw_body);
  const updater = updater_ok();
  const notifier = notifier_ok();
  const deps = make_deps({ videoStatusUpdater: updater, notifier });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(raw_body, header));

  assertEquals(res.status, 400);
  assertEquals(updater.ready_calls.length, 0);
  assertEquals(updater.failed_calls.length, 0);
  assertEquals(notifier.calls.length, 0);
});

// ── Forma invariante de errores ────────────────────────────────────────────────

Deno.test("error_401_sigue_forma_error_code_message", async () => {
  const deps = make_deps();
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(READY_PAYLOAD, null));

  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
