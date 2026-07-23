// supabase/functions/mint-poster-urls/handler.test.ts
// Tests RED — subtarea 89.1 (EF mint-poster-urls, batch, auth dueño-o-activo,
// fail-closed por item)
// Edge Function: mint-poster-urls/handler.ts — orquestación HTTP pura.
// Framework: Deno.test + @std/assert
// Runner: cd supabase/functions && deno test --allow-env --allow-net --allow-read \
//         --config deno.json mint-poster-urls/handler.test.ts
//
// SEAMS (interfaz bajo test):
// - Contrato público HTTP del handler(req, deps?): request → status + body JSON
//   ({ posters: [...] } en 200, { error: { code, message } } en error).
// - CallerVerifier.verify_caller (DI, fake) — frontera JWT; el uid SIEMPRE sale de
//   aquí, nunca del body.
// - PosterUrlMinter.mint_posters (DI, fake DETERMINISTA aquí) — frontera de
//   autorización por-item (owner-o-active) + firma; la autorización real
//   (owner/active/status/cloudflare_uid/time/token-en-path) y la firma REAL con
//   jose se verifican aparte en _shared/poster_url_minter.test.ts para que no sea
//   tautológica. El handler solo orquesta HTTP + pasa-a-través el resultado del
//   minter tal cual.
//
// EDGE CASES (RED) — 89.1 (handler, orquestación HTTP):
//
// ### Happy path / pass-through
// - property_ids con posters devueltos por el minter → 200 con posters pass-through exacto
// - batch de varios property_ids → 200 con el subconjunto exacto que devuelve el minter
// - minter llamado exactamente una vez con (property_ids, caller.user_id)
//
// ### property_ids vacío (89.1: caso 10 del contrato)
// - property_ids = [] → 200 { posters: [] }; el handler NO debe fallar la validación
//   (a diferencia de mint-video-url, [] es válido aquí)
//
// ### Exclusión por-item pass-through (el minter ya filtró; el handler no re-filtra)
// - minter devuelve subconjunto (batch parcial de omitidos) → 200 con ese subconjunto,
//   sin error, sin 404 parcial
//
// ### Auth (frontera de confianza, fail-closed) — casos 11
// - sin header Authorization → 401 UNAUTHENTICATED, minter NUNCA se llama
// - callerVerifier ok:false (JWT inválido) → 401 UNAUTHENTICATED, minter NUNCA se llama
//
// ### Método HTTP — caso 12
// - GET → 405 METHOD_NOT_ALLOWED
// - PUT → 405 METHOD_NOT_ALLOWED
//
// ### CORS
// - OPTIONS → 200-204 con header Access-Control-Allow-Origin
//
// ### Body / parse / validación de input
// - body no-JSON → 400 INVALID_INPUT
// - payload {} (property_ids ausente) → 400 INVALID_INPUT
// - property_ids es string (no array) → 400 INVALID_INPUT
// - property_ids con elemento no-string (número) → 400 INVALID_INPUT
// - property_ids con elemento cadena vacía → 400 INVALID_INPUT
//
// ### Fallo del minter (defensivo — el adapter real nunca debe lanzar, pero el
// handler no debe propagar una excepción cruda si ocurriera)
// - minter lanza Error → 500 INTERNAL_ERROR
//
// ### Boundary
// - deps undefined → 500 INTERNAL_ERROR (nunca propagar excepción cruda)
//
// ### Forma invariante — caso 13
// - respuesta 200 tiene forma { posters: [...] }
// - respuesta de error sigue { error: { code: string, message: string } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  MintedPoster,
  MintPosterUrlsDeps,
  PosterUrlMinter,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const CALLER_UID = "00000000-0000-0000-0000-000000000001";
const PROP_ID_1 = "00000000-0000-0000-0000-000000000101";
const PROP_ID_2 = "00000000-0000-0000-0000-000000000102";
const PROP_ID_3 = "00000000-0000-0000-0000-000000000103";

