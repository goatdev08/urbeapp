// supabase/functions/mint-r2-url/handler.test.ts
// Tests RED — subtarea 69.2
// Edge Function: mint-r2-url/handler.ts (presigned PUT/GET contra Cloudflare R2)
// Framework: Deno.test + @std/assert
// Runner: deno test --allow-net supabase/functions/mint-r2-url/handler.test.ts
//         (desde el repo raíz, con el import map de supabase/functions/deno.json)
//
// SEAMS (interfaz bajo test):
// - Contrato público HTTP del handler(req, deps?): request → status + body JSON.
// - CallerVerifier.verify_caller (DI, fake) — frontera JWT.
// - AgencyOwnershipVerifier.get_owned_agency_id (DI, fake) — frontera de ownership de agencia.
// - R2UrlMinter.sign_put / sign_get_batch (DI, fake) — frontera de firma; NUNCA red real.
//
// EDGE CASES (RED) — 69.2:
//
// ### Happy path
// - put avatar, key = prefix propio (avatars/<uid>/...) autenticado → 200 {url,key,expires=900}
// - put avatar, key ausente (se deriva) → 200 con key iniciando en avatars/<uid>/
// - put logo, key = prefix de la agencia que el caller posee (owner activo) → 200 {url,key,expires=900}
// - put logo, key ausente (se deriva de la agencia propia) → 200 con key iniciando en logos/<agency_id>/
// - get lote de 3 keys autenticado → 200 {urls:[...]} con 3 elementos, cada uno expires=3600
// - get 1 key → 200 urls.length === 1
// - put: minter.sign_put llamado exactamente una vez con el key exacto y ttl=900 (shape)
// - get: minter.sign_get_batch llamado exactamente una vez con el array exacto de keys y ttl=3600 (shape)
//
// ### CORS / métodos HTTP
// - OPTIONS → 200 con header Access-Control-Allow-Origin
// - GET (método HTTP) → 405
// - PUT (método HTTP) → 405 (no confundir con op="put" del body; solo POST transporta la EF)
//
// ### Body / parse / validación de input (400 INVALID_INPUT)
// - body no-JSON → 400
// - payload {} (kind y op ausentes) → 400
// - kind ausente → 400
// - kind no-string (número) → 400
// - kind con valor no permitido ('banner') → 400
// - op ausente → 400
// - op no-string (número) → 400
// - op con valor no permitido ('delete') → 400
// - op=get sin keys → 400
// - op=get con keys array vacío [] → 400
// - op=get con keys con elemento no-string → 400
// - op=get con keys con elemento cadena vacía → 400
// - op=put con key presente pero cadena vacía '' → 400
// - kind='archive' + op='get' con keys válidos → 200 (kind archive es válido para lectura)
//
// ### Autorización (frontera de confianza — fail-closed) — núcleo de esta subtarea
// 1. Sin Authorization header, op=put → 401 UNAUTHENTICATED
// 1b. Sin Authorization header, op=get → 401 UNAUTHENTICATED
// 1c. JWT inválido (callerVerifier falla) → 401 UNAUTHENTICATED
// 1d. Sin auth: ni agencyOwnershipVerifier ni minter son invocados (fail-closed real)
// 2. put avatar, key con uid AJENO (avatars/<otro_uid>/foto.jpg) → 403 FORBIDDEN
// 2b. put avatar, key con uid ajeno: el minter NO es invocado (autorización antes de firmar)
// 3. put logo, caller NO es owner de ninguna agencia (get_owned_agency_id→null) → 403 FORBIDDEN
// 3b. put logo, caller es owner de OTRA agencia (key con agency_id distinto al propio) → 403 FORBIDDEN
// 3c. put logo, caller no autorizado: el minter NO es invocado
// 4. get con JWT válido de un usuario sin ningún rol especial (no owner) → 200 (GET no exige ownership)
//
// ### Fallo interno → 500 INTERNAL_ERROR
// - minter.sign_put lanza Error → 500 INTERNAL_ERROR
// - minter.sign_get_batch lanza Error → 500 INTERNAL_ERROR
// - deps undefined → 500 INTERNAL_ERROR
//
// ### Forma invariante de errores
// - toda respuesta de error sigue { error: { code: string, message: string } }

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  AgencyOwnershipVerifier,
  CallerVerifier,
  CallerVerifyResult,
  MintR2UrlDeps,
  R2UrlMinter,
  SignedGetItem,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000001";
