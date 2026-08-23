// supabase/functions/suspend-agency/handler.test.ts
//
// Tests RED — subtarea #211.1 (suspender/reactivar una organización).
// Edge Function: suspend-agency/handler.ts
// Runner: deno test --allow-net supabase/functions/suspend-agency/handler.test.ts
//
// ════════════════════════════════════════════════════════════════════════════
// EL HUECO QUE ESTA EF CIERRA. El trigger `handle_agency_status_change()`
// (71.5, extendido en 169.2/210.1) YA es el MOTOR completo: valida el grafo
// {pending_approval→active, pending_approval→rejected, active→suspended,
// suspended→active}, cascada sobre `ads` (pausa/revive SOLO los que ella misma
// pausó) y audita en admin_actions — todo en una transacción. Pero
// agencies.status está excluido del GRANT de columna a `authenticated`
// (decisión D3 de 71.5), así que el ÚNICO camino real hoy es Studio/SQL a
// mano. Es el mismo patrón de #205/#206/#207/#208/#209/#210 — la unidad
// correcta, el cableado ausente — por sexta vez en esta épica.
//
// 🔴 SEAM BAJO TEST: el contrato HTTP del handler (request → status + body)
// sobre DOS dependencias inyectables puras: AdminVerifier (ya existía, la usa
// moderate-property/moderate-ad) y AgencyStatusWriter (nueva). Ninguna habla
// con Postgres: son fakes que graban sus llamadas.
//
// 🔴 LO QUE ESTOS TESTS **NO** AFIRMAN, Y ES DELIBERADO. No hay un solo caso
// que verifique el grafo de transiciones válidas ni la cascada sobre `ads`.
// Esas reglas viven en el trigger `handle_agency_status_change()` y ya tienen
// su cobertura pgTAP completa (48_ads_state_machine_test.sql AGMATRIZ1-14,
// 66_ad_takedown_test.sql, 67_set_agency_status_atomic_test.sql AGST1-20).
// Reafirmarlas aquí crearía una SEGUNDA copia del grafo en TypeScript — el
// mismo riesgo que ya se desincronizó una vez (#183, la ventana del reaper
// duplicada entre mint-upload-url y mint-ad-upload-url). Lo que sí se afirma
// es que cuando la base dice que no (o que sí, en el caso idempotente), el
// handler TRADUCE esa respuesta a un código tipado y un status HTTP correctos.
//
// ════════════════════════════════════════════════════════════════════════════
// EDGE CASES (RED)
//
// ### Happy path
// - EC-1  suspend → 200, writer recibe next_status='suspended'
// - EC-2  reactivate → 200, writer recibe next_status='active'
// - EC-3  el admin_id viene del verificador, NUNCA del body
// - EC-4  la respuesta 200 reporta el status RESULTANTE de la agencia
//
// ### Auth
// - EC-5  sin Authorization → 401 UNAUTHENTICATED, writer NUNCA se llama
// - EC-6  verificador FORBIDDEN (no-admin) → 403, writer NUNCA se llama
// - EC-7  el verificador recibe el header Authorization EXACTO de la petición
//
// ### Traducción de lo que contesta la base
// - EC-8  AGENCY_NOT_FOUND → 404
// - EC-9  INVALID_STATUS_TRANSITION → 409 (no 400: el request era válido, el
//         estado del recurso es el que no permite la operación — p.ej.
//         suspender una organización que aún no fue aprobada)
// - EC-10 DB_ERROR → 500
//
// ### 🔴 EC-11 — el que de verdad protege a alguien
// El cuerpo de la respuesta NUNCA filtra el texto crudo de Postgres. Un
// `raise exception` del trigger trae el nombre de la función, el esquema y a
// veces la fila. Es fuga de implementación hacia un cliente móvil.
//
// ### 🔴 Idempotencia — regla NO OBVIA, derivada de una verificación en vivo
// contra el trigger vigente (docker exec + psql, no leída de un comentario):
// el trigger se declaró con `for each row when (old.status is distinct from
// new.status)` (20260805000007:169-174). Un UPDATE que reescribe el MISMO
// status NUNCA lo dispara — así que la RPC set_agency_status_atomic (#211.1)
// hace el UPDATE, obtiene 1 fila afectada, y NO hay excepción que traducir:
// es éxito, 200, igual que un cambio real (AGST19 en
// 67_set_agency_status_atomic_test.sql lo fija a nivel RPC). Este contrato
// NO inventa un error "ya estaba suspendida" — el mundo real (doble-tap del
// admin, dos pestañas de Studio) no debe romperse con un 409 fantasma.
// - EC-12 suspend sobre una agencia que el writer reporta como YA suspendida
//         (idempotente) → 200 igual que el caso normal, MISMO contrato que
//         EC-1 — el handler es agnóstico de si hubo cambio real o no-op; esa
//         distinción vive enteramente en la RPC/trigger, nunca aquí.
//
// ### Payload
// - EC-13 body no-JSON → 400 INVALID_INPUT
// - EC-14 payload vacío {} → 400 INVALID_INPUT
// - EC-15 agency_id ausente → 400 INVALID_INPUT
// - EC-16 agency_id no-string → 400 INVALID_INPUT
// - EC-17 action ausente → 400 INVALID_INPUT
// - EC-18 action desconocida ("approve") → 400 INVALID_INPUT. `approve` es
//         una acción real sobre ANUNCIOS (moderate-ad) y no existe para
//         organizaciones: se rechaza explícitamente para que un copy-paste
//         entre EFs de moderación no la cuele.
//
// ### CORS / métodos
// - EC-19 OPTIONS → 200 con Access-Control-Allow-Origin
// - EC-20 GET → 405
// - EC-21 PUT → 405
// - EC-22 DELETE → 405
// ════════════════════════════════════════════════════════════════════════════

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  AgencyStatusResult,
  AgencyStatusWriteParams,
  AgencyStatusWriter,
  SuspendAgencyDeps,
} from "./types.ts";
import type { AdminVerifier, AdminVerifyResult } from "../_shared/admin_auth.ts";

