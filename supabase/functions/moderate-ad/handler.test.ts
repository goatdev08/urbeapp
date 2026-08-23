// supabase/functions/moderate-ad/handler.test.ts
//
// Tests RED — subtarea #208.1 (pantalla de admin para aprobar anuncios).
// Edge Function: moderate-ad/handler.ts
// Runner: deno test --allow-net supabase/functions/moderate-ad/handler.test.ts
//
// ════════════════════════════════════════════════════════════════════════════
// EL HUECO QUE ESTA EF CIERRA. La tarea #169 se llamaba «anuncios … y
// moderación admin» y cerró sus 9 subtareas en verde, pero lo que se construyó
// fue el MOTOR: la máquina de estados por trigger, la auditoría obligatoria, el
// guard de organización suspendida. El botón nunca existió. `step5.tsx` le
// promete al anunciante que «activarlo es del admin» y hoy eso significa que
// Abraham corre un UPDATE a mano en SQL. Es el mismo patrón de #205/#206/#207
// —la unidad correcta, el cableado ausente— por cuarta vez en esta épica.
//
// 🔴 SEAM BAJO TEST: el contrato HTTP del handler (request → status + body)
// sobre DOS dependencias inyectables puras: AdminVerifier (ya existía, la usa
// moderate-property) y AdModerationWriter (nueva). Ninguna habla con Postgres:
// son fakes que graban sus llamadas.
//
// 🔴 LO QUE ESTOS TESTS **NO** AFIRMAN, Y ES DELIBERADO. No hay un solo caso
// que verifique el grafo de transiciones válidas. Esa regla vive en el trigger
// `handle_ad_status_change()` y ya tiene su cobertura pgTAP. Reafirmarla aquí
// crearía una SEGUNDA copia del grafo en TypeScript — y este repo ya vio a dos
// copias de una regla desincronizarse (#183, la ventana del reaper duplicada
// entre mint-upload-url y mint-ad-upload-url). Lo que sí se afirma es que
// cuando el trigger dice que no, el handler TRADUCE esa negativa a un código
// tipado y un status HTTP correctos.
//
// ════════════════════════════════════════════════════════════════════════════
// EDGE CASES (RED)
//
// ### Happy path
// - EC-1  approve → 200, writer recibe next_status='active' y rejection_reason=null
// - EC-2  reject con razón → 200, writer recibe next_status='rejected' y la razón
// - EC-3  el writer recibe el admin_id que devolvió el verificador (no el del body)
// - EC-4  la respuesta 200 reporta el status RESULTANTE del anuncio
//
// ### El CHECK bidireccional de la base, respetado desde arriba
// - EC-5  approve que ADEMÁS manda rejection_reason → la razón NO viaja (null).
//         `ads_rejection_reason_matches_status` exige (status='rejected') ===
//         (rejection_reason is not null): dejarla pasar sería un 23514 crudo.
// - EC-6  reject SIN rejection_reason → 400 REJECTION_REASON_REQUIRED, writer NO se llama
// - EC-7  reject con razón en blanco ("   ") → 400 REJECTION_REASON_REQUIRED
//
// ### Auth
// - EC-8  sin Authorization → 401 UNAUTHENTICATED, writer NUNCA se llama
// - EC-9  verificador FORBIDDEN (no-admin) → 403, writer NUNCA se llama
// - EC-10 el verificador recibe el header Authorization EXACTO de la petición
//
// ### Traducción de lo que contesta la base
// - EC-11 AD_NOT_FOUND → 404
// - EC-12 INVALID_AD_STATUS_TRANSITION → 409 (no 400: el request era válido,
//         el estado del recurso es el que no permite la operación)
// - EC-13 ORGANIZATION_SUSPENDED → 409
// - EC-14 DB_ERROR → 500
//
// ### 🔴 EC-15 — el que de verdad protege a alguien
// El cuerpo de la respuesta NUNCA filtra el texto crudo de Postgres. Un
// `raise exception` del trigger trae el nombre de la función, el esquema y a
// veces la fila. Es fuga de implementación hacia un cliente móvil.
//
// ### Payload
// - EC-16 body no-JSON → 400 INVALID_INPUT
// - EC-17 payload vacío {} → 400 INVALID_INPUT
// - EC-18 ad_id ausente → 400 INVALID_INPUT
// - EC-19 ad_id no-string → 400 INVALID_INPUT
// - EC-20 action ausente → 400 INVALID_INPUT
// - EC-21 action desconocida ("suspend") → 400 INVALID_INPUT. `suspend` es una
//         acción real sobre PROPIEDADES (moderate-property) y no existe para
//         anuncios: se rechaza explícitamente para que un copy-paste no la cuele.
//
// ### CORS / métodos
// - EC-22 OPTIONS → 200 con Access-Control-Allow-Origin
// - EC-23 GET → 405
// - EC-24 PUT → 405
// - EC-25 DELETE → 405
// ════════════════════════════════════════════════════════════════════════════

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  AdModerationResult,
  AdModerationWriteParams,
  AdModerationWriter,
  ModerateAdDeps,
} from "./types.ts";
import type { AdminVerifier, AdminVerifyResult } from "../_shared/admin_auth.ts";

