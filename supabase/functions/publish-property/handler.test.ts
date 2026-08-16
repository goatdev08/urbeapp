// supabase/functions/publish-property/handler.test.ts
// Tests RED — subtarea 8.9, MIGRADO en subtarea 68.12 (upload-first)
// Edge Function: publish-property/handler.ts
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-env --allow-net --allow-read --config deno.json publish-property/handler.test.ts
//         (desde supabase/functions/ para tomar el deno.json con el import map)
//
// 68.12 — CAMBIO DE CONTRATO: el video se sube a Cloudflare Stream ANTES de que
// exista la propiedad (mint-upload-url, 68.4). Publicar ya NO manda video_id +
// storage_path: manda cloudflare_uid (la referencia del video en vuelo que el
// RPC publish_property_atomic va a ENLAZAR — UPDATE, no INSERT). video_id y
// storage_path desaparecen del payload/params; el gate real es cloudflare_uid.
//
// EDGE CASES (RED) — 8.9 + 68.12:
//
// ### Happy path
// - POST agente válido + payload completo (con cloudflare_uid) → 201 con { property_id }
// - publisher.publish llamado exactamente una vez
// - publisher recibe property_status='active' (contrato: handler siempre publica activo)
// - publisher recibe video_status='ready' (contrato: video ya subido = listo)
// - publisher recibe cloudflare_uid del payload (68.12 — reemplaza video_id/storage_path)
// - publisher recibe user_id = auth.uid() del caller verificado
// - publisher recibe lat/lng para construir ST_Point(lng, lat) en la capa de persistencia
//
// ### CORS / Métodos HTTP
// - OPTIONS → 200 con header Access-Control-Allow-Origin
// - OPTIONS → header Access-Control-Allow-Methods presente
// - OPTIONS → header Access-Control-Allow-Headers presente
// - GET → 405
// - PUT → 405
//
// ### Body / parse
// - Body no-JSON → 400 INVALID_INPUT
// - Payload vacío {} → 400 INVALID_INPUT
//
// ### Validación — operation_type (enum DB: 'rent'|'sale'|'both')
// - Falta operation_type → 400 INVALID_INPUT
// - operation_type fuera del enum ('venta') → 400 INVALID_INPUT
//
// ### Validación — property_type (enum DB: 'casa'|'departamento'|'local'|'oficina'|'terreno')
// - Falta property_type → 400 INVALID_INPUT
// - property_type fuera del enum ('penthouse') → 400 INVALID_INPUT
//
// ### Validación — price (number > 0, PRD §12)
// - Falta price → 400 INVALID_INPUT
// - price = 0 → 400 INVALID_INPUT (límite: > 0)
// - price negativo (-1) → 400 INVALID_INPUT
//
// ### Validación — address (string no vacío)
// - Falta address → 400 INVALID_INPUT
// - address = '' (string vacío) → 400 INVALID_INPUT
// - address solo espacios → 400 INVALID_INPUT
//
// ### Validación — lat/lng (numbers, requeridos para ST_Point)
// - Falta lat → 400 INVALID_INPUT (no se puede construir ST_Point)
// - Falta lng → 400 INVALID_INPUT
// - lat no numérico (string) → 400 INVALID_INPUT
// - lng nulo (null) → 400 INVALID_INPUT
//
// ### Validación — cloudflare_uid (requerido, 68.12 — reemplaza video_id/storage_path)
// - Falta cloudflare_uid → 400 INVALID_INPUT (el video no terminó de subirse)
// - cloudflare_uid vacío ('') → 400 INVALID_INPUT
//
// ### Auth — CallerVerifier DI
// - Sin Authorization header → 401 UNAUTHENTICATED
// - Verifier devuelve UNAUTHENTICATED (JWT inválido) → 401, error.code = 'UNAUTHENTICATED'
// - role = 'user' → 403 FORBIDDEN, error.code = 'FORBIDDEN'
// - role = 'user' → publisher NO llamado (0 calls)
//
// ### DB failures → 500 propagado limpio
// - publisher.publish falla (DB_ERROR) → 500
// - publisher.publish falla → respuesta tiene { error: { code, message } }
// - publisher.publish falla → publisher WAS llamado (distingue del caso auth-bloqueado)
//
// ### Atomicidad — publicación atómica (properties + property_videos)
// - publisher garantiza atomicidad (INSERT atómico vía RPC en GREEN);
//   si falla el video insert, la property no queda colgada.
//   Test: publisher que falla → respuesta es error, no se devuelve property_id.
//   La atomicidad real (rollback en DB) se testa en pgTAP cuando se implemente la RPC.

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  PropertyPublishParams,
  PropertyPublishResult,
  PropertyPublisher,
  PublishPropertyDeps,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENT_ID = "00000000-0000-0000-0000-000000000001";
const PROPERTY_ID = "00000000-0000-0000-0000-000000000002";
const CLOUDFLARE_UID = "cf-stream-uid-abc123";

