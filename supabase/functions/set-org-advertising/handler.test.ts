// supabase/functions/set-org-advertising/handler.test.ts
//
// Tests RED — subtarea #209.1 (admin enciende/apaga el "modo comercial" de
// una organización).
// Edge Function: set-org-advertising/handler.ts
// Runner: cd supabase/functions && deno test --allow-net --allow-env set-org-advertising/handler.test.ts
//
// ════════════════════════════════════════════════════════════════════════════
// EL HUECO QUE ESTA EF CIERRA. La RPC `set_org_advertising_atomic`
// (20260815000002, extendida en 20260816000003) existe desde la #168 y ya
// tiene su cobertura pgTAP (46_org_advertising_test.sql), pero solo la puede
// invocar `service_role` desde Studio/CLI — Abraham corriendo SQL a mano. #209
// le pone el botón al admin de Urbea. Mismo patrón repetido por quinta vez en
// esta épica (#205-#208): la unidad de negocio ya existe, falta el cableado.
//
// 🔴 SEAM BAJO TEST: el contrato HTTP del handler (request → status + body)
// sobre DOS dependencias inyectables puras: AdminVerifier (ya existía, la usa
// moderate-property/moderate-ad) y OrgAdvertisingWriter (nueva). Ninguna habla
// con Postgres: son fakes que graban sus llamadas.
//
// 🔴 LO QUE ESTOS TESTS **NO** AFIRMAN, Y ES DELIBERADO. Ningún caso verifica
// "si enabled=true entonces category es obligatoria" como una regla de
// TypeScript. Esa regla vive en el CHECK `agencies_categoria_requerida_para_anunciar`
// y en el `raise exception ADVERTISER_CATEGORY_REQUIRED` de la RPC (ya cubiertos
// por pgTAP). Lo que sí se afirma es que cuando la RPC dice que no, el handler
// TRADUCE esa negativa a un código tipado y un status HTTP correctos — nunca
// reenvía el texto crudo de Postgres.
//
// ════════════════════════════════════════════════════════════════════════════
// EDGE CASES (RED)
//
// ### Happy path
// - EC-1  enabled=true + category válida → 200, writer recibe enabled=true,
//         category=<valor>, agency_id=<valor>
// - EC-2  enabled=false SIN category → 200, writer recibe category=null
// - EC-3  el writer recibe el admin_id que devolvió el verificador
// - EC-4  la respuesta 200 es { ok: true } (cuerpo mínimo, convención moderate-ad)
//
// ### Payload — tipos y presencia
// - EC-5  body no-JSON → 400 INVALID_INPUT
// - EC-6  payload vacío {} → 400 INVALID_INPUT
// - EC-7  agency_id ausente → 400 INVALID_INPUT
// - EC-8  agency_id no-string → 400 INVALID_INPUT
// - EC-9  enabled ausente → 400 INVALID_INPUT
// - EC-10 enabled no-boolean (string "true") → 400 INVALID_INPUT
//
// ### Payload — category (frontera de confianza contra el enum de la base)
// - EC-11 category con valor que NO pertenece al enum advertiser_category
//         → 400 INVALID_INPUT, writer NUNCA se llama. Un string arbitrario
//         llegando a la RPC produciría un 22P02 crudo de Postgres (fuga de
//         implementación) en vez de un 400 accionable.
// - EC-12 category no-string (number) → 400 INVALID_INPUT
// - EC-13 enabled=true SIN category → NO es 400 en TypeScript. El payload es
//         válido en FORMA; la obligatoriedad la decide la RPC (EC-19).
//
// ### Auth
// - EC-14 sin Authorization → 401 UNAUTHENTICATED, writer NUNCA se llama
// - EC-15 verificador FORBIDDEN (no-admin) → 403, writer NUNCA se llama
// - EC-16 el verificador recibe el header Authorization EXACTO de la petición
//
// ### Traducción de lo que contesta la RPC
// - EC-17 AGENCY_NOT_FOUND → 404
// - EC-18 ADVERTISER_CATEGORY_REQUIRED → 422 (el request estaba bien formado;
//         lo que falta es un dato de negocio, no un tipo)
// - EC-19 DB_ERROR (fallo inesperado) → 500
//
// ### 🔴 EC-20 — el que de verdad protege a alguien
// El cuerpo de la respuesta NUNCA filtra el texto crudo de Postgres.
//
// ### CORS / métodos
// - EC-21 OPTIONS → 200 con Access-Control-Allow-Origin
// - EC-22 GET → 405
// - EC-23 PUT → 405
// - EC-24 DELETE → 405
// ════════════════════════════════════════════════════════════════════════════

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  OrgAdvertisingResult,
  OrgAdvertisingWriteParams,
  OrgAdvertisingWriter,
  SetOrgAdvertisingDeps,
} from "./types.ts";
import type { AdminVerifier, AdminVerifyResult } from "../_shared/admin_auth.ts";