const POSTER_1: MintedPoster = {
  property_id: PROP_ID_1,
  posterUrl: "https://videodelivery.net/fake-token-1/thumbnails/thumbnail.jpg?time=46.0s",
};
const POSTER_2: MintedPoster = {
  property_id: PROP_ID_2,
  posterUrl: "https://videodelivery.net/fake-token-2/thumbnails/thumbnail.jpg?time=40.0s",
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

// ── Fakes — PosterUrlMinter ───────────────────────────────────────────────────

interface FakePosterUrlMinter extends PosterUrlMinter {
  calls: Array<{ property_ids: string[]; caller_id: string }>;
}

function minter_ok(result: MintedPoster[]): FakePosterUrlMinter {
  return {
    calls: [],
    mint_posters(property_ids: string[], caller_id: string): Promise<MintedPoster[]> {
      this.calls.push({ property_ids, caller_id });
      return Promise.resolve(result);
    },
  } as FakePosterUrlMinter;
}

function minter_throws(): FakePosterUrlMinter {
  return {
    calls: [],
    mint_posters(property_ids: string[], caller_id: string): Promise<MintedPoster[]> {
      this.calls.push({ property_ids, caller_id });
      return Promise.reject(new Error("firma inesperada"));
    },
  } as FakePosterUrlMinter;
}

// ── Helpers de Request/Deps ───────────────────────────────────────────────────

function post_request(
  body: unknown,
  with_auth = true,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/mint-poster-urls", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function raw_post_request(raw_body: string, with_auth = true): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/mint-poster-urls", {
    method: "POST",
    headers,
    body: raw_body,
  });
}

function method_request(method: string): Request {
  return new Request("http://localhost/mint-poster-urls", {
    method,
    headers: { Authorization: "Bearer fake.jwt.token" },
  });
}

function make_deps(overrides: Partial<MintPosterUrlsDeps> = {}): MintPosterUrlsDeps {
  return {
    callerVerifier: caller_ok(CALLER_UID),
    posterUrlMinter: minter_ok([POSTER_1]),
    ...overrides,
  };
}

// ── Happy path / pass-through ─────────────────────────────────────────────────

Deno.test("happy_un_property_id_retorna_200_con_posters_pass_through_exacto", async () => {
  const deps = make_deps({ posterUrlMinter: minter_ok([POSTER_1]) });
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertExists(body.posters, "body debe tener campo 'posters'");
  assertEquals(body.posters.length, 1, "posters debe tener 1 elemento");
  assertEquals(body.posters[0].property_id, POSTER_1.property_id);
  assertEquals(body.posters[0].posterUrl, POSTER_1.posterUrl, "posterUrl debe ser el pass-through exacto del minter");
});

