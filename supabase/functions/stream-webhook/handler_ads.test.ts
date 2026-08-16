// supabase/functions/stream-webhook/handler_ads.test.ts
// Tests RED — subtarea 169.5 (rama de anuncios, extensión ADITIVA de stream-webhook)
// Edge Function: stream-webhook/handler.ts — MISMO handler que handler.test.ts (68.5),
// archivo APARTE a propósito: handler.test.ts (68.5) NO SE MODIFICA (gate de
// aceptación de 169.5 — ver bitácora de la subtarea).
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net --config supabase/functions/deno.json supabase/functions/stream-webhook/handler_ads.test.ts
//
// SEAMS (interfaz bajo test):
// - El MISMO contrato público HTTP de make_stream_webhook_handler(deps) → (req) => Response
//   que 68.5 (sin cambios); estos tests solo ejercitan la rama NUEVA.
// - AdCreativeStatusUpdater.mark_ready / mark_failed (DI, fake/spy) — frontera de
//   escritura en ad_creatives por cloudflare_uid; NUNCA DB real. Inyectada vía
//   StreamWebhookDeps.adCreativeStatusUpdater (OPCIONAL — su ausencia debe
//   preservar el comportamiento pre-169.5 exacto).
// - VideoStatusUpdater.mark_ready/mark_failed (fake) — se reusa para simular "0 filas
//   afectadas" (uid no pertenece a property_videos), la puerta de entrada documentada
//   de la rama aditiva (handler.ts:99-100: 0 filas ⇒ 200 idempotente, comportamiento
//   YA existente antes de esta subtarea).
//
// EDGE CASES (RED) — 169.5:
//
// ### Aditividad — el test más importante de la subtarea
// - EC1: property_videos afecta 1 fila (video de propiedad real) → aunque
//   adCreativeStatusUpdater esté inyectado, JAMÁS se le llama (ni mark_ready ni
//   mark_failed). Por construcción, un cloudflare_uid de propiedad nunca llega a la
//   rama de anuncios.
//
// ### Happy path — duración válida al pasar a 'ready'
// - EC2: property afecta 0 filas + duration=6 (límite MÍNIMO inclusive) → ad
//   updater.mark_ready con { cloudflare_uid, thumbnail_url, duration_seconds:6 }
//   EXACTO; mark_failed NO se llama.
// - EC3: property afecta 0 filas + duration=30 (límite MÁXIMO inclusive, el mismo
//   que Stream ya capó en mint-ad-upload-url) → mark_ready con duration_seconds:30.
// - EC4: duration fraccional dentro de rango (29.9) se pasa INTACTA a mark_ready —
//   sin redondear (regla no obvia: el handler no transforma el valor reportado).
//
// ### AD_DURATION_INVALID — código propio (R2 de la tarea 169)
// - EC5: duration=5 (por debajo del mínimo 6) → mark_failed con { cloudflare_uid,
//   reason_code: AD_DURATION_INVALID }; mark_ready NO se llama.
// - EC6: duration AUSENTE en el payload 'ready' (Stream no la reportó) →
//   fail-closed: mark_failed con reason_code AD_DURATION_INVALID (sin duración no
//   se puede verificar el mínimo de 6 s).
// - EC7: duration=31 (por encima del máximo 30 — defensa en profundidad, aunque
//   Stream ya lo capa en el mint) → mark_failed con reason_code AD_DURATION_INVALID.
//
// ### state='error' de Stream — delega al mismo failure_reason que property_videos
// - EC8: property afecta 0 filas + state='error' → ad updater.mark_failed con
//   { cloudflare_uid, reason_code: <errorReasonText EXACTO del payload> }; mark_ready
//   NO se llama.
//
// ### uid genuinamente desconocido a ambas tablas (nunca lanza)
// - EC9: property afecta 0 Y ad_creatives updater también afecta 0 (uid no existe en
//   ninguna tabla) → 200, sin lanzar.
//
// ### Retrocompatibilidad — ausencia del dep nuevo (168.5 preservado)
// - EC10: adCreativeStatusUpdater AUSENTE (undefined) de StreamWebhookDeps + property
//   afecta 0 filas → 200, sin lanzar (mismo comportamiento que handler.test.ts EC11/EC12
//   antes de que existiera esta subtarea).
//
// ### Shape exacto de los argumentos (mutante de cross-contaminación)
// - EC11: mark_ready de ad_creatives recibe SOLO { cloudflare_uid, duration_seconds,
//   thumbnail_url } — nunca property_id/agent_id/status.
// - EC12: mark_failed de ad_creatives (rama duración inválida) recibe SOLO
//   { cloudflare_uid, reason_code } — nunca property_id/agent_id.
//
// ── Ronda 2 (guardián FAIL, 2026-08-16): 3 huecos ────────────────────────────
//
// ### Candado del invariante de orden — mutante "e2" del guardián: validar el
// valor REDONDEADO pero persistir/decidir con el CRUDO (o viceversa). Ninguna
// de las duraciones EC2-EC7 cae en (5,6) ni en (30,30.5) — los únicos rangos
// donde validar-crudo y validar-redondeado DIFIEREN de verdad.
// - EC13: duration=5.7 → raw < 6 (inválido) pero round(5.7)=6 (válido si se
//   validara el redondeado) → debe marcar FAILED con AD_DURATION_INVALID,
//   mark_ready NUNCA se llama. Mata el mutante "valida redondeado".
// - EC14: duration=30.4 → raw > 30 (inválido) pero round(30.4)=30 (válido si
//   se validara el redondeado) → debe marcar FAILED, mark_ready NUNCA se
//   llama. Simétrico de EC13 en el límite superior.
//
// ### Fallo del adapter de ad_creatives — DECISIÓN (coordinador, 2026-08-16):
// se propaga (Cloudflare reintenta), NUNCA se traga a 200. `processing` no
// tiene ventana de expiración (169.4) — tragarse el error dejaría el creativo
// atorado ahí para siempre, sin ruta de recuperación.
// - EC15: adCreativeStatusUpdater.mark_ready RECHAZA (state='ready', property
//   afecta 0 filas) → respond() debe RECHAZAR también (nunca resolver a una
//   Response, mucho menos 200); el mensaje re-lanzado debe conservar la causa
//   original (logueable) Y nombrar 'ad_creatives' (claro, identificable) — no
//   puede ser un burbujeo crudo sin contexto.
// - EC16: adCreativeStatusUpdater.mark_failed RECHAZA (state='error', property
//   afecta 0 filas) → mismo contrato que EC15, rama 'error'.