// ── Constantes ───────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1";
const AGENCY_ID = "22222222-2222-2222-2222-222222222222";
const AUTH_HEADER = "Bearer admin.jwt.token";
const CATEGORY = "seguros" as const;

/** Texto crudo tal como lo emite Postgres desde la RPC. EC-20 lo persigue. */
const RAW_PG_MESSAGE =
  'error returned from database: ADVERTISER_CATEGORY_REQUIRED CONTEXT: PL/pgSQL function public.set_org_advertising_atomic(uuid,boolean,advertiser_category) line 33 at RAISE';

// ── Fakes — AdminVerifier ────────────────────────────────────────────────────

interface FakeVerifier extends AdminVerifier {
  calls: (string | null)[];
}

function make_verifier(result: AdminVerifyResult): FakeVerifier {
  return {
    calls: [] as (string | null)[],
    verify_caller(header: string | null): Promise<AdminVerifyResult> {
      this.calls.push(header);
      return Promise.resolve(result);
    },
  } as FakeVerifier;
}

const verifier_ok = () => make_verifier({ ok: true, user_id: ADMIN_ID });
const verifier_401 = () => make_verifier({ ok: false, error_code: "UNAUTHENTICATED" });
const verifier_403 = () => make_verifier({ ok: false, error_code: "FORBIDDEN" });

// ── Fakes — OrgAdvertisingWriter ─────────────────────────────────────────────

interface FakeWriter extends OrgAdvertisingWriter {
  calls: OrgAdvertisingWriteParams[];
}

function make_writer(result: OrgAdvertisingResult): FakeWriter {
  return {
    calls: [] as OrgAdvertisingWriteParams[],
    set(params: OrgAdvertisingWriteParams): Promise<OrgAdvertisingResult> {
      this.calls.push(params);
      return Promise.resolve(result);
    },
  } as FakeWriter;
}

const writer_ok = () => make_writer({ ok: true });

// ── Helpers de petición ──────────────────────────────────────────────────────

function post(body: unknown, auth: string | null = AUTH_HEADER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  return new Request("https://edge.local/set-org-advertising", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(verifier: FakeVerifier, writer: FakeWriter): SetOrgAdvertisingDeps {
  return { adminVerifier: verifier, orgAdvertisingWriter: writer };
}

async function body_of(res: Response): Promise<{ error?: { code: string; message: string }; ok?: boolean }> {
  return await res.json();
}

const enable_body = { agency_id: AGENCY_ID, enabled: true, category: CATEGORY };
const disable_body = { agency_id: AGENCY_ID, enabled: false };

// ═══════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-1: enabled=true + category válida → 200 y el writer recibe todo el payload", async () => {
  const w = writer_ok();
  const res = await handler(post(enable_body), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].agency_id, AGENCY_ID);
  assertEquals(w.calls[0].enabled, true);
  assertEquals(w.calls[0].category, CATEGORY);
});

Deno.test("EC-2: enabled=false sin category → 200 y el writer recibe category=null", async () => {
  const w = writer_ok();
  const res = await handler(post(disable_body), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].enabled, false);
  assertEquals(w.calls[0].category, null);
});

Deno.test("EC-3: el admin_id viene del verificador", async () => {
  const w = writer_ok();
  await handler(post(enable_body), deps(verifier_ok(), w));

  assertEquals(w.calls[0].admin_id, ADMIN_ID);
});

Deno.test("EC-4: la respuesta 200 es { ok: true }", async () => {
  const res = await handler(post(disable_body), deps(verifier_ok(), writer_ok()));

  assertEquals(res.status, 200);
  assertEquals(await body_of(res), { ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// Payload — tipos y presencia
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-5: body no-JSON → 400 INVALID_INPUT", async () => {
  const res = await handler(post("no soy json {{{"), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
});

Deno.test("EC-6: payload vacío → 400 INVALID_INPUT", async () => {
  const res = await handler(post({}), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
});

Deno.test("EC-7: agency_id ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(post({ enabled: true, category: CATEGORY }), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
});

Deno.test("EC-8: agency_id no-string → 400 INVALID_INPUT", async () => {
  const res = await handler(
    post({ agency_id: 42, enabled: true, category: CATEGORY }),
    deps(verifier_ok(), writer_ok()),
  );
  assertEquals(res.status, 400);
});

Deno.test("EC-9: enabled ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(post({ agency_id: AGENCY_ID }), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
});

Deno.test("EC-10: enabled no-boolean ('true' string) → 400 INVALID_INPUT", async () => {
  const res = await handler(
    post({ agency_id: AGENCY_ID, enabled: "true" }),
    deps(verifier_ok(), writer_ok()),
  );
  assertEquals(res.status, 400);
});

// ═══════════════════════════════════════════════════════════════════════════
// Payload — category (frontera de confianza contra el enum de la base)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-11: category fuera del enum → 400 INVALID_INPUT, writer NUNCA se llama", async () => {
  const w = writer_ok();
  const res = await handler(
    post({ agency_id: AGENCY_ID, enabled: true, category: "categoria_inventada" }),
    deps(verifier_ok(), w),
  );

  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-12: category no-string (number) → 400 INVALID_INPUT", async () => {
  const res = await handler(
    post({ agency_id: AGENCY_ID, enabled: true, category: 7 }),
    deps(verifier_ok(), writer_ok()),
  );
  assertEquals(res.status, 400);
});