const PAYLOAD_VALIDO = {
  // step1
  operation_type: "rent",
  property_type: "departamento",
  // step2
  price: 12500,
  bedrooms: 2,
  bathrooms: 1,
  square_meters: 65,
  address: "Av. Insurgentes Sur 1602, Col. Crédito Constructor, CDMX",
  lat: 19.3836,
  lng: -99.1748,
  pet_friendly: false,
  allows_no_guarantor: true,
  student_friendly: false,
  description: "Depto luminoso con balcón y estacionamiento incluido.",
  // video (68.12 — el video ya se subió a Cloudflare Stream antes de publicar;
  // esta es la referencia que el RPC va a ENLAZAR, no video_id/storage_path)
  cloudflare_uid: CLOUDFLARE_UID,
};

// ── Factories de fakes — CallerVerifier ───────────────────────────────────────

interface FakeCallerVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_agente_ok(): FakeCallerVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id: AGENT_ID });
    },
  } as FakeCallerVerifier;
}

function verifier_unauthenticated(): FakeCallerVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeCallerVerifier;
}

function verifier_forbidden(): FakeCallerVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "FORBIDDEN" });
    },
  } as FakeCallerVerifier;
}

// ── Factories de fakes — PropertyPublisher ────────────────────────────────────

interface FakePropertyPublisher extends PropertyPublisher {
  calls: PropertyPublishParams[];
}

function publisher_ok(): FakePropertyPublisher {
  return {
    calls: [],
    publish(params: PropertyPublishParams): Promise<PropertyPublishResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true, property_id: PROPERTY_ID });
    },
  } as FakePropertyPublisher;
}

function publisher_error(error_code: string): FakePropertyPublisher {
  return {
    calls: [],
    publish(params: PropertyPublishParams): Promise<PropertyPublishResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code, message: `Mock error: ${error_code}` });
    },
  } as FakePropertyPublisher;
}

// ── Helpers de Request ────────────────────────────────────────────────────────

function post_agente(
  body: unknown,
  extra_headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/publish-property", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer fake-agent-jwt",
      ...extra_headers,
    },
    body: JSON.stringify(body),
  });
}

function post_sin_auth(body: unknown): Request {
  return new Request("http://localhost/publish-property", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/publish-property", { method });
}

function deps_validos(
  publisher: PropertyPublisher = publisher_ok(),
  verifier: CallerVerifier = verifier_agente_ok(),
): PublishPropertyDeps {
  // 73.4: PublishPropertyDeps ahora exige videoStatusChecker/duplicatePropertyChecker.
  // Los tests que NO ejercitan el pipeline (validación de payload, auth, DB
  // failures) usan defaults "todo OK" para no interferir con lo que sí testean.
  return {
    callerVerifier: verifier,
    propertyPublisher: publisher,
    videoStatusChecker: video_checker_ok(),
    duplicatePropertyChecker: duplicate_checker_result(false),
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_path_agente_publica_propiedad_retorna_201_con_property_id", async () => {
  const res = await handler(post_agente(PAYLOAD_VALIDO), deps_validos());
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.property_id, PROPERTY_ID);
});

Deno.test("happy_path_publisher_llamado_exactamente_una_vez", async () => {
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(publisher.calls.length, 1, "publish debe ser llamado exactamente una vez");
});

Deno.test("contrato_publisher_recibe_property_status_active_moderacion_suspendida", async () => {
  // #153 — SUPERSEDE (temporalmente) la expectativa de 73.4 ('pending_review',
  // PRD §14.2). Decisión de Abraham 2026-08-11: NO hay moderador ni interfaz de
  // moderación todavía — las publicaciones quedaban atoradas en pending_review
  // sin forma de aprobarlas más que por SQL. Mientras exista ese hueco, toda
  // publicación sale directo a 'active'. Revertir a 'pending_review' cuando
  // llegue la interfaz de moderación (re-flip de este assert = el RED).
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(
    publisher.calls[0].property_status,
    "active",
    "property_status debe ser 'active' — #153: moderación suspendida hasta tener interfaz; el pipeline de validación (video+duplicado) sigue activo",
  );
});

// ── #129: price_visible ya no se descarta al publicar ─────────────────────────
// El bug: el wizard mandaba price_visible pero el parser lo ignoraba, así que
// la fila nacía con el default de columna (true) aunque el agente apagara
// "Mostrar precio en el feed". Al EDITAR sí se respetaba — inconsistencia pura.

Deno.test("contrato_publisher_recibe_price_visible_false_cuando_el_payload_lo_manda", async () => {
  const publisher = publisher_ok();
  await handler(
    post_agente({ ...PAYLOAD_VALIDO, price_visible: false }),
    deps_validos(publisher),
  );
  assertEquals(
    publisher.calls[0].price_visible,
    false,
    "price_visible=false del wizard debe llegar al publisher — antes moría en el parser (#129)",
  );
});

Deno.test("contrato_publisher_recibe_price_visible_true_cuando_el_payload_lo_manda_true", async () => {
  const publisher = publisher_ok();
  await handler(
    post_agente({ ...PAYLOAD_VALIDO, price_visible: true }),
    deps_validos(publisher),
  );
  assertEquals(publisher.calls[0].price_visible, true);
});