const OTRO_USER_ID = "00000000-0000-0000-0000-000000000099";
const AGENCY_ID = "00000000-0000-0000-0000-000000000010";
const OTRA_AGENCY_ID = "00000000-0000-0000-0000-000000000020";

const AVATAR_KEY_PROPIO = `avatars/${USER_ID}/foto.jpg`;
const AVATAR_KEY_AJENO = `avatars/${OTRO_USER_ID}/foto.jpg`;
const LOGO_KEY_PROPIO = `logos/${AGENCY_ID}/logo.png`;
const LOGO_KEY_AJENO = `logos/${OTRA_AGENCY_ID}/logo.png`;

const SIGNED_URL = "https://r2.example.com/signed-put?sig=abc";

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

// ── Fakes — AgencyOwnershipVerifier ──────────────────────────────────────────

interface FakeAgencyOwnershipVerifier extends AgencyOwnershipVerifier {
  calls: string[];
}

function agency_owner_of(agency_id: string | null): FakeAgencyOwnershipVerifier {
  return {
    calls: [],
    get_owned_agency_id(user_id: string): Promise<string | null> {
      this.calls.push(user_id);
      return Promise.resolve(agency_id);
    },
  } as FakeAgencyOwnershipVerifier;
}

// ── Fakes — R2UrlMinter ───────────────────────────────────────────────────────

interface FakeR2UrlMinter extends R2UrlMinter {
  put_calls: Array<{ key: string; ttl_seconds: number }>;
  get_calls: Array<{ keys: string[]; ttl_seconds: number }>;
}

function minter_ok(get_batch_result?: SignedGetItem[]): FakeR2UrlMinter {
  return {
    put_calls: [],
    get_calls: [],
    sign_put(key: string, ttl_seconds: number): Promise<string> {
      this.put_calls.push({ key, ttl_seconds });
      return Promise.resolve(SIGNED_URL);
    },
    sign_get_batch(
      keys: string[],
      ttl_seconds: number,
    ): Promise<SignedGetItem[]> {
      this.get_calls.push({ keys, ttl_seconds });
      const result = get_batch_result ?? keys.map((key) => ({
        key,
        url: `https://r2.example.com/signed-get/${key}`,
        expires: ttl_seconds,
      }));
      return Promise.resolve(result);
    },
  } as FakeR2UrlMinter;
}

function minter_put_throws(): FakeR2UrlMinter {
  return {
    put_calls: [],
    get_calls: [],
    sign_put(key: string, ttl_seconds: number): Promise<string> {
      this.put_calls.push({ key, ttl_seconds });
      return Promise.reject(new Error("r2 unavailable"));
    },
    sign_get_batch(
      keys: string[],
      ttl_seconds: number,
    ): Promise<SignedGetItem[]> {
      this.get_calls.push({ keys, ttl_seconds });
      return Promise.reject(new Error("r2 unavailable"));
    },
  } as FakeR2UrlMinter;
}

function minter_get_throws(): FakeR2UrlMinter {
  return {
    put_calls: [],
    get_calls: [],
    sign_put(key: string, ttl_seconds: number): Promise<string> {
      this.put_calls.push({ key, ttl_seconds });
      return Promise.resolve(SIGNED_URL);
    },
    sign_get_batch(
      keys: string[],
      ttl_seconds: number,
    ): Promise<SignedGetItem[]> {
      this.get_calls.push({ keys, ttl_seconds });
      return Promise.reject(new Error("r2 unavailable"));
    },
  } as FakeR2UrlMinter;
}

// ── Helpers de Request/Deps ───────────────────────────────────────────────────