import { assertEquals, assertRejects } from "@std/assert";
import { make_stream_webhook_handler } from "./handler.ts";
import { AD_DURATION_INVALID } from "./types.ts";
import type {
  AdCreativeStatusUpdater,
  MarkAdCreativeFailedParams,
  MarkAdCreativeReadyParams,
  MarkVideoFailedParams,
  MarkVideoReadyParams,
  StreamWebhookDeps,
  VideoEventNotifier,
  VideoNotifyEvent,
  VideoStatusUpdater,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const WEBHOOK_SECRET = "test_stream_webhook_secret_169_5_no_es_el_real";
const AD_STREAM_UID = "ad-creative-uid-0000000000000001";

const AD_THUMBNAIL_URL =
  "https://videodelivery.net/ad-creative-uid-0000000000000001/thumbnails/thumbnail.jpg";
const AD_ERROR_REASON_TEXT = "El archivo excede el tamaño máximo permitido por Stream";

function ready_payload(duration?: number): string {
  const body: Record<string, unknown> = {
    uid: AD_STREAM_UID,
    status: { state: "ready" },
    thumbnail: AD_THUMBNAIL_URL,
  };
  if (duration !== undefined) body.duration = duration;
  return JSON.stringify(body);
}

const ERROR_PAYLOAD = JSON.stringify({
  uid: AD_STREAM_UID,
  status: {
    state: "error",
    errorReasonCode: "INPUT_ERROR",
    errorReasonText: AD_ERROR_REASON_TEXT,
  },
});

// ── Firma HMAC real (idéntica a handler.test.ts — self-contenido a propósito) ──

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

async function sign_body(raw_body: string, time = 1_753_100_000): Promise<string> {
  const sig1 = await hmac_sha256_hex(WEBHOOK_SECRET, `${time}.${raw_body}`);
  return `time=${time},sig1=${sig1}`;
}

function webhook_request(raw_body: string, signature_header: string): Request {
  return new Request("http://localhost/stream-webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Webhook-Signature": signature_header },
    body: raw_body,
  });
}