Deno.test("contrato_publisher_recibe_price_visible_true_por_default_si_ausente", async () => {
  // Payload sin price_visible (caller viejo) → default true, igual que la columna.
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(
    publisher.calls[0].price_visible,
    true,
    "sin price_visible en el payload debe defaultear a true (mismo default que la columna)",
  );
});

Deno.test("contrato_price_visible_no_booleano_defaultea_a_true_no_coacciona", async () => {
  // Lección #142: distinguir "ausente/ruido" de "false explícito" — un string
  // 'false' NO debe interpretarse como apagar el precio.
  const publisher = publisher_ok();
  await handler(
    post_agente({ ...PAYLOAD_VALIDO, price_visible: "false" }),
    deps_validos(publisher),
  );
  assertEquals(publisher.calls[0].price_visible, true);
});

// ── Quick fixes wizard paso 3 (sesión 2026-08-15, sin tarea de Taskmaster):
// built_square_meters, half_bathrooms, currency ──────────────────────────────

Deno.test("contrato_publisher_recibe_built_square_meters_del_payload", async () => {
  const publisher = publisher_ok();
  await handler(
    post_agente({ ...PAYLOAD_VALIDO, built_square_meters: 120.5 }),
    deps_validos(publisher),
  );
  assertEquals(publisher.calls[0].built_square_meters, 120.5);
});

Deno.test("contrato_publisher_recibe_built_square_meters_null_si_ausente", async () => {
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(publisher.calls[0].built_square_meters, null);
});

Deno.test("contrato_publisher_recibe_half_bathrooms_del_payload", async () => {
  const publisher = publisher_ok();
  await handler(
    post_agente({ ...PAYLOAD_VALIDO, half_bathrooms: 1 }),
    deps_validos(publisher),
  );
  assertEquals(publisher.calls[0].half_bathrooms, 1);
});

Deno.test("contrato_publisher_recibe_half_bathrooms_null_si_ausente", async () => {
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(publisher.calls[0].half_bathrooms, null);
});

Deno.test("contrato_publisher_recibe_currency_del_payload", async () => {
  const publisher = publisher_ok();
  await handler(
    post_agente({ ...PAYLOAD_VALIDO, currency: "USD" }),
    deps_validos(publisher),
  );
  assertEquals(publisher.calls[0].currency, "USD");
});

Deno.test("contrato_publisher_recibe_currency_default_mxn_si_ausente", async () => {
  // Payload sin currency (caller viejo) → default 'MXN', igual que la columna.
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(publisher.calls[0].currency, "MXN");
});

Deno.test("validacion_currency_invalida_retorna_400", async () => {
  const publisher = publisher_ok();
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, currency: "EUR" }),
    deps_validos(publisher),
  );
  assertEquals(res.status, 400);
  assertEquals(publisher.calls.length, 0);
});

Deno.test("happy_path_publisher_recibe_video_status_ready", async () => {
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(
    publisher.calls[0].video_status,
    "ready",
    "video_status debe ser 'ready' — el video ya fue subido al bucket antes de publicar",
  );
});

Deno.test("happy_path_publisher_recibe_cloudflare_uid_del_payload", async () => {
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(
    publisher.calls[0].cloudflare_uid,
    CLOUDFLARE_UID,
    "cloudflare_uid debe venir del payload — es la referencia del video en vuelo (Cloudflare Stream) a enlazar, reemplaza video_id/storage_path (68.12)",
  );
});

Deno.test("happy_path_publisher_recibe_user_id_del_caller_verificado", async () => {
  const publisher = publisher_ok();
  const verifier = verifier_agente_ok();
  await handler(post_agente(PAYLOAD_VALIDO), {
    callerVerifier: verifier,
    propertyPublisher: publisher,
    videoStatusChecker: video_checker_ok(),
    duplicatePropertyChecker: duplicate_checker_result(false),
  });
  assertEquals(
    publisher.calls[0].user_id,
    AGENT_ID,
    "user_id debe ser auth.uid() del caller verificado, no del payload",
  );
});

Deno.test("happy_path_publisher_recibe_lat_y_lng_para_st_point", async () => {
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(publisher.calls[0].lat, PAYLOAD_VALIDO.lat, "lat debe llegar al publisher para ST_Point");
  assertEquals(publisher.calls[0].lng, PAYLOAD_VALIDO.lng, "lng debe llegar al publisher para ST_Point");
});

// ── CORS / Métodos HTTP ───────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status >= 200 && res.status <= 204, true);
});

Deno.test("cors_options_tiene_header_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Falta header Access-Control-Allow-Origin",
  );
});

Deno.test("cors_options_tiene_header_allow_methods", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Methods"),
    "Falta header Access-Control-Allow-Methods",
  );
});

Deno.test("cors_options_tiene_header_allow_headers", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Headers"),
    "Falta header Access-Control-Allow-Headers",
  );
});