// ── Constantes ───────────────────────────────────────────────────────────────

const ADMIN_ID = "00000000-0000-0000-0000-0000000000a1";
const OTHER_ID = "00000000-0000-0000-0000-0000000000ff";
const AGENCY_ID = "22222222-2222-2222-2222-222222222222";
const AUTH_HEADER = "Bearer admin.jwt.token";

/** Texto crudo tal como lo emite Postgres desde el trigger. EC-11 lo persigue. */
const RAW_PG_MESSAGE =
  'error returned from database: INVALID_STATUS_TRANSITION CONTEXT: PL/pgSQL function public.handle_agency_status_change() line 8 at RAISE';

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

// ── Fakes — AgencyStatusWriter ───────────────────────────────────────────────

interface FakeWriter extends AgencyStatusWriter {
  calls: AgencyStatusWriteParams[];
}

function make_writer(result: AgencyStatusResult): FakeWriter {
  return {
    calls: [] as AgencyStatusWriteParams[],
    set_status(params: AgencyStatusWriteParams): Promise<AgencyStatusResult> {
      this.calls.push(params);
      return Promise.resolve(result);
    },
  } as FakeWriter;
}

const writer_ok = (status: "active" | "suspended") => make_writer({ ok: true, status });

// ── Helpers de petición ──────────────────────────────────────────────────────