// ── Constantes ───────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1";
const OTHER_ID = "00000000-0000-0000-0000-0000000000ff";
const AD_ID = "11111111-1111-1111-1111-111111111111";
const AUTH_HEADER = "Bearer admin.jwt.token";
const REASON = "El video muestra un inmueble, no el servicio anunciado.";

/** Texto crudo tal como lo emite Postgres desde el trigger. EC-15 lo persigue. */
const RAW_PG_MESSAGE =
  'error returned from database: INVALID_AD_STATUS_TRANSITION CONTEXT: PL/pgSQL function public.handle_ad_status_change() line 12 at RAISE';

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

// ── Fakes — AdModerationWriter ───────────────────────────────────────────────

interface FakeWriter extends AdModerationWriter {
  calls: AdModerationWriteParams[];
}

function make_writer(result: AdModerationResult): FakeWriter {
  return {
    calls: [] as AdModerationWriteParams[],
    moderate(params: AdModerationWriteParams): Promise<AdModerationResult> {
      this.calls.push(params);
      return Promise.resolve(result);
    },
  } as FakeWriter;
}

const writer_ok = (status: "active" | "rejected" = "active") =>
  make_writer({ ok: true, status });

// ── Helpers de petición ──────────────────────────────────────────────────────

function post(body: unknown, auth: string | null = AUTH_HEADER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  return new Request("https://edge.local/moderate-ad", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(verifier: FakeVerifier, writer: FakeWriter): ModerateAdDeps {
  return { adminVerifier: verifier, moderationWriter: writer };
}

async function body_of(res: Response): Promise<{ error?: { code: string; message: string }; status?: string }> {
  return await res.json();
}

const approve_body = { ad_id: AD_ID, action: "approve" as const };
const reject_body = { ad_id: AD_ID, action: "reject" as const, rejection_reason: REASON };

// ═══════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-1: approve → 200 y el writer recibe next_status='active' sin razón", async () => {
  const w = writer_ok("active");
  const res = await handler(post(approve_body), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].ad_id, AD_ID);
  assertEquals(w.calls[0].next_status, "active");
  assertEquals(w.calls[0].rejection_reason, null);
});

Deno.test("EC-2: reject con razón → 200 y la razón viaja íntegra", async () => {
  const w = writer_ok("rejected");
  const res = await handler(post(reject_body), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].next_status, "rejected");
  assertEquals(w.calls[0].rejection_reason, REASON);
});

Deno.test("EC-3: el admin_id viene del verificador, NUNCA del body", async () => {
  const w = writer_ok("active");
  await handler(
    post({ ...approve_body, admin_id: OTHER_ID }),
    deps(verifier_ok(), w),
  );

  assertEquals(w.calls[0].admin_id, ADMIN_ID);
});

Deno.test("EC-4: la respuesta 200 reporta el status resultante del anuncio", async () => {
  const res = await handler(post(reject_body), deps(verifier_ok(), writer_ok("rejected")));

  assertEquals(res.status, 200);
  assertEquals((await body_of(res)).status, "rejected");
});

// ═══════════════════════════════════════════════════════════════════════════
// El CHECK bidireccional, respetado desde arriba
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-5: approve con rejection_reason de más → la razón NO viaja (null)", async () => {
  const w = writer_ok("active");
  const res = await handler(
    post({ ...approve_body, rejection_reason: REASON }),
    deps(verifier_ok(), w),
  );

  assertEquals(res.status, 200);
  assertEquals(w.calls[0].rejection_reason, null);
});