Deno.test("metodo_get_retorna_405", async () => {
  const res = await handler(method_request("GET"));
  assertEquals(res.status, 405);
});

Deno.test("metodo_put_retorna_405", async () => {
  const res = await handler(method_request("PUT"));
  assertEquals(res.status, 405);
});

// ── Body / parse ──────────────────────────────────────────────────────────────

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const req = new Request("http://localhost/publish-property", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer fake-jwt" },
    body: "esto no es json{{{",
  });
  const res = await handler(req, deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("payload_vacio_retorna_400_invalid_input", async () => {
  const res = await handler(post_agente({}), deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación — operation_type ───────────────────────────────────────────────

Deno.test("validacion_operation_type_ausente_retorna_400", async () => {
  const { operation_type: _omit, ...sin_op } = PAYLOAD_VALIDO;
  const res = await handler(post_agente(sin_op), deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_operation_type_invalido_retorna_400", async () => {
  // 'venta' no está en el enum rent|sale|both
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, operation_type: "venta" }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación — property_type ────────────────────────────────────────────────

Deno.test("validacion_property_type_ausente_retorna_400", async () => {
  const { property_type: _omit, ...sin_pt } = PAYLOAD_VALIDO;
  const res = await handler(post_agente(sin_pt), deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_property_type_invalido_retorna_400", async () => {
  // 'penthouse' no está en el enum
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, property_type: "penthouse" }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación — price (> 0) ──────────────────────────────────────────────────

Deno.test("validacion_price_ausente_retorna_400", async () => {
  const { price: _omit, ...sin_price } = PAYLOAD_VALIDO;
  const res = await handler(post_agente(sin_price), deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_price_cero_retorna_400", async () => {
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, price: 0 }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_price_negativo_retorna_400", async () => {
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, price: -1 }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación — address (string no vacío) ────────────────────────────────────

Deno.test("validacion_address_ausente_retorna_400", async () => {
  const { address: _omit, ...sin_address } = PAYLOAD_VALIDO;
  const res = await handler(post_agente(sin_address), deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_address_vacio_retorna_400", async () => {
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, address: "" }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_address_solo_espacios_retorna_400", async () => {
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, address: "   " }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación — lat/lng (numbers requeridos para ST_Point) ──────────────────

Deno.test("validacion_lat_ausente_retorna_400", async () => {
  const { lat: _omit, ...sin_lat } = PAYLOAD_VALIDO;
  const res = await handler(post_agente(sin_lat), deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_lng_ausente_retorna_400", async () => {
  const { lng: _omit, ...sin_lng } = PAYLOAD_VALIDO;
  const res = await handler(post_agente(sin_lng), deps_validos());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_lat_no_numerico_retorna_400", async () => {
  // lat como string no es válido para construir ST_Point
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, lat: "19.38N" }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_lng_nulo_retorna_400", async () => {
  const res = await handler(
    post_agente({ ...PAYLOAD_VALIDO, lng: null }),
    deps_validos(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Validación — cloudflare_uid (68.12, reemplaza video_id/storage_path) ──────
//
// NOTA DE DISEÑO: estos dos payloads agregan video_id/storage_path "legacy"
// (además de manipular cloudflare_uid) a propósito. El handler.ts sin migrar
// (RED actual) todavía exige esos dos campos legacy antes de siquiera llegar
// al publisher — sin ellos, CUALQUIER payload cae en 400 por esa razón vieja,
// enmascarando si cloudflare_uid en verdad se está validando. Incluirlos aquí
// aísla la señal: con video_id/storage_path presentes, el ÚNICO motivo por el
// que debería fallar es la ausencia/vacío de cloudflare_uid — y hoy el handler
// no lo valida en absoluto, así que el publisher SÍ es invocado y responde 201
// (falla la aserción de 400, RED genuino y no incidental).

Deno.test("validacion_cloudflare_uid_ausente_retorna_400", async () => {
  const { cloudflare_uid: _omit, ...sin_cf } = PAYLOAD_VALIDO;
  const payload_con_legacy = {
    ...sin_cf,
    video_id: "legacy-video-id",
    storage_path: "legacy/storage/path.mp4",
  };
  const res = await handler(post_agente(payload_con_legacy), deps_validos());
  assertEquals(res.status, 400, "cloudflare_uid ausente debe rechazarse con 400 (el video no terminó de subirse)");
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("validacion_cloudflare_uid_vacio_retorna_400", async () => {
  const payload_con_legacy = {
    ...PAYLOAD_VALIDO,
    cloudflare_uid: "",
    video_id: "legacy-video-id",
    storage_path: "legacy/storage/path.mp4",
  };
  const res = await handler(post_agente(payload_con_legacy), deps_validos());
  assertEquals(res.status, 400, "cloudflare_uid vacío debe rechazarse con 400");
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Auth — CallerVerifier ─────────────────────────────────────────────────────

Deno.test("sin_authorization_header_retorna_401_unauthenticated", async () => {
  const verifier = verifier_unauthenticated();
  const res = await handler(
    post_sin_auth(PAYLOAD_VALIDO),
    {
      callerVerifier: verifier,
      propertyPublisher: publisher_ok(),
      videoStatusChecker: video_checker_ok(),
      duplicatePropertyChecker: duplicate_checker_result(false),
    },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_retorna_401_unauthenticated", async () => {
  const verifier = verifier_unauthenticated();
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    {
      callerVerifier: verifier,
      propertyPublisher: publisher_ok(),
      videoStatusChecker: video_checker_ok(),
      duplicatePropertyChecker: duplicate_checker_result(false),
    },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("role_user_retorna_403_forbidden", async () => {
  // Un usuario normal (role='user') no puede publicar propiedades — requiere agent o admin
  const verifier = verifier_forbidden();
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    {
      callerVerifier: verifier,
      propertyPublisher: publisher_ok(),
      videoStatusChecker: video_checker_ok(),
      duplicatePropertyChecker: duplicate_checker_result(false),
    },
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("role_user_publisher_no_es_llamado", async () => {
  // Con rol prohibido, respuesta debe ser 403 Y publisher no debe ser llamado
  const publisher = publisher_ok();
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    {
      callerVerifier: verifier_forbidden(),
      propertyPublisher: publisher,
      videoStatusChecker: video_checker_ok(),
      duplicatePropertyChecker: duplicate_checker_result(false),
    },
  );
  // La aserción de status falla primero en RED (stub devuelve 500, no 403)
  assertEquals(res.status, 403, "status debe ser 403 cuando el caller tiene rol 'user'");
  assertEquals(
    publisher.calls.length,
    0,
    "publisher NO debe ser llamado cuando el caller no tiene rol válido (agent/admin)",
  );
});

// ── Forma del error ───────────────────────────────────────────────────────────

Deno.test("error_siempre_tiene_forma_error_code_message", async () => {
  // Payload vacío → debe retornar 400 (no 500 NOT_IMPLEMENTED) con forma correcta
  const res = await handler(post_agente({}), deps_validos());
  // status 400 falla en RED (stub devuelve 500)
  assertEquals(res.status, 400, "payload vacío debe retornar 400, no 500");
  const body = await res.json();
  assertExists(body.error, "La respuesta no contiene 'error'");
  assertEquals(body.error.code, "INVALID_INPUT", "payload vacío debe retornar INVALID_INPUT, no NOT_IMPLEMENTED");
  assertExists(body.error.message, "error.message ausente");
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});

// ── DB failures → 500 ────────────────────────────────────────────────────────

Deno.test("fallo_del_publisher_retorna_500", async () => {
  // El publisher falla → handler propaga 500. En RED falla porque publisher nunca es llamado
  // (stub retorna 500 sin llamar al publisher), pero la distinción se verifica en publisher_fue_llamado.
  const publisher = publisher_error("DB_ERROR");
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_validos(publisher),
  );
  assertEquals(res.status, 500);
  // En GREEN el publisher debe haber sido invocado; en RED: stub no lo llama → FAIL aquí
  assertEquals(
    publisher.calls.length,
    1,
    "publisher debe ser llamado antes de propagar el 500 (no es el stub quien devuelve 500 directamente)",
  );
});

Deno.test("fallo_del_publisher_respuesta_tiene_forma_error", async () => {
  const publisher = publisher_error("DB_ERROR");
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_validos(publisher),
  );
  // En RED falla porque publisher no fue llamado → sin él no hay error propagado correctamente
  assertEquals(publisher.calls.length, 1, "publisher debe ser llamado");
  const body = await res.json();
  assertExists(body.error, "Error 500 debe tener cuerpo { error: { code, message } }");
  assertExists(body.error.code, "error.code debe estar presente en el 500");
});

Deno.test("fallo_del_publisher_publisher_fue_llamado_una_vez", async () => {
  // Distingue del caso auth-bloqueado: el publisher SÍ fue invocado, pero falló
  const publisher = publisher_error("DB_ERROR");
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(
    publisher.calls.length,
    1,
    "publisher debe ser llamado una vez incluso si falla (el error viene de la DB, no de validación/auth)",
  );
});

// ── Suspensión de agencia (fix 100) — 403, no 500 ─────────────────────────────
//
// El publisher (RPC publish_property_atomic) lanza AGENCY_MEMBERSHIP_SUSPENDED
// cuando el agente tiene una membresía 'suspended' en su agencia. Es un error de
// AUTORIZACIÓN (mismo espíritu que FORBIDDEN), no un fallo de servidor — debe
// mapear a 403, distinto del catch-all 500 que usan los demás DB_ERROR.

Deno.test("agencia_suspendida_retorna_403_no_500", async () => {
  const publisher = publisher_error("AGENCY_MEMBERSHIP_SUSPENDED");
  const res = await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(res.status, 403, "AGENCY_MEMBERSHIP_SUSPENDED es un 403 tipado, no un 500 genérico");
});

Deno.test("agencia_suspendida_error_code_correcto", async () => {
  const publisher = publisher_error("AGENCY_MEMBERSHIP_SUSPENDED");
  const res = await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  const body = await res.json();
  assertEquals(body.error.code, "AGENCY_MEMBERSHIP_SUSPENDED");
});

Deno.test("otro_error_del_publisher_sigue_siendo_500", async () => {
  // No-regresión: el mapeo nuevo es específico a AGENCY_MEMBERSHIP_SUSPENDED,
  // cualquier otro error_code (p.ej. DB_ERROR genérico) sigue cayendo en 500.
  const publisher = publisher_error("ALGUN_OTRO_ERROR_DESCONOCIDO");
  const res = await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(res.status, 500);
});

// ── 73.4 (absorbe 73.5) — pending_review + pipeline de moderación + slot ──────
//
// SEAM bajo prueba (comportamiento observable del contrato del handler, NO
// internals): el shape del request/response HTTP y CUÁNDO se invoca cada dep
// inyectada (videoStatusChecker, duplicatePropertyChecker, propertyPublisher).
//
// PRD §14.2: en beta, TODA publicación (registrado o agente/premium) va a
// pending_review — ya NO existe el auto-aprobar a 'active'.
// PRD §15.2 (pipeline de moderación): validar que el video exista, dure dentro
// del límite permitido (60-120s) y se pueda reproducir (ready); evitar
// duplicados obvios por misma dirección + mismo agente.
//
// EDGE CASES (RED) — 73.4:
//
// ### Contrato de estado
// - publisher recibe property_status='pending_review' (ya NO 'active') — PRD §14.2
//
// ### Pipeline — videoStatusChecker (PRD §15.2)
// - video checker responde VIDEO_NOT_READY → 409, publisher NUNCA llamado (no gastar el slot)
// - duration < 60 (VIDEO_DURATION_INVALID) → 400
// - duration > 120 (VIDEO_DURATION_INVALID) → 400
// - duration = 60 EXACTO (boundary) → válido, publica normalmente
// - duration = 120 EXACTO (boundary) → válido, publica normalmente
// - video no encontrado (VIDEO_NOT_FOUND) → 404, publisher NUNCA llamado
// - checker.check() recibe cloudflare_uid del payload + agent_id del caller verificado
//
// ### Pipeline — duplicatePropertyChecker (PRD §15.2, regla exacta en types.ts)
// - mismo owner + misma dirección → 409 DUPLICATE_PROPERTY, publisher NUNCA llamado
// - checker.check() recibe user_id del caller verificado + address del payload
// - distinto owner + mismo address → NO es duplicado, permite publicar
// - mismo owner + dirección distinta → NO es duplicado, permite publicar
// - propiedad previa rechazada/eliminada del mismo owner+address → NO cuenta como duplicado
//
// ### Orden de ejecución (evita gastar el slot en una publicación rechazada)
// - happy path: videoStatusChecker se invoca ANTES que duplicatePropertyChecker
// - si el video falla su validación: duplicatePropertyChecker y propertyPublisher NUNCA se llaman

import type {
  DuplicateCheckResult,
  DuplicatePropertyChecker,
  VideoStatusCheckResult,
  VideoStatusChecker,
} from "./types.ts";

// ── Factories de fakes — VideoStatusChecker ───────────────────────────────────

interface FakeVideoStatusChecker extends VideoStatusChecker {
  calls: { cloudflare_uid: string; agent_id: string }[];
}

function video_checker_ok(
  duration_seconds = 90,
  order_log?: string[],
): FakeVideoStatusChecker {
  return {
    calls: [],
    check(
      cloudflare_uid: string,
      agent_id: string,
    ): Promise<VideoStatusCheckResult> {
      order_log?.push("video_check");
      this.calls.push({ cloudflare_uid, agent_id });
      return Promise.resolve({ ok: true, duration_seconds });
    },
  } as FakeVideoStatusChecker;
}

function video_checker_error(
  error_code: "VIDEO_NOT_READY" | "VIDEO_DURATION_INVALID" | "VIDEO_NOT_FOUND",
): FakeVideoStatusChecker {
  return {
    calls: [],
    check(
      cloudflare_uid: string,
      agent_id: string,
    ): Promise<VideoStatusCheckResult> {
      this.calls.push({ cloudflare_uid, agent_id });
      return Promise.resolve({ ok: false, error_code });
    },
  } as FakeVideoStatusChecker;
}

// ── Factories de fakes — DuplicatePropertyChecker ─────────────────────────────

interface FakeDuplicatePropertyChecker extends DuplicatePropertyChecker {
  calls: { user_id: string; address: string }[];
}

function duplicate_checker_result(
  isDuplicate: boolean,
  order_log?: string[],
): FakeDuplicatePropertyChecker {
  return {
    calls: [],
    check(user_id: string, address: string): Promise<DuplicateCheckResult> {
      order_log?.push("duplicate_check");
      this.calls.push({ user_id, address });
      return Promise.resolve({ isDuplicate });
    },
  } as FakeDuplicatePropertyChecker;
}

// ── deps_validos extendido: agrega los 2 checkers nuevos con defaults OK ──────
// (Redeclarado localmente porque PublishPropertyDeps ahora exige ambos campos;
// no se toca la factory original de arriba para no romper su firma histórica.)

function deps_pipeline(opts: {
  publisher?: PropertyPublisher;
  verifier?: CallerVerifier;
  videoChecker?: VideoStatusChecker;
  duplicateChecker?: DuplicatePropertyChecker;
} = {}): PublishPropertyDeps {
  return {
    callerVerifier: opts.verifier ?? verifier_agente_ok(),
    propertyPublisher: opts.publisher ?? publisher_ok(),
    videoStatusChecker: opts.videoChecker ?? video_checker_ok(),
    duplicatePropertyChecker: opts.duplicateChecker ??
      duplicate_checker_result(false),
  };
}

// ── Pipeline — videoStatusChecker (PRD §15.2) ─────────────────────────────────

Deno.test("pipeline_video_no_listo_retorna_409_y_bloquea_publisher", async () => {
  const publisher = publisher_ok();
  const videoChecker = video_checker_error("VIDEO_NOT_READY");
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, videoChecker }),
  );
  assertEquals(res.status, 409, "video aún no listo (processing) debe bloquear con 409");
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_NOT_READY");
  assertEquals(
    publisher.calls.length,
    0,
    "publisher NO debe llamarse si el video no está listo (no gastar el slot en una publicación que se va a rechazar)",
  );
});

Deno.test("pipeline_video_duracion_menor_al_minimo_retorna_400_duration_invalid", async () => {
  // Simula un video de 5s: fuera del rango [10,120] (#149; antes [60,120]).
  const videoChecker = video_checker_error("VIDEO_DURATION_INVALID");
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ videoChecker }),
  );
  assertEquals(res.status, 400, "duration_seconds < 10 debe rechazarse con 400");
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_DURATION_INVALID");
});

Deno.test("pipeline_video_duracion_mayor_a_120_retorna_400_duration_invalid", async () => {
  // Simula un video de 150s: fuera del rango [60,120] del PRD §14 paso 5.
  const videoChecker = video_checker_error("VIDEO_DURATION_INVALID");
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ videoChecker }),
  );
  assertEquals(res.status, 400, "duration_seconds > 120 debe rechazarse con 400");
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_DURATION_INVALID");
});

Deno.test("pipeline_video_duracion_exactamente_10_boundary_es_valida_y_publica", async () => {
  // #149: el límite inferior bajó de 60 a 10 s.
  const publisher = publisher_ok();
  const videoChecker = video_checker_ok(10);
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, videoChecker }),
  );
  assertEquals(res.status, 201, "duration_seconds = 10 es el límite INFERIOR inclusive — válido");
  assertEquals(publisher.calls.length, 1);
});

Deno.test("pipeline_video_duracion_exactamente_120_boundary_es_valida_y_publica", async () => {
  const publisher = publisher_ok();
  const videoChecker = video_checker_ok(120);
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, videoChecker }),
  );
  assertEquals(res.status, 201, "duration_seconds = 120 es el límite SUPERIOR inclusive — válido");
  assertEquals(publisher.calls.length, 1);
});

Deno.test("pipeline_video_no_encontrado_retorna_404_y_bloquea_publisher", async () => {
  const publisher = publisher_ok();
  const videoChecker = video_checker_error("VIDEO_NOT_FOUND");
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, videoChecker }),
  );
  assertEquals(res.status, 404, "cloudflare_uid sin video en vuelo correspondiente debe ser 404");
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_NOT_FOUND");
  assertEquals(publisher.calls.length, 0);
});

Deno.test("pipeline_video_checker_recibe_cloudflare_uid_y_agent_id_correctos", async () => {
  const videoChecker = video_checker_ok();
  const verifier = verifier_agente_ok();
  await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ videoChecker, verifier }),
  );
  assertEquals(videoChecker.calls.length, 1);
  assertEquals(
    videoChecker.calls[0].cloudflare_uid,
    CLOUDFLARE_UID,
    "el checker debe recibir el cloudflare_uid del payload",
  );
  assertEquals(
    videoChecker.calls[0].agent_id,
    AGENT_ID,
    "el checker debe recibir el agent_id del caller verificado, no del payload",
  );
});

