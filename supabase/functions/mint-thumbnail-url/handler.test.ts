// supabase/functions/mint-thumbnail-url/handler.test.ts
// Tests RED — subtarea 68.14 (Épica B Stream, thumbnail picker)
// Edge Function: mint-thumbnail-url/handler.ts — mintea baseUrl + token RS256 para
// pedir frames de thumbnail de Cloudflare Stream (UN token cubre todos los ?time=<Ns>).
// Framework: Deno.test + @std/assert
// Runner: cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//         --config deno.json mint-thumbnail-url/handler.test.ts
//
// SEAMS (interfaz bajo test):
// - Contrato público HTTP del handler(req, deps?): request → status + body JSON.
// - CallerVerifier.verify_caller (DI, fake) — frontera JWT; el uid SIEMPRE sale de aquí,
//   nunca del body.
// - ThumbnailVideoLoader.load (DI, fake) — frontera de lectura en DB (ownership + estado +
//   duración); NUNCA DB real.
// - ThumbnailUrlSigner.sign (DI, fake DETERMINISTA aquí) — frontera de firma RS256; la
//   firma REAL con jose se verifica aparte en _shared/thumbnail_url_signer.test.ts para que
//   no sea tautológica.
//
// EDGE CASES (RED) — 68.14:
//
// ### Happy path
// - owner por agent_id, status='ready' → 200 con { baseUrl, token, durationSeconds,
//   expiresIn } = pass-through EXACTO de lo que devuelve el signer + duration_seconds de
//   la fila cargada
// - urlSigner.sign se llama exactamente una vez con el cloudflare_uid del body
// - vía propiedad linkeada (agent_id null, property_owner_id = caller) → 200
//
// ### Ownership fail-closed (403, sin mintar token)
// - agent_id != caller Y property_owner_id != caller → 403 FORBIDDEN_NOT_OWNER
// - ajeno: urlSigner.sign NO se llama (cero tokens filtrados)
//
// ### Video inexistente / estado no minteable → 404, sin mintar token
// - loader → null (cloudflare_uid desconocido) → 404 VIDEO_NOT_FOUND
// - status='failed' → 404 VIDEO_NOT_FOUND
// - status='archived' (cloudflare_uid ya NULL en la fila) → 404 VIDEO_NOT_FOUND
// - en los 3 casos: urlSigner.sign NO se llama
//
// ### processing sirve el default (durationSeconds puede ser null)
// - status='processing', duration_seconds=null → 200, durationSeconds === null
//
// ### Body inválido → 400, sin llamar loader ni signer
// - cloudflare_uid ausente del body → 400
// - cloudflare_uid = "" (vacío) → 400
//
// ### Auth (frontera de confianza, fail-closed)
// - sin header Authorization → 401 UNAUTHENTICATED
// - JWT inválido (callerVerifier ok:false) → 401 UNAUTHENTICATED
// - JWT inválido: ni loader ni signer se llaman (fail-closed real)
//
// ### Config de firma ausente → 500, NUNCA URL sin firmar
// - urlSigner.sign lanza (falta JWK/config) → 500 INTERNAL_ERROR
// - la respuesta 500 NO trae baseUrl ni token
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
  CallerVerifier,
  CallerVerifyResult,
  MintThumbnailUrlDeps,
  ThumbnailSignResult,
  ThumbnailUrlSigner,
  ThumbnailVideoLoader,
  ThumbnailVideoRow,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const AGENT_UID = "00000000-0000-0000-0000-000000000001";
const OTHER_UID = "00000000-0000-0000-0000-000000000099";
const CF_UID = "cf-uid-standard-000000000001";