Deno.test("EC-6: reject SIN razón → 400 REJECTION_REASON_REQUIRED y el writer no se llama", async () => {
  const w = writer_ok("rejected");
  const res = await handler(
    post({ ad_id: AD_ID, action: "reject" }),
    deps(verifier_ok(), w),
  );

  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "REJECTION_REASON_REQUIRED");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-7: reject con razón en blanco → 400 REJECTION_REASON_REQUIRED", async () => {
  const w = writer_ok("rejected");
  const res = await handler(
    post({ ad_id: AD_ID, action: "reject", rejection_reason: "   " }),
    deps(verifier_ok(), w),
  );

  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "REJECTION_REASON_REQUIRED");
  assertEquals(w.calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-8: sin Authorization → 401 y el writer NUNCA se llama", async () => {
  const w = writer_ok();
  const res = await handler(post(approve_body, null), deps(verifier_401(), w));

  assertEquals(res.status, 401);
  assertEquals((await body_of(res)).error?.code, "UNAUTHENTICATED");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-9: verificador FORBIDDEN → 403 y el writer NUNCA se llama", async () => {
  const w = writer_ok();
  const res = await handler(post(approve_body), deps(verifier_403(), w));

  assertEquals(res.status, 403);
  assertEquals((await body_of(res)).error?.code, "FORBIDDEN");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-10: el verificador recibe el header Authorization exacto", async () => {
  const v = verifier_ok();
  await handler(post(approve_body), deps(v, writer_ok()));

  assertEquals(v.calls, [AUTH_HEADER]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Traducción de lo que contesta la base
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-11: AD_NOT_FOUND → 404", async () => {
  const w = make_writer({ ok: false, error_code: "AD_NOT_FOUND" });
  const res = await handler(post(approve_body), deps(verifier_ok(), w));

  assertEquals(res.status, 404);
  assertEquals((await body_of(res)).error?.code, "AD_NOT_FOUND");
});

Deno.test("EC-12: INVALID_AD_STATUS_TRANSITION → 409, no 400", async () => {
  const w = make_writer({ ok: false, error_code: "INVALID_AD_STATUS_TRANSITION" });
  const res = await handler(post(approve_body), deps(verifier_ok(), w));

  assertEquals(res.status, 409);
  assertEquals((await body_of(res)).error?.code, "INVALID_AD_STATUS_TRANSITION");
});

Deno.test("EC-13: ORGANIZATION_SUSPENDED → 409", async () => {
  const w = make_writer({ ok: false, error_code: "ORGANIZATION_SUSPENDED" });
  const res = await handler(post(approve_body), deps(verifier_ok(), w));

  assertEquals(res.status, 409);
  assertEquals((await body_of(res)).error?.code, "ORGANIZATION_SUSPENDED");
});

Deno.test("EC-14: DB_ERROR → 500", async () => {
  const w = make_writer({ ok: false, error_code: "DB_ERROR" });
  const res = await handler(post(approve_body), deps(verifier_ok(), w));

  assertEquals(res.status, 500);
});

Deno.test("EC-15 🔴: el cuerpo NUNCA filtra el texto crudo de Postgres", async () => {
  // El writer devuelve el código tipado; el mensaje crudo se queda del lado del
  // adaptador. Si alguien "mejora" el handler pasando el error de la base tal
  // cual, este test lo caza: el cliente móvil vería el nombre de la función
  // PL/pgSQL, su línea y el esquema.
  const w = make_writer({ ok: false, error_code: "INVALID_AD_STATUS_TRANSITION" });
  const res = await handler(post(approve_body), deps(verifier_ok(), w));
  const raw = await res.text();

  assertEquals(raw.includes("PL/pgSQL"), false);
  assertEquals(raw.includes("handle_ad_status_change"), false);
  assertEquals(raw.includes(RAW_PG_MESSAGE), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Payload
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-16: body no-JSON → 400 INVALID_INPUT", async () => {
  const res = await handler(post("no soy json {{{"), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
});

Deno.test("EC-17: payload vacío → 400 INVALID_INPUT", async () => {
  const res = await handler(post({}), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
});

Deno.test("EC-18: ad_id ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(post({ action: "approve" }), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
});

Deno.test("EC-19: ad_id no-string → 400 INVALID_INPUT", async () => {
  const res = await handler(
    post({ ad_id: 42, action: "approve" }),
    deps(verifier_ok(), writer_ok()),
  );
  assertEquals(res.status, 400);
});

Deno.test("EC-20: action ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(post({ ad_id: AD_ID }), deps(verifier_ok(), writer_ok()));
  assertEquals(res.status, 400);
});

Deno.test("EC-21: action 'suspend' (existe para propiedades, no para anuncios) → 400", async () => {
  const w = writer_ok();
  const res = await handler(
    post({ ad_id: AD_ID, action: "suspend" }),
    deps(verifier_ok(), w),
  );

  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
  assertEquals(w.calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// CORS / métodos
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-22: OPTIONS → 200 con Access-Control-Allow-Origin", async () => {
  const req = new Request("https://edge.local/moderate-ad", { method: "OPTIONS" });
  const res = await handler(req, deps(verifier_ok(), writer_ok()));

  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

for (const method of ["GET", "PUT", "DELETE"]) {
  Deno.test(`EC-23/24/25: ${method} → 405`, async () => {
    const req = new Request("https://edge.local/moderate-ad", { method });
    const res = await handler(req, deps(verifier_ok(), writer_ok()));
    assertEquals(res.status, 405);
  });
}