// ── Pipeline — duplicatePropertyChecker (PRD §15.2) ───────────────────────────

Deno.test("pipeline_duplicado_mismo_owner_misma_direccion_retorna_409_y_bloquea_publisher", async () => {
  const publisher = publisher_ok();
  const duplicateChecker = duplicate_checker_result(true);
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, duplicateChecker }),
  );
  assertEquals(res.status, 409, "duplicado obvio (mismo owner + misma dirección) debe bloquear con 409");
  const body = await res.json();
  assertEquals(body.error.code, "DUPLICATE_PROPERTY");
  assertEquals(
    publisher.calls.length,
    0,
    "publisher NO debe llamarse ante un duplicado (no gastar el slot)",
  );
});

Deno.test("pipeline_duplicado_checker_recibe_user_id_del_caller_y_address_del_payload", async () => {
  const duplicateChecker = duplicate_checker_result(false);
  const verifier = verifier_agente_ok();
  await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ duplicateChecker, verifier }),
  );
  assertEquals(duplicateChecker.calls.length, 1);
  assertEquals(
    duplicateChecker.calls[0].user_id,
    AGENT_ID,
    "el checker debe recibir el user_id del caller verificado, no del payload",
  );
  assertEquals(
    duplicateChecker.calls[0].address,
    PAYLOAD_VALIDO.address,
    "el checker debe recibir la dirección del payload",
  );
});