const SIGN_RESULT: ThumbnailSignResult = {
  baseUrl: `https://customer-abc123.cloudflarestream.com/${CF_UID}/thumbnails/thumbnail.jpg`,
  token: "fake.thumbnail.token",
  expiresIn: 14400,
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

// ── Fakes — ThumbnailVideoLoader ──────────────────────────────────────────────

interface FakeThumbnailVideoLoader extends ThumbnailVideoLoader {
  calls: string[];
}

function loader_returns(row: ThumbnailVideoRow | null): FakeThumbnailVideoLoader {
  return {
    calls: [],
    load(cloudflare_uid: string): Promise<ThumbnailVideoRow | null> {
      this.calls.push(cloudflare_uid);
      return Promise.resolve(row);
    },
  } as FakeThumbnailVideoLoader;
}

function make_row(overrides: Partial<ThumbnailVideoRow> = {}): ThumbnailVideoRow {
  return {
    agent_id: AGENT_UID,
    property_owner_id: null,
    status: "ready",
    cloudflare_uid: CF_UID,
    duration_seconds: 125,
    ...overrides,
  };
}

// ── Fakes — ThumbnailUrlSigner ─────────────────────────────────────────────────

interface FakeThumbnailUrlSigner extends ThumbnailUrlSigner {
  calls: string[];
}

function signer_ok(result: ThumbnailSignResult): FakeThumbnailUrlSigner {
  return {
    calls: [],
    sign(cloudflare_uid: string): Promise<ThumbnailSignResult> {
      this.calls.push(cloudflare_uid);
      return Promise.resolve(result);
    },
  } as FakeThumbnailUrlSigner;
}

function signer_throws(): FakeThumbnailUrlSigner {
  return {
    calls: [],
    sign(cloudflare_uid: string): Promise<ThumbnailSignResult> {
      this.calls.push(cloudflare_uid);
      return Promise.reject(new Error("faltan STREAM_SIGNING_KEY_ID / STREAM_SIGNING_JWK"));
    },
  } as FakeThumbnailUrlSigner;
}

// ── Helpers de Request/Deps ───────────────────────────────────────────────────

function post_request(
  body: Record<string, unknown> | undefined = { cloudflare_uid: CF_UID },
  with_auth = true,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/mint-thumbnail-url", {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/mint-thumbnail-url", {
    method,
    headers: { Authorization: "Bearer fake.jwt.token" },
  });
}