// ── Fakes — VideoStatusUpdater (property_videos) ─────────────────────────────
// Solo necesitamos controlar cuántas filas "afecta" — 0 = la puerta de entrada
// documentada de la rama de anuncios (handler.ts:99-100).

function property_updater(affected_rows: number): VideoStatusUpdater {
  return {
    mark_ready(_params: MarkVideoReadyParams): Promise<number> {
      return Promise.resolve(affected_rows);
    },
    mark_failed(_params: MarkVideoFailedParams): Promise<number> {
      return Promise.resolve(affected_rows);
    },
  };
}

// ── Fakes — VideoEventNotifier (no es el foco de esta suite, solo debe no lanzar) ──

function notifier_stub(): VideoEventNotifier {
  return {
    notify_video_event(_event: VideoNotifyEvent, _cloudflare_uid: string): Promise<void> {
      return Promise.resolve();
    },
  };
}

// ── Fakes — AdCreativeStatusUpdater (ad_creatives) ───────────────────────────

interface FakeAdCreativeStatusUpdater extends AdCreativeStatusUpdater {
  ready_calls: MarkAdCreativeReadyParams[];
  failed_calls: MarkAdCreativeFailedParams[];
}

function ad_updater(affected_rows = 1): FakeAdCreativeStatusUpdater {
  return {
    ready_calls: [],
    failed_calls: [],
    mark_ready(params: MarkAdCreativeReadyParams): Promise<number> {
      this.ready_calls.push(params);
      return Promise.resolve(affected_rows);
    },
    mark_failed(params: MarkAdCreativeFailedParams): Promise<number> {
      this.failed_calls.push(params);
      return Promise.resolve(affected_rows);
    },
  } as FakeAdCreativeStatusUpdater;
}

// ── Deps helper ───────────────────────────────────────────────────────────────

function make_deps(overrides: Partial<StreamWebhookDeps> = {}): StreamWebhookDeps {
  return {
    webhookSecret: WEBHOOK_SECRET,
    videoStatusUpdater: property_updater(0), // por defecto: uid NO pertenece a property_videos
    notifier: notifier_stub(),
    ...overrides,
  };
}

// ── Aditividad: el test más importante de la subtarea ────────────────────────

Deno.test("property_videos_afecta_1_fila_jamas_intenta_ad_creatives_aunque_el_updater_este_inyectado", async () => {
  const header = await sign_body(ready_payload(92.3));
  const ad = ad_updater();
  const deps = make_deps({ videoStatusUpdater: property_updater(1), adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(ready_payload(92.3), header));

  assertEquals(res.status, 200);
  assertEquals(ad.ready_calls.length, 0, "un video de propiedad (1 fila afectada) NUNCA debe tocar ad_creatives");
  assertEquals(ad.failed_calls.length, 0, "un video de propiedad (1 fila afectada) NUNCA debe tocar ad_creatives");
});

// ── Happy path: duración válida ───────────────────────────────────────────────

Deno.test("ad_ready_duracion_minima_6s_marca_ready_en_ad_creatives_con_params_exactos", async () => {
  const payload = ready_payload(6);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(payload, header));

  assertEquals(res.status, 200);
  assertEquals(ad.ready_calls.length, 1, "duración=6 (mínimo inclusive) debe marcar ready");
  assertEquals(ad.ready_calls[0], {
    cloudflare_uid: AD_STREAM_UID,
    thumbnail_url: AD_THUMBNAIL_URL,
    duration_seconds: 6,
  });
  assertEquals(ad.failed_calls.length, 0);
});

Deno.test("ad_ready_duracion_maxima_30s_marca_ready_en_ad_creatives", async () => {
  const payload = ready_payload(30);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(ad.ready_calls.length, 1, "duración=30 (máximo inclusive, mismo cap que mint-ad-upload-url) debe marcar ready");
  assertEquals(ad.ready_calls[0].duration_seconds, 30);
  assertEquals(ad.failed_calls.length, 0);
});

Deno.test("ad_ready_duracion_fraccional_dentro_de_rango_se_pasa_intacta_sin_redondear", async () => {
  const payload = ready_payload(29.9);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(ad.ready_calls.length, 1);
  assertEquals(
    ad.ready_calls[0].duration_seconds,
    29.9,
    "el handler no debe redondear/truncar la duración reportada por Stream",
  );
});

// ── AD_DURATION_INVALID ────────────────────────────────────────────────────────