function post_request(body: unknown, with_auth = true): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (with_auth) headers["Authorization"] = "Bearer fake.jwt.token";
  return new Request("http://localhost/mint-r2-url", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function post_request_no_auth(body: unknown): Request {
  return post_request(body, false);
}

function method_request(method: string): Request {
  return new Request("http://localhost/mint-r2-url", { method });
}

function make_deps(
  overrides: Partial<MintR2UrlDeps> = {},
): MintR2UrlDeps {
  return {
    callerVerifier: caller_ok(USER_ID),
    agencyOwnershipVerifier: agency_owner_of(AGENCY_ID),
    r2UrlMinter: minter_ok(),
    ...overrides,
  };
}

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("put_avatar_key_propio_autenticado_retorna_200_con_url_key_expires", async () => {
  const deps = make_deps();
  const res = await handler(
    post_request({ kind: "avatar", op: "put", key: AVATAR_KEY_PROPIO }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, SIGNED_URL);
  assertEquals(body.key, AVATAR_KEY_PROPIO);
  assertEquals(body.expires, 900, "TTL de PUT debe ser 900 segundos (15 min)");
});

Deno.test("put_avatar_sin_key_se_deriva_con_prefijo_propio", async () => {
  const deps = make_deps();
  const res = await handler(post_request({ kind: "avatar", op: "put" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(
    (body.key as string).startsWith(`avatars/${USER_ID}/`),
    true,
    "el key derivado debe empezar con avatars/<user_id>/",
  );
});

Deno.test("put_logo_key_de_agencia_propia_owner_activo_retorna_200", async () => {
  const deps = make_deps({ agencyOwnershipVerifier: agency_owner_of(AGENCY_ID) });
  const res = await handler(
    post_request({ kind: "logo", op: "put", key: LOGO_KEY_PROPIO }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, SIGNED_URL);
  assertEquals(body.key, LOGO_KEY_PROPIO);
  assertEquals(body.expires, 900);
});

Deno.test("put_logo_sin_key_se_deriva_con_prefijo_de_agencia_propia", async () => {
  const deps = make_deps({ agencyOwnershipVerifier: agency_owner_of(AGENCY_ID) });
  const res = await handler(post_request({ kind: "logo", op: "put" }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(
    (body.key as string).startsWith(`logos/${AGENCY_ID}/`),
    true,
    "el key derivado debe empezar con logos/<agency_id>/ de la agencia propia",
  );
});

Deno.test("get_lote_tres_keys_autenticado_retorna_200_con_tres_urls_expires_3600", async () => {
  const deps = make_deps();
  const keys = [AVATAR_KEY_PROPIO, LOGO_KEY_PROPIO, "archive/x/original.mp4"];
  const res = await handler(post_request({ kind: "avatar", op: "get", keys }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.urls.length, 3, "urls debe tener 3 elementos para un lote de 3 keys");
  for (const item of body.urls) {
    assertEquals(item.expires, 3600, "TTL de GET debe ser 3600 segundos (1 h)");
  }
});

Deno.test("get_una_key_retorna_200_con_un_elemento", async () => {
  const deps = make_deps();
  const res = await handler(
    post_request({ kind: "avatar", op: "get", keys: [AVATAR_KEY_PROPIO] }),
    deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.urls.length, 1);
  assertEquals(body.urls[0].key, AVATAR_KEY_PROPIO);
});

Deno.test("put_minter_sign_put_llamado_una_vez_con_key_exacto_y_ttl_900", async () => {
  const m = minter_ok();
  const deps = make_deps({ r2UrlMinter: m });
  await handler(post_request({ kind: "avatar", op: "put", key: AVATAR_KEY_PROPIO }), deps);
  assertEquals(m.put_calls.length, 1, "sign_put debe ser llamado exactamente una vez");
  assertEquals(m.put_calls[0].key, AVATAR_KEY_PROPIO);
  assertEquals(m.put_calls[0].ttl_seconds, 900);
});

Deno.test("get_minter_sign_get_batch_llamado_una_vez_con_array_exacto_y_ttl_3600", async () => {
  const m = minter_ok();
  const deps = make_deps({ r2UrlMinter: m });
  const keys = [AVATAR_KEY_PROPIO, LOGO_KEY_PROPIO];
  await handler(post_request({ kind: "avatar", op: "get", keys }), deps);
  assertEquals(m.get_calls.length, 1, "sign_get_batch debe ser llamado exactamente una vez");
  assertEquals(m.get_calls[0].keys, keys, "debe recibir el array exacto de keys (shape)");
  assertEquals(m.get_calls[0].ttl_seconds, 3600);
});

// ── CORS / Métodos HTTP ───────────────────────────────────────────────────────

Deno.test("cors_options_preflight_retorna_200", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertEquals(res.status >= 200 && res.status <= 204, true, "OPTIONS debe retornar 200-204");
});

Deno.test("cors_options_tiene_header_access_control_allow_origin", async () => {
  const res = await handler(method_request("OPTIONS"));
  assertExists(
    res.headers.get("Access-Control-Allow-Origin"),
    "Preflight debe incluir Access-Control-Allow-Origin",
  );
});

Deno.test("metodo_http_get_retorna_405", async () => {
  const res = await handler(method_request("GET"));
  assertEquals(res.status, 405);
});

Deno.test("metodo_http_put_retorna_405", async () => {
  // Método HTTP PUT (transporte) != op:"put" del body; la EF solo acepta POST.
  const res = await handler(method_request("PUT"));
  assertEquals(res.status, 405);
});

// ── Body / parse / validación de input ───────────────────────────────────────

Deno.test("body_no_json_retorna_400_invalid_input", async () => {
  const req = new Request("http://localhost/mint-r2-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer x" },
    body: "esto no es json{{{",
  });
  const res = await handler(req, make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("payload_vacio_kind_y_op_ausentes_retorna_400", async () => {
  const res = await handler(post_request({}), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("kind_ausente_retorna_400", async () => {
  const res = await handler(post_request({ op: "put", key: AVATAR_KEY_PROPIO }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("kind_no_string_numero_retorna_400", async () => {
  const res = await handler(post_request({ kind: 42, op: "put" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("kind_valor_no_permitido_banner_retorna_400", async () => {
  const res = await handler(post_request({ kind: "banner", op: "put" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_ausente_retorna_400", async () => {
  const res = await handler(post_request({ kind: "avatar" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_no_string_numero_retorna_400", async () => {
  const res = await handler(post_request({ kind: "avatar", op: 1 }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_valor_no_permitido_delete_retorna_400", async () => {
  const res = await handler(post_request({ kind: "avatar", op: "delete" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_get_sin_keys_retorna_400", async () => {
  const res = await handler(post_request({ kind: "avatar", op: "get" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_get_keys_array_vacio_retorna_400", async () => {
  const res = await handler(post_request({ kind: "avatar", op: "get", keys: [] }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_get_keys_con_elemento_no_string_retorna_400", async () => {
  const res = await handler(
    post_request({ kind: "avatar", op: "get", keys: [AVATAR_KEY_PROPIO, 123] }),
    make_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_get_keys_con_elemento_cadena_vacia_retorna_400", async () => {
  const res = await handler(
    post_request({ kind: "avatar", op: "get", keys: [AVATAR_KEY_PROPIO, ""] }),
    make_deps(),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("op_put_key_presente_cadena_vacia_retorna_400", async () => {
  const res = await handler(post_request({ kind: "avatar", op: "put", key: "" }), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error.code, "INVALID_INPUT");
});

Deno.test("kind_archive_op_get_con_keys_validos_retorna_200", async () => {
  const deps = make_deps();
  const res = await handler(
    post_request({ kind: "archive", op: "get", keys: ["archive/x/original.mp4"] }),
    deps,
  );
  assertEquals(res.status, 200, "kind='archive' debe ser válido para lectura (op=get)");
});

// ── Autorización (frontera de confianza — fail-closed) ───────────────────────

Deno.test("sin_authorization_header_op_put_retorna_401", async () => {
  const res = await handler(
    post_request_no_auth({ kind: "avatar", op: "put", key: AVATAR_KEY_PROPIO }),
    make_deps({ callerVerifier: caller_unauthenticated() }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("sin_authorization_header_op_get_retorna_401", async () => {
  const res = await handler(
    post_request_no_auth({ kind: "avatar", op: "get", keys: [AVATAR_KEY_PROPIO] }),
    make_deps({ callerVerifier: caller_unauthenticated() }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("jwt_invalido_callerVerifier_falla_retorna_401", async () => {
  const res = await handler(
    post_request({ kind: "avatar", op: "put", key: AVATAR_KEY_PROPIO }),
    make_deps({ callerVerifier: caller_unauthenticated() }),
  );
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error.code, "UNAUTHENTICATED");
});

Deno.test("sin_auth_ni_agencyOwnership_ni_minter_son_invocados", async () => {
  const agency = agency_owner_of(AGENCY_ID);
  const m = minter_ok();
  await handler(
    post_request_no_auth({ kind: "logo", op: "put", key: LOGO_KEY_PROPIO }),
    make_deps({ callerVerifier: caller_unauthenticated(), agencyOwnershipVerifier: agency, r2UrlMinter: m }),
  );
  assertEquals(agency.calls.length, 0, "sin auth, no debe consultarse ownership de agencia");
  assertEquals(m.put_calls.length, 0, "sin auth, el minter no debe ser invocado");
});

Deno.test("put_avatar_key_con_uid_ajeno_retorna_403", async () => {
  const res = await handler(
    post_request({ kind: "avatar", op: "put", key: AVATAR_KEY_AJENO }),
    make_deps({ callerVerifier: caller_ok(USER_ID) }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("put_avatar_key_ajeno_minter_no_es_invocado", async () => {
  const m = minter_ok();
  await handler(
    post_request({ kind: "avatar", op: "put", key: AVATAR_KEY_AJENO }),
    make_deps({ r2UrlMinter: m }),
  );
  assertEquals(m.put_calls.length, 0, "no debe firmarse una subida a un prefix ajeno");
});

Deno.test("put_logo_caller_no_es_owner_de_ninguna_agencia_retorna_403", async () => {
  const res = await handler(
    post_request({ kind: "logo", op: "put", key: LOGO_KEY_PROPIO }),
    make_deps({ agencyOwnershipVerifier: agency_owner_of(null) }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("put_logo_caller_owner_de_otra_agencia_key_ajena_retorna_403", async () => {
  const res = await handler(
    post_request({ kind: "logo", op: "put", key: LOGO_KEY_AJENO }),
    make_deps({ agencyOwnershipVerifier: agency_owner_of(AGENCY_ID) }),
  );
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body.error.code, "FORBIDDEN");
});

Deno.test("put_logo_no_autorizado_minter_no_es_invocado", async () => {
  const m = minter_ok();
  await handler(
    post_request({ kind: "logo", op: "put", key: LOGO_KEY_AJENO }),
    make_deps({ agencyOwnershipVerifier: agency_owner_of(AGENCY_ID), r2UrlMinter: m }),
  );
  assertEquals(m.put_calls.length, 0, "no debe firmarse el logo de una agencia ajena");
});

Deno.test("get_usuario_autenticado_sin_ser_owner_retorna_200", async () => {
  // GET no exige ownership: cualquier autenticado puede leer (bucket privado, assets público-a-autenticados).
  const res = await handler(
    post_request({ kind: "logo", op: "get", keys: [LOGO_KEY_AJENO] }),
    make_deps({ agencyOwnershipVerifier: agency_owner_of(null) }),
  );
  assertEquals(res.status, 200, "op=get no debe rechazar por falta de ownership");
});

// ── Fallo interno → 500 INTERNAL_ERROR ───────────────────────────────────────

Deno.test("minter_sign_put_lanza_error_retorna_500", async () => {
  const res = await handler(
    post_request({ kind: "avatar", op: "put", key: AVATAR_KEY_PROPIO }),
    make_deps({ r2UrlMinter: minter_put_throws() }),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

Deno.test("minter_sign_get_batch_lanza_error_retorna_500", async () => {
  const res = await handler(
    post_request({ kind: "avatar", op: "get", keys: [AVATAR_KEY_PROPIO] }),
    make_deps({ r2UrlMinter: minter_get_throws() }),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

Deno.test("deps_undefined_retorna_500", async () => {
  const res = await handler(
    post_request({ kind: "avatar", op: "put", key: AVATAR_KEY_PROPIO }),
  );
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error.code, "INTERNAL_ERROR");
});

// ── Forma invariante de errores ────────────────────────────────────────────────

Deno.test("error_respuesta_tiene_forma_error_code_message", async () => {
  const res = await handler(post_request({}), make_deps());
  assertEquals(res.status, 400);
  const body = await res.json();
  assertExists(body.error, "respuesta de error debe tener campo 'error'");
  assertEquals(typeof body.error.code, "string");
  assertEquals(typeof body.error.message, "string");
});