function make_deps(overrides: Partial<MintThumbnailUrlDeps> = {}): MintThumbnailUrlDeps {
  return {
    callerVerifier: caller_ok(AGENT_UID),
    videoLoader: loader_returns(make_row()),
    urlSigner: signer_ok(SIGN_RESULT),
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("happy_owner_por_agent_id_ready_retorna_200_con_shape_exacto_pass_through_del_signer", async () => {
  const deps = make_deps({
    videoLoader: loader_returns(make_row({ duration_seconds: 125 })),
    urlSigner: signer_ok(SIGN_RESULT),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.baseUrl, SIGN_RESULT.baseUrl, "baseUrl debe ser el pass-through exacto del signer");
  assertEquals(body.token, SIGN_RESULT.token, "token debe ser el pass-through exacto del signer");
  assertEquals(body.expiresIn, SIGN_RESULT.expiresIn, "expiresIn debe ser el pass-through exacto del signer");
  assertEquals(body.durationSeconds, 125, "durationSeconds debe ser el duration_seconds de la fila cargada");
});

Deno.test("happy_url_signer_se_llama_exactamente_una_vez_con_el_cloudflare_uid_del_body", async () => {
  const signer = signer_ok(SIGN_RESULT);
  const deps = make_deps({ urlSigner: signer });
  await handler(post_request({ cloudflare_uid: CF_UID }), deps);
  assertEquals(signer.calls.length, 1, "el signer debe llamarse exactamente una vez");
  assertEquals(signer.calls[0], CF_UID, "el signer debe recibir el cloudflare_uid del body");
});

Deno.test("happy_via_propiedad_linkeada_agent_id_null_property_owner_id_caller_retorna_200", async () => {
  const deps = make_deps({
    videoLoader: loader_returns(
      make_row({ agent_id: null, property_owner_id: AGENT_UID }),
    ),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "el owner de la propiedad linkeada debe poder mintar aunque no sea el agent_id");
});

// ── Ownership fail-closed (403, sin mintar token) ─────────────────────────────

Deno.test("ajeno_agent_id_distinto_y_no_owner_de_propiedad_retorna_403_forbidden_not_owner", async () => {
  const deps = make_deps({
    videoLoader: loader_returns(
      make_row({ agent_id: OTHER_UID, property_owner_id: OTHER_UID }),
    ),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN_NOT_OWNER");
});

Deno.test("ajeno_no_llama_a_url_signer_cero_tokens_filtrados", async () => {
  const signer = signer_ok(SIGN_RESULT);
  const deps = make_deps({
    videoLoader: loader_returns(
      make_row({ agent_id: OTHER_UID, property_owner_id: OTHER_UID }),
    ),
    urlSigner: signer,
  });
  await handler(post_request(), deps);
  assertEquals(signer.calls.length, 0, "un caller ajeno NUNCA debe obtener un token firmado");
});

// ── Video inexistente / estado no minteable → 404 ─────────────────────────────

Deno.test("cloudflare_uid_inexistente_loader_null_retorna_404_video_not_found", async () => {
  const signer = signer_ok(SIGN_RESULT);
  const deps = make_deps({ videoLoader: loader_returns(null), urlSigner: signer });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_NOT_FOUND");
  assertEquals(signer.calls.length, 0, "un video inexistente NUNCA debe mintar token");
});

Deno.test("status_failed_retorna_404_video_not_found", async () => {
  const signer = signer_ok(SIGN_RESULT);
  const deps = make_deps({
    videoLoader: loader_returns(make_row({ status: "failed" })),
    urlSigner: signer,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_NOT_FOUND");
  assertEquals(signer.calls.length, 0);
});

Deno.test("status_archived_con_cloudflare_uid_null_retorna_404_video_not_found", async () => {
  // archivar limpia cloudflare_uid (mark_archived, 68.8) — el signer nunca debe verse.
  const signer = signer_ok(SIGN_RESULT);
  const deps = make_deps({
    videoLoader: loader_returns(
      make_row({ status: "archived", cloudflare_uid: null }),
    ),
    urlSigner: signer,
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.error.code, "VIDEO_NOT_FOUND");
  assertEquals(signer.calls.length, 0);
});

// ── processing sirve el default (durationSeconds puede ser null) ────────────

Deno.test("status_processing_retorna_200_con_duration_seconds_null", async () => {
  const deps = make_deps({
    videoLoader: loader_returns(
      make_row({ status: "processing", duration_seconds: null }),
    ),
  });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 200, "processing debe servir el default (frame preview) igual que ready");
  const body = await res.json();
  assertEquals(body.durationSeconds, null, "duration_seconds aún no disponible mientras processing");
});

// ── Body inválido → 400 ────────────────────────────────────────────────────────

Deno.test("body_sin_cloudflare_uid_retorna_400", async () => {
  const loader = loader_returns(make_row());
  const signer = signer_ok(SIGN_RESULT);
  const deps = make_deps({ videoLoader: loader, urlSigner: signer });
  const res = await handler(post_request({}), deps);
  assertEquals(res.status, 400);
  assertEquals(loader.calls.length, 0, "sin cloudflare_uid no debe consultarse el loader");
  assertEquals(signer.calls.length, 0, "sin cloudflare_uid no debe llamarse al signer");
});

Deno.test("body_con_cloudflare_uid_vacio_retorna_400", async () => {
  const deps = make_deps();
  const res = await handler(post_request({ cloudflare_uid: "" }), deps);
  assertEquals(res.status, 400);
});

// ── Auth (frontera de confianza, fail-closed) ─────────────────────────────────

Deno.test("sin_authorization_header_retorna_401_unauthenticated", async () => {
  const res = await handler(post_request(undefined, false), make_deps());
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

Deno.test("jwt_invalido_no_llama_a_loader_ni_a_signer", async () => {
  const loader = loader_returns(make_row());
  const signer = signer_ok(SIGN_RESULT);
  const deps = make_deps({
    callerVerifier: caller_unauthenticated(),
    videoLoader: loader,
    urlSigner: signer,
  });
  await handler(post_request(), deps);
  assertEquals(loader.calls.length, 0, "sin auth válida no debe consultarse el video");
  assertEquals(signer.calls.length, 0, "sin auth válida no debe firmarse ningún token");
});

// ── Config de firma ausente → 500, NUNCA URL sin firmar ───────────────────────

Deno.test("signer_lanza_falta_config_de_firma_retorna_500_internal_error", async () => {
  const deps = make_deps({ urlSigner: signer_throws() });
  const res = await handler(post_request(), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

Deno.test("signer_lanza_respuesta_500_no_trae_baseurl_ni_token", async () => {
  const deps = make_deps({ urlSigner: signer_throws() });
  const res = await handler(post_request(), deps);
  const body = await res.json();
  assertEquals(body.baseUrl, undefined, "fail-closed: nunca debe filtrarse una baseUrl sin firmar");
  assertEquals(body.token, undefined, "fail-closed: nunca debe filtrarse un token a medio construir");
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
  const res = await handler(post_request(undefined, false), make_deps());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertExists(body.error, "respuesta de error debe tener campo 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});