Deno.test("pipeline_distinto_owner_mismo_address_no_es_duplicado_permite_publicar", async () => {
  // Regla (types.ts): el duplicado exige MISMO owner_user_id. Dos agentes
  // publicando la misma dirección (p.ej. copropietarios, o coincidencia) no es
  // un duplicado obvio del mismo publicante.
  const publisher = publisher_ok();
  const duplicateChecker = duplicate_checker_result(false);
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, duplicateChecker }),
  );
  assertEquals(res.status, 201);
  assertEquals(publisher.calls.length, 1);
});

Deno.test("pipeline_mismo_owner_direccion_distinta_no_es_duplicado_permite_publicar", async () => {
  // Regla (types.ts): el duplicado exige MISMA dirección normalizada. El mismo
  // agente publicando una propiedad distinta no es un duplicado.
  const publisher = publisher_ok();
  const duplicateChecker = duplicate_checker_result(false);
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, duplicateChecker }),
  );
  assertEquals(res.status, 201);
  assertEquals(publisher.calls.length, 1);
});

Deno.test("pipeline_propiedad_previa_rechazada_o_eliminada_no_cuenta_como_duplicado_permite_publicar", async () => {
  // Regla (types.ts): status NOT IN ('rejected','deleted_soft','deleted_hard') —
  // una publicación previa rechazada o eliminada del mismo owner+dirección NO
  // bloquea: el agente puede resubir.
  const publisher = publisher_ok();
  const duplicateChecker = duplicate_checker_result(false);
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, duplicateChecker }),
  );
  assertEquals(res.status, 201);
  assertEquals(publisher.calls.length, 1);
});