Deno.test("ad_ready_duracion_5s_por_debajo_del_minimo_marca_failed_con_ad_duration_invalid", async () => {
  const payload = ready_payload(5);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(payload, header));

  assertEquals(res.status, 200, "duración inválida sigue respondiendo 200 (el estado se resuelve en la DB, no en el webhook HTTP)");
  assertEquals(ad.ready_calls.length, 0, "duración por debajo del mínimo NUNCA debe marcar ready");
  assertEquals(ad.failed_calls.length, 1);
  assertEquals(ad.failed_calls[0], {
    cloudflare_uid: AD_STREAM_UID,
    reason_code: AD_DURATION_INVALID,
  });
});

Deno.test("ad_ready_sin_duration_en_el_payload_fail_closed_marca_failed_con_ad_duration_invalid", async () => {
  const payload = ready_payload(); // sin campo duration
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(ad.ready_calls.length, 0, "sin duration_seconds no se puede verificar el mínimo de 6s: fail-closed");
  assertEquals(ad.failed_calls.length, 1);
  assertEquals(ad.failed_calls[0].reason_code, AD_DURATION_INVALID);
});

Deno.test("ad_ready_duracion_31s_por_encima_del_maximo_marca_failed_con_ad_duration_invalid", async () => {
  const payload = ready_payload(31);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(ad.ready_calls.length, 0, "defensa en profundidad: >30s tampoco debe marcar ready aunque Stream ya lo cape en el mint");
  assertEquals(ad.failed_calls.length, 1);
  assertEquals(ad.failed_calls[0].reason_code, AD_DURATION_INVALID);
});

// ── Candado del invariante de orden (mutante "e2": validar redondeado, no crudo) ──
// (5,6) y (30,30.5) son los ÚNICOS rangos donde validar-crudo y
// validar-redondeado dan veredictos DISTINTOS — EC2-EC7 nunca cayeron ahí.

Deno.test("ad_ready_duracion_5_7s_raw_invalido_aunque_redondeado_de_6_seria_valido_marca_failed", async () => {
  const payload = ready_payload(5.7);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(
    ad.ready_calls.length,
    0,
    "5.7 crudo es < 6 (inválido): si el handler validara round(5.7)=6 en vez del crudo, esto marcaría ready incorrectamente",
  );
  assertEquals(ad.failed_calls.length, 1);
  assertEquals(ad.failed_calls[0], { cloudflare_uid: AD_STREAM_UID, reason_code: AD_DURATION_INVALID });
});

Deno.test("ad_ready_duracion_30_4s_raw_invalido_aunque_redondeado_de_30_seria_valido_marca_failed", async () => {
  const payload = ready_payload(30.4);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(
    ad.ready_calls.length,
    0,
    "30.4 crudo es > 30 (inválido): si el handler validara round(30.4)=30 en vez del crudo, esto marcaría ready incorrectamente",
  );
  assertEquals(ad.failed_calls.length, 1);
  assertEquals(ad.failed_calls[0], { cloudflare_uid: AD_STREAM_UID, reason_code: AD_DURATION_INVALID });
});

// ── state='error' de Stream ────────────────────────────────────────────────────

Deno.test("ad_error_state_marca_failed_en_ad_creatives_con_el_mismo_reason_del_payload", async () => {
  const header = await sign_body(ERROR_PAYLOAD);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(ERROR_PAYLOAD, header));

  assertEquals(res.status, 200);
  assertEquals(ad.failed_calls.length, 1);
  assertEquals(ad.failed_calls[0], {
    cloudflare_uid: AD_STREAM_UID,
    reason_code: AD_ERROR_REASON_TEXT,
  });
  assertEquals(ad.ready_calls.length, 0);
});

// ── uid desconocido a ambas tablas ────────────────────────────────────────────

Deno.test("uid_desconocido_en_property_videos_y_ad_creatives_no_lanza_y_responde_200", async () => {
  const payload = ready_payload(20);
  const header = await sign_body(payload);
  const ad = ad_updater(0); // tampoco existe en ad_creatives
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(payload, header));

  assertEquals(res.status, 200, "uid genuinamente desconocido a ambas tablas no debe fallar (evita reintentos de Cloudflare)");
});

// ── Retrocompatibilidad: dep nuevo ausente ────────────────────────────────────