Deno.test("EC-13: enabled=true SIN category → NO es 400, el writer SÍ se llama con category=null", async () => {
  const w = writer_ok();
  const res = await handler(post({ agency_id: AGENCY_ID, enabled: true }), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].category, null);
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-14: sin Authorization → 401 y el writer NUNCA se llama", async () => {
  const w = writer_ok();
  const res = await handler(post(enable_body, null), deps(verifier_401(), w));

  assertEquals(res.status, 401);
  assertEquals((await body_of(res)).error?.code, "UNAUTHENTICATED");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-15: verificador FORBIDDEN → 403 y el writer NUNCA se llama", async () => {
  const w = writer_ok();
  const res = await handler(post(enable_body), deps(verifier_403(), w));

  assertEquals(res.status, 403);
  assertEquals((await body_of(res)).error?.code, "FORBIDDEN");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-16: el verificador recibe el header Authorization exacto", async () => {
  const v = verifier_ok();
  await handler(post(enable_body), deps(v, writer_ok()));

  assertEquals(v.calls, [AUTH_HEADER]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Traducción de lo que contesta la RPC
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-17: AGENCY_NOT_FOUND → 404", async () => {
  const w = make_writer({ ok: false, error_code: "AGENCY_NOT_FOUND" });
  const res = await handler(post(enable_body), deps(verifier_ok(), w));

  assertEquals(res.status, 404);
  assertEquals((await body_of(res)).error?.code, "AGENCY_NOT_FOUND");
});

Deno.test("EC-18: ADVERTISER_CATEGORY_REQUIRED → 422", async () => {
  const w = make_writer({ ok: false, error_code: "ADVERTISER_CATEGORY_REQUIRED" });
  const res = await handler(post({ agency_id: AGENCY_ID, enabled: true }), deps(verifier_ok(), w));

  assertEquals(res.status, 422);
  assertEquals((await body_of(res)).error?.code, "ADVERTISER_CATEGORY_REQUIRED");
});

Deno.test("EC-19: DB_ERROR → 500", async () => {
  const w = make_writer({ ok: false, error_code: "DB_ERROR" });
  const res = await handler(post(enable_body), deps(verifier_ok(), w));

  assertEquals(res.status, 500);
});

Deno.test("EC-20 🔴: el cuerpo NUNCA filtra el texto crudo de Postgres", async () => {
  const w = make_writer({ ok: false, error_code: "ADVERTISER_CATEGORY_REQUIRED" });
  const res = await handler(post({ agency_id: AGENCY_ID, enabled: true }), deps(verifier_ok(), w));
  const raw = await res.text();

  // Sin estas dos primeras aserciones el caso pasaría TRIVIALMENTE contra un
  // stub que no contesta nada — un test que no puede distinguir no protege.
  assertEquals(res.status, 422);
  assertStringIncludes(raw, "ADVERTISER_CATEGORY_REQUIRED");

  assertEquals(raw.includes("PL/pgSQL"), false);
  assertEquals(raw.includes("set_org_advertising_atomic"), false);
  assertEquals(raw.includes(RAW_PG_MESSAGE), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// CORS / métodos
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-21: OPTIONS → 200 con Access-Control-Allow-Origin", async () => {
  const req = new Request("https://edge.local/set-org-advertising", { method: "OPTIONS" });
  const res = await handler(req, deps(verifier_ok(), writer_ok()));

  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

for (const method of ["GET", "PUT", "DELETE"]) {
  Deno.test(`EC-22/23/24: ${method} → 405`, async () => {
    const req = new Request("https://edge.local/set-org-advertising", { method });
    const res = await handler(req, deps(verifier_ok(), writer_ok()));
    assertEquals(res.status, 405);
  });
}