// ── Orden de ejecución (no gastar el slot en una publicación rechazada) ──────

Deno.test("orden_video_check_ocurre_antes_que_duplicate_check_en_happy_path", async () => {
  const order: string[] = [];
  const videoChecker = video_checker_ok(90, order);
  const duplicateChecker = duplicate_checker_result(false, order);
  await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ videoChecker, duplicateChecker }),
  );
  assertEquals(
    order,
    ["video_check", "duplicate_check"],
    "el handler debe invocar videoStatusChecker ANTES que duplicatePropertyChecker",
  );
});

Deno.test("orden_video_falla_nunca_llama_duplicate_checker_ni_publisher", async () => {
  const publisher = publisher_ok();
  const videoChecker = video_checker_error("VIDEO_NOT_READY");
  const duplicateChecker = duplicate_checker_result(false);
  await handler(
    post_agente(PAYLOAD_VALIDO),
    deps_pipeline({ publisher, videoChecker, duplicateChecker }),
  );
  assertEquals(
    duplicateChecker.calls.length,
    0,
    "duplicatePropertyChecker NUNCA debe llamarse si el video falla su validación",
  );
  assertEquals(
    publisher.calls.length,
    0,
    "propertyPublisher NUNCA debe llamarse si el video falla su validación",
  );
});