Deno.test("sin_ad_creative_status_updater_inyectado_no_lanza_y_responde_200_como_antes_de_169_5", async () => {
  const payload = ready_payload(20);
  const header = await sign_body(payload);
  // adCreativeStatusUpdater NO se pasa — deps queda sin la key (exactamente el
  // shape con el que handler.test.ts de 68.5 construye StreamWebhookDeps).
  const deps = make_deps();
  const respond = make_stream_webhook_handler(deps);

  const res = await respond(webhook_request(payload, header));

  assertEquals(res.status, 200, "la ausencia del dep nuevo debe preservar el 200 idempotente pre-169.5");
});

// ── Shape exacto de los argumentos ────────────────────────────────────────────

Deno.test("mark_ready_ad_creatives_recibe_solo_cloudflare_uid_duration_seconds_thumbnail_url", async () => {
  const payload = ready_payload(15);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(
    Object.keys(ad.ready_calls[0]).sort(),
    ["cloudflare_uid", "duration_seconds", "thumbnail_url"],
    "el updater de ad_creatives debe filtrar SOLO por cloudflare_uid; nunca property_id/agent_id",
  );
});

Deno.test("mark_failed_ad_creatives_recibe_solo_cloudflare_uid_reason_code", async () => {
  const payload = ready_payload(2);
  const header = await sign_body(payload);
  const ad = ad_updater();
  const deps = make_deps({ adCreativeStatusUpdater: ad });
  const respond = make_stream_webhook_handler(deps);

  await respond(webhook_request(payload, header));

  assertEquals(
    Object.keys(ad.failed_calls[0]).sort(),
    ["cloudflare_uid", "reason_code"],
    "mark_failed de ad_creatives debe recibir SOLO cloudflare_uid+reason_code; nunca property_id/agent_id",
  );
});

// ── Fallo del adapter de ad_creatives — DECISIÓN: se propaga, nunca a 200 ────
// `processing` no tiene ventana de expiración (169.4 solo cubre 'uploading') —
// tragarse el error dejaría el creativo atorado ahí PARA SIEMPRE, sin ruta de
// recuperación. El reintento de Cloudflare es el único mecanismo de rescate.
// 🔴 No "arreglar" esto envolviéndolo en un catch que devuelva 200 — es la
// decisión documentada, no un descuido.

function failing_ad_updater(cause: Error): AdCreativeStatusUpdater {
  return {
    mark_ready(_params: MarkAdCreativeReadyParams): Promise<number> {
      return Promise.reject(cause);
    },
    mark_failed(_params: MarkAdCreativeFailedParams): Promise<number> {
      return Promise.reject(cause);
    },
  };
}

Deno.test("ad_creatives_mark_ready_falla_el_handler_repropaga_nunca_resuelve_a_200", async () => {
  const payload = ready_payload(20); // duración válida → llega a mark_ready, no a mark_failed
  const header = await sign_body(payload);
  const cause = new Error("boom_infra_no_descriptivo_mark_ready");
  const deps = make_deps({ adCreativeStatusUpdater: failing_ad_updater(cause) });
  const respond = make_stream_webhook_handler(deps);

  const rejected = await assertRejects(() => respond(webhook_request(payload, header)));

  const message = rejected instanceof Error ? rejected.message : String(rejected);
  assertEquals(
    message.includes("boom_infra_no_descriptivo_mark_ready"),
    true,
    "el error re-lanzado debe conservar la causa original — logueable, no reemplazada",
  );
  assertEquals(
    message.includes("ad_creatives"),
    true,
    "el error re-lanzado debe identificar el componente que falló (claro) — no un burbujeo crudo sin contexto",
  );
});

Deno.test("ad_creatives_mark_failed_falla_el_handler_repropaga_nunca_resuelve_a_200", async () => {
  const cause = new Error("boom_infra_no_descriptivo_mark_failed");
  const deps = make_deps({ adCreativeStatusUpdater: failing_ad_updater(cause) });
  const respond = make_stream_webhook_handler(deps);
  const header = await sign_body(ERROR_PAYLOAD);

  const rejected = await assertRejects(() => respond(webhook_request(ERROR_PAYLOAD, header)));

  const message = rejected instanceof Error ? rejected.message : String(rejected);
  assertEquals(message.includes("boom_infra_no_descriptivo_mark_failed"), true, "causa original conservada");
  assertEquals(message.includes("ad_creatives"), true, "componente identificado en el mensaje");
});
