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
  return { callerVerifier: verifier, propertyPublisher: publisher };
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

Deno.test("happy_path_publisher_recibe_property_status_active", async () => {
  const publisher = publisher_ok();
  await handler(post_agente(PAYLOAD_VALIDO), deps_validos(publisher));
  assertEquals(
    publisher.calls[0].property_status,
    "active",
    "property_status debe ser 'active' — la publicación activa directamente (auto-aprobación, PRD §12)",
  );
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
  await handler(post_agente(PAYLOAD_VALIDO), { callerVerifier: verifier, propertyPublisher: publisher });
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
    { callerVerifier: verifier, propertyPublisher: publisher_ok() },
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_retorna_401_unauthenticated", async () => {
  const verifier = verifier_unauthenticated();
  const res = await handler(
    post_agente(PAYLOAD_VALIDO),
    { callerVerifier: verifier, propertyPublisher: publisher_ok() },
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
    { callerVerifier: verifier, propertyPublisher: publisher_ok() },
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
    { callerVerifier: verifier_forbidden(), propertyPublisher: publisher },
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