// ── Atomicidad — propiedad + video en tx única ────────────────────────────────
//
// CONTRATO:
//   La implementación GREEN usará una RPC (publish_property_atomic) que inserta
//   properties + property_videos en una única transacción PostgreSQL.
//   Si falla el INSERT de property_videos, el INSERT de properties hace ROLLBACK.
//   No puede quedar una properties.status='active' sin su property_videos asociado.
//
// COBERTURA DE ESTE TEST:
//   - Handler delega en publisher.publish() de forma unitaria (una llamada)
//   - Si publisher devuelve error, el handler NO devuelve property_id
//   - La atomicidad real (rollback en DB) se verifica en supabase/tests/ con pgTAP
//     cuando se implemente la RPC publish_property_atomic.

Deno.test("atomicidad_publisher_falla_respuesta_no_contiene_property_id", async () => {
  const publisher = publisher_error("DB_ERROR");
  const res = await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  // El publisher DEBE haber sido llamado (es quien falla, no el stub)
  // En RED esto falla porque el stub nunca llama al publisher
  assertEquals(
    publisher.calls.length,
    1,
    "publisher debe ser invocado; si falla en DB no en validación/auth",
  );
  // Cuando el publisher falla, la respuesta no debe incluir property_id
  assertEquals(res.status >= 400, true, "fallo del publisher debe resultar en status de error");
  const body = await res.json();
  assertEquals(
    body.property_id,
    undefined,
    "property_id NO debe estar en la respuesta cuando el publisher falla (atomicidad: sin property_id parcial)",
  );
});