function post(body: unknown, auth: string | null = AUTH_HEADER): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  return new Request("https://edge.local/suspend-agency", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function deps(verifier: FakeVerifier, writer: FakeWriter): SuspendAgencyDeps {
  return { adminVerifier: verifier, agencyStatusWriter: writer };
}

async function body_of(res: Response): Promise<{ error?: { code: string; message: string }; status?: string }> {
  return await res.json();
}

const suspend_body = { agency_id: AGENCY_ID, action: "suspend" as const };
const reactivate_body = { agency_id: AGENCY_ID, action: "reactivate" as const };

// ═══════════════════════════════════════════════════════════════════════════
// Happy path
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-1: suspend → 200 y el writer recibe next_status='suspended'", async () => {
  const w = writer_ok("suspended");
  const res = await handler(post(suspend_body), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].agency_id, AGENCY_ID);
  assertEquals(w.calls[0].next_status, "suspended");
});

Deno.test("EC-2: reactivate → 200 y el writer recibe next_status='active'", async () => {
  const w = writer_ok("active");
  const res = await handler(post(reactivate_body), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].agency_id, AGENCY_ID);
  assertEquals(w.calls[0].next_status, "active");
});

Deno.test("EC-3: el admin_id viene del verificador, NUNCA del body", async () => {
  const w = writer_ok("suspended");
  await handler(
    post({ ...suspend_body, admin_id: OTHER_ID }),
    deps(verifier_ok(), w),
  );

  assertEquals(w.calls[0].admin_id, ADMIN_ID);
});

Deno.test("EC-4: la respuesta 200 reporta el status resultante de la agencia", async () => {
  const res = await handler(post(suspend_body), deps(verifier_ok(), writer_ok("suspended")));

  assertEquals(res.status, 200);
  assertEquals((await body_of(res)).status, "suspended");
});

// ═══════════════════════════════════════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-5: sin Authorization → 401 y el writer NUNCA se llama", async () => {
  const w = writer_ok("suspended");
  const res = await handler(post(suspend_body, null), deps(verifier_401(), w));

  assertEquals(res.status, 401);
  assertEquals((await body_of(res)).error?.code, "UNAUTHENTICATED");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-6: verificador FORBIDDEN → 403 y el writer NUNCA se llama", async () => {
  const w = writer_ok("suspended");
  const res = await handler(post(suspend_body), deps(verifier_403(), w));

  assertEquals(res.status, 403);
  assertEquals((await body_of(res)).error?.code, "FORBIDDEN");
  assertEquals(w.calls.length, 0);
});

Deno.test("EC-7: el verificador recibe el header Authorization exacto", async () => {
  const v = verifier_ok();
  await handler(post(suspend_body), deps(v, writer_ok("suspended")));

  assertEquals(v.calls, [AUTH_HEADER]);
});

// ═══════════════════════════════════════════════════════════════════════════
// Traducción de lo que contesta la base
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-8: AGENCY_NOT_FOUND → 404", async () => {
  const w = make_writer({ ok: false, error_code: "AGENCY_NOT_FOUND" });
  const res = await handler(post(suspend_body), deps(verifier_ok(), w));

  assertEquals(res.status, 404);
  assertEquals((await body_of(res)).error?.code, "AGENCY_NOT_FOUND");
});

Deno.test("EC-9: INVALID_STATUS_TRANSITION → 409, no 400", async () => {
  const w = make_writer({ ok: false, error_code: "INVALID_STATUS_TRANSITION" });
  const res = await handler(post(suspend_body), deps(verifier_ok(), w));

  assertEquals(res.status, 409);
  assertEquals((await body_of(res)).error?.code, "INVALID_STATUS_TRANSITION");
});

Deno.test("EC-10: DB_ERROR → 500", async () => {
  const w = make_writer({ ok: false, error_code: "DB_ERROR" });
  const res = await handler(post(suspend_body), deps(verifier_ok(), w));

  assertEquals(res.status, 500);
});