Deno.test("happy_batch_dos_property_ids_retorna_200_con_subconjunto_exacto_del_minter", async () => {
  const deps = make_deps({ posterUrlMinter: minter_ok([POSTER_1, POSTER_2]) });
  const res = await handler(
    post_request({ property_ids: [PROP_ID_1, PROP_ID_2, PROP_ID_3] }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.posters.length, 2, "posters debe tener exactamente los 2 que devolvió el minter (PROP_ID_3 fue omitido)");
});

Deno.test("happy_minter_llamado_exactamente_una_vez_con_property_ids_y_caller_id", async () => {
  const minter = minter_ok([POSTER_1, POSTER_2]);
  const deps = make_deps({ callerVerifier: caller_ok(CALLER_UID), posterUrlMinter: minter });
  const ids = [PROP_ID_1, PROP_ID_2];
  await handler(post_request({ property_ids: ids }), deps);
  assertEquals(minter.calls.length, 1, "el minter debe ser llamado exactamente una vez");
  assertEquals(minter.calls[0].property_ids, ids, "el minter debe recibir el array exacto de property_ids");
  assertEquals(minter.calls[0].caller_id, CALLER_UID, "el minter debe recibir el uid del caller autenticado");
});

// ── property_ids vacío (caso 10) ──────────────────────────────────────────────

Deno.test("property_ids_vacio_retorna_200_con_posters_vacio_sin_error_de_validacion", async () => {
  const deps = make_deps({ posterUrlMinter: minter_ok([]) });
  const res = await handler(post_request({ property_ids: [] }), deps);
  assertEquals(res.status, 200, "[] debe ser válido para mint-poster-urls, a diferencia de mint-video-url");
  const body = await res.json();
  assertEquals(body.posters, [], "posters debe ser [] cuando property_ids es []");
});

// ── Exclusión pass-through (batch parcial de omitidos) ────────────────────────

Deno.test("exclusion_batch_parcial_el_minter_ya_filtro_handler_no_re_filtra", async () => {
  // El minter ya aplicó fail-closed por-item (no dueño+no activo, sin video ready,
  // sin cloudflare_uid, error de firma); el handler solo pasa el resultado.
  const deps = make_deps({ posterUrlMinter: minter_ok([POSTER_2]) });
  const res = await handler(
    post_request({ property_ids: [PROP_ID_1, PROP_ID_2, PROP_ID_3] }),
    deps,
  );
  assertEquals(res.status, 200, "batch parcial debe ser 200, nunca 404 parcial");
  const body = await res.json();
  assertEquals(body.posters.length, 1);
  assertEquals(body.posters[0].property_id, PROP_ID_2);
});

// ── Auth (frontera de confianza, fail-closed) — caso 11 ───────────────────────

Deno.test("sin_authorization_header_retorna_401_unauthenticated_minter_no_se_llama", async () => {
  const minter = minter_ok([POSTER_1]);
  const deps = make_deps({ posterUrlMinter: minter });
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }, false), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(minter.calls.length, 0, "sin auth válida el minter NUNCA debe llamarse");
});

Deno.test("jwt_invalido_callerVerifier_falla_retorna_401_unauthenticated_minter_no_se_llama", async () => {
  const minter = minter_ok([POSTER_1]);
  const deps = make_deps({ callerVerifier: caller_unauthenticated(), posterUrlMinter: minter });
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), deps);
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
  assertEquals(minter.calls.length, 0, "JWT inválido: el minter NUNCA debe llamarse (fail-closed real)");
});

// ── Método HTTP — caso 12 ─────────────────────────────────────────────────────

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

// ── Body / parse / validación de input ───────────────────────────────────────

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const res = await handler(raw_post_request("esto no es json{{{"), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("payload_vacio_property_ids_ausente_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({}), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_es_string_no_array_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({ property_ids: PROP_ID_1 }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_elemento_no_string_numero_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({ property_ids: [123, PROP_ID_2] }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("property_ids_elemento_cadena_vacia_retorna_400_invalid_input", async () => {
  const res = await handler(post_request({ property_ids: [PROP_ID_1, ""] }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

// ── Fallo del minter → 500 INTERNAL_ERROR (defensivo) ─────────────────────────

Deno.test("minter_lanza_error_handler_retorna_500_internal_error", async () => {
  const deps = make_deps({ posterUrlMinter: minter_throws() });
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(
    body.error.code,
    "INTERNAL_ERROR",
    "error.code debe ser INTERNAL_ERROR cuando el minter lanza — no propagar excepción cruda",
  );
});

// ── Boundary ──────────────────────────────────────────────────────────────────

Deno.test("deps_undefined_retorna_500_internal_error", async () => {
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }));
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

// ── Forma invariante — caso 13 ────────────────────────────────────────────────

Deno.test("respuesta_200_tiene_forma_posters_array", async () => {
  const res = await handler(post_request({ property_ids: [PROP_ID_1] }), make_deps());
  const body = await res.json();
  assertEquals(Array.isArray(body.posters), true, "body.posters debe ser un array");
});

Deno.test("error_respuesta_tiene_forma_error_code_message", async () => {
  const res = await handler(post_request({}), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error, "respuesta de error debe tener campo 'error'");
  assertEquals(typeof body.error.code, "string", "error.code debe ser string");
  assertEquals(typeof body.error.message, "string", "error.message debe ser string");
});