Deno.test("EC-11 🔴: el cuerpo NUNCA filtra el texto crudo de Postgres", async () => {
  // El writer devuelve el código tipado; el mensaje crudo se queda del lado
  // del adaptador. Si alguien "mejora" el handler pasando el error de la base
  // tal cual, este test lo caza: el cliente móvil vería el nombre de la
  // función PL/pgSQL, su línea y el esquema.
  const w = make_writer({ ok: false, error_code: "INVALID_STATUS_TRANSITION" });
  const res = await handler(post(suspend_body), deps(verifier_ok(), w));
  const raw = await res.text();

  // Sin estas dos primeras aserciones el caso pasaría TRIVIALMENTE contra un
  // stub que no contesta nada — un test que no puede distinguir no protege.
  assertEquals(res.status, 409);
  assertStringIncludes(raw, "INVALID_STATUS_TRANSITION");

  assertEquals(raw.includes("PL/pgSQL"), false);
  assertEquals(raw.includes("handle_agency_status_change"), false);
  assertEquals(raw.includes(RAW_PG_MESSAGE), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Idempotencia (verificada en vivo contra el trigger, no inventada)
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-12: suspend idempotente (la agencia ya estaba suspended) → 200, MISMO contrato que EC-1", async () => {
  // El writer no distingue "cambió de verdad" de "ya estaba así" — esa
  // distinción la hace el trigger (WHEN old.status IS DISTINCT FROM
  // new.status) antes siquiera de correr, así que desde la RPC hacia arriba
  // es indistinguible de un éxito normal. El handler NO debe inventar un
  // NOT_MODIFIED ni ningún código nuevo: es 200 con status='suspended', punto.
  const w = writer_ok("suspended");
  const res = await handler(post(suspend_body), deps(verifier_ok(), w));

  assertEquals(res.status, 200);
  assertEquals((await body_of(res)).status, "suspended");
  assertEquals(w.calls.length, 1);
  assertEquals(w.calls[0].next_status, "suspended");
});

// ═══════════════════════════════════════════════════════════════════════════
// Payload
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-13: body no-JSON → 400 INVALID_INPUT", async () => {
  const res = await handler(post("no soy json {{{"), deps(verifier_ok(), writer_ok("suspended")));
  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
});

Deno.test("EC-14: payload vacío → 400 INVALID_INPUT", async () => {
  const res = await handler(post({}), deps(verifier_ok(), writer_ok("suspended")));
  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
});

Deno.test("EC-15: agency_id ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(post({ action: "suspend" }), deps(verifier_ok(), writer_ok("suspended")));
  assertEquals(res.status, 400);
});

Deno.test("EC-16: agency_id no-string → 400 INVALID_INPUT", async () => {
  const res = await handler(
    post({ agency_id: 42, action: "suspend" }),
    deps(verifier_ok(), writer_ok("suspended")),
  );
  assertEquals(res.status, 400);
});

Deno.test("EC-17: action ausente → 400 INVALID_INPUT", async () => {
  const res = await handler(post({ agency_id: AGENCY_ID }), deps(verifier_ok(), writer_ok("suspended")));
  assertEquals(res.status, 400);
});

Deno.test("EC-18: action 'approve' (existe para anuncios, no para agencias) → 400", async () => {
  const w = writer_ok("suspended");
  const res = await handler(
    post({ agency_id: AGENCY_ID, action: "approve" }),
    deps(verifier_ok(), w),
  );

  assertEquals(res.status, 400);
  assertEquals((await body_of(res)).error?.code, "INVALID_INPUT");
  assertEquals(w.calls.length, 0);
});

// ═══════════════════════════════════════════════════════════════════════════
// CORS / métodos
// ═══════════════════════════════════════════════════════════════════════════

Deno.test("EC-19: OPTIONS → 200 con Access-Control-Allow-Origin", async () => {
  const req = new Request("https://edge.local/suspend-agency", { method: "OPTIONS" });
  const res = await handler(req, deps(verifier_ok(), writer_ok("suspended")));

  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

for (const method of ["GET", "PUT", "DELETE"]) {
  Deno.test(`EC-20/21/22: ${method} → 405`, async () => {
    const req = new Request("https://edge.local/suspend-agency", { method });
    const res = await handler(req, deps(verifier_ok(), writer_ok("suspended")));
    assertEquals(res.status, 405);
  });
}
