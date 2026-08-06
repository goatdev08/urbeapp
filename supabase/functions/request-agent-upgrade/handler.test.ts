// supabase/functions/request-agent-upgrade/handler.test.ts
// Tests RED v3 (pase Deno de las EFs) — subtarea 71.3, Camino B del wizard de
// upgrade a agente. El backend SQL (tabla agent_applications reusada, ver
// supabase/tests/23_agent_applications_upgrade_test.sql) ya pasó el guardian
// para el DELTA de la columna `reason`; este archivo cubre el handler HTTP
// (parse, auth, mapeo de errores) Y un hallazgo funcional NUEVO del guardian
// sobre supabase/functions/**: el handler NO rechaza a un caller que YA es
// agente/admin antes de crear la solicitud (R-12 abajo, RED real).
// Framework: Deno.test + @std/assert. Patrón DI mirror de
// create-invitation/handler.test.ts (fakes con `calls`, sin red real).
// Runner: deno test supabase/functions/request-agent-upgrade/handler.test.ts
//
// EDGE CASES:
//
// ### CORS / Métodos HTTP
// - R-1: OPTIONS → 200 con headers CORS
// - R-2: GET → 405
//
// ### Body / parse (reason es OPCIONAL — §4.2, docs no obligatorios en beta)
// - R-3: JSON inválido → 400
// - R-4: body vacío "" → tratado como {} → 201, creator recibe reason=null
// - R-5: reason no-string (number) → 400
// - R-6: reason solo espacios "   " → se normaliza a null (creator recibe null)
//
// ### Auth — CallerVerifier DI
// - R-7: verifier UNAUTHENTICATED → 401, applicationCreator NO se llama
//
// ### Mapeo de errores del creator
// - R-8: DUPLICATE_PENDING_APPLICATION → 409
// - R-9: DB_ERROR → 500
//
// ### Happy path / anti-spoofing (user_id SIEMPRE del JWT)
// - R-10: éxito → 201 { application_id }; creator recibe user_id del
//         verifier y el reason parseado
// - R-11: user_id/application_type falsificados en el payload se IGNORAN
//         (CreateApplicationParams no tiene application_type — el creator
//         real siempre fija 'independent', ver application_creator.ts)
//
// ### [RED] Rol ya-agente/admin — hallazgo del guardian, aún SIN implementar
// - R-12/R-12b: un caller cuyo public.users.role YA es 'agent' o 'admin'
//   debe rechazarse con 409 { error.code: 'ALREADY_AGENT' } ANTES de
//   intentar crear la solicitud — no tiene sentido pedir volverse
//   "independiente" si ya es agente. HOY el handler no consulta el rol en
//   absoluto (ni CallerVerifier ni ApplicationCreator lo exponen) y la
//   política RLS agent_app_insert (migración 20260604000008/0010) solo
//   exige user_id=auth.uid() — el INSERT pasa igual.
//
//   Seam v3.1 (checkpoint 2026-08-05, corrige v3): `verifier_ok` gana un
//   parámetro `role` opcional (mismo patrón que `runner_error(code)` en
//   upgrade-to-agent/handler.test.ts) para que el handler tenga ALGO que
//   consultar — round-trip empírico con `deno check`/`deno test` (no solo
//   teoría) confirmó que R-4/R-6/R-10/R-11 (esperan 201, sin rol) y
//   R-12/R-12b (esperan 409, con rol) son distinguibles así SIN tocar
//   producción: `CallerVerifyResultWithRole` (tipo LOCAL de este archivo,
//   no de types.ts) es un superset estructural de `CallerVerifyResult` —
//   el `role?: string | null` extra es asignable donde se espera el tipo
//   real porque es opcional, así que `FakeVerifierWithRole` sigue
//   satisfaciendo `CallerVerifier` en la firma de `RequestAgentUpgradeDeps`.
//   HOY el handler ignora ese campo (no lo lee `types.ts` real), así que
//   R-12/R-12b siguen devolviendo 201 y llamando al creator → fallan por
//   aserción (201 !== 409), NO por error de compilación.
//   NO se prescribe aquí DÓNDE debe vivir el chequeo en producción (¿GREEN
//   agrega `role?` a `CallerVerifyResult` en types.ts como hace este fake,
//   o usa una dependencia `roleChecker` separada?) — decisión de GREEN, no
//   de este RED (instrucción explícita: NO editar producción en este pase).
//   Código/status: mismo par (409, 'ALREADY_AGENT') que usa Camino A en
//   upgrade-to-agent/handler.ts para "el usuario ya es agente/admin".
//
// ### Fuera de alcance de este archivo (documentado, no omisión)
// - "request-agent-upgrade usa el client DEL USUARIO (anon key + JWT), no
//   service_role, para el INSERT" es una propiedad de la construcción en
//   index.ts (user_client(authHeader) en vez de service_client()) — index.ts
//   NO se testea unitariamente en este repo (mismo criterio que
//   create-invitation/redeem-invitation/register: "los tests importan
//   handler.ts/*_creator.ts directamente, no index.ts"). application_creator.ts
//   recibe un client duck-typed (`{ from(table): any }`), agnóstico de qué
//   key trae — no hay un seam unitario para afirmar "es anon vs service" sin
//   tocar index.ts. No se inventa aquí.

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  ApplicationCreator,
  CallerVerifier,
  CallerVerifyResult,
  CreateApplicationParams,
  CreateApplicationResult,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000001";
const ALREADY_AGENT_USER_ID = "00000000-0000-0000-0000-0000000000a9";
const ALREADY_ADMIN_USER_ID = "00000000-0000-0000-0000-0000000000aa";
const APPLICATION_ID = "00000000-0000-0000-0000-00000000000c";

// ── Fakes ─────────────────────────────────────────────────────────────────────

// Extensión LOCAL (solo de este archivo de test) de CallerVerifyResult con
// `role` opcional — ver comentario de seam v3.1 arriba. NO se importa de
// types.ts: el tipo real de producción sigue sin `role` hasta que GREEN lo
// decida. Estructuralmente sigue siendo un CallerVerifier válido porque
// `role` es opcional (superset asignable donde se espera el tipo real).
type CallerVerifyResultWithRole =
  | { ok: true; user_id: string; role?: string | null }
  | { ok: false; error_code: "UNAUTHENTICATED" };

interface FakeVerifier extends CallerVerifier {
  calls: (string | null)[];
}

interface FakeVerifierWithRole {
  calls: (string | null)[];
  verify_caller(header: string | null): Promise<CallerVerifyResultWithRole>;
}

// `role` es opcional a propósito: los tests que esperan 201 (buscador/user
// normal) NO lo pasan — undefined ⇒ se permite, un caller sin rol marcado
// no debe bloquearse. Solo R-12/R-12b lo pasan explícito.
function verifier_ok(
  user_id = USER_ID,
  role?: string | null,
): FakeVerifierWithRole {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResultWithRole> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id, role });
    },
  } as FakeVerifierWithRole;
}

function verifier_unauthenticated(): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: false, error_code: "UNAUTHENTICATED" });
    },
  } as FakeVerifier;
}

interface FakeCreator extends ApplicationCreator {
  calls: CreateApplicationParams[];
}

function creator_ok(application_id = APPLICATION_ID): FakeCreator {
  return {
    calls: [],
    create(params: CreateApplicationParams): Promise<CreateApplicationResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: true, application_id });
    },
  } as FakeCreator;
}

function creator_error(
  error_code: "DUPLICATE_PENDING_APPLICATION" | "DB_ERROR",
): FakeCreator {
  return {
    calls: [],
    create(params: CreateApplicationParams): Promise<CreateApplicationResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: false, error_code });
    },
  } as FakeCreator;
}

// ── Helper de requests ────────────────────────────────────────────────────────

function make_request(body: string | null, method = "POST"): Request {
  return new Request("http://localhost/request-agent-upgrade", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer jwt-fake",
    },
    body: method === "POST" || method === "PUT" ? body : null,
  });
}

// ── CORS / Métodos ────────────────────────────────────────────────────────────

Deno.test("R-1: OPTIONS → 200 con headers CORS", async () => {
  const res = await handler(
    new Request("http://localhost/request-agent-upgrade", {
      method: "OPTIONS",
    }),
    { callerVerifier: verifier_ok(), applicationCreator: creator_ok() },
  );
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("R-2: GET → 405", async () => {
  const res = await handler(
    new Request("http://localhost/request-agent-upgrade", { method: "GET" }),
    { callerVerifier: verifier_ok(), applicationCreator: creator_ok() },
  );
  assertEquals(res.status, 405);
});

// ── Body / parse / validación ─────────────────────────────────────────────────

Deno.test("R-3: JSON inválido → 400", async () => {
  const res = await handler(make_request("esto no es json"), {
    callerVerifier: verifier_ok(),
    applicationCreator: creator_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("R-4: body vacío → tratado como {} → 201 con reason=null", async () => {
  const creator = creator_ok();
  const res = await handler(make_request(null), {
    callerVerifier: verifier_ok(),
    applicationCreator: creator,
  });
  assertEquals(res.status, 201);
  assertEquals(creator.calls[0].reason, null);
});

Deno.test("R-5: reason no-string (number) → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ reason: 12345 })),
    { callerVerifier: verifier_ok(), applicationCreator: creator_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("R-6: reason solo espacios → normalizado a null", async () => {
  const creator = creator_ok();
  const res = await handler(
    make_request(JSON.stringify({ reason: "   " })),
    { callerVerifier: verifier_ok(), applicationCreator: creator },
  );
  assertEquals(res.status, 201);
  assertEquals(creator.calls[0].reason, null);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

Deno.test("R-7: verifier UNAUTHENTICATED → 401 y el creator NO se llama", async () => {
  const creator = creator_ok();
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_unauthenticated(),
    applicationCreator: creator,
  });
  assertEquals(res.status, 401);
  assertEquals(creator.calls.length, 0);
});

// ── Mapeo de errores del creator ──────────────────────────────────────────────

Deno.test("R-8: DUPLICATE_PENDING_APPLICATION → 409", async () => {
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_ok(),
    applicationCreator: creator_error("DUPLICATE_PENDING_APPLICATION"),
  });
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "DUPLICATE_PENDING_APPLICATION");
});

Deno.test("R-9: DB_ERROR → 500", async () => {
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_ok(),
    applicationCreator: creator_error("DB_ERROR"),
  });
  assertEquals(res.status, 500);
});

// ── Happy path / anti-spoofing ────────────────────────────────────────────────

Deno.test("R-10: éxito → 201 con application_id; params correctos al creator", async () => {
  const creator = creator_ok();
  const res = await handler(
    make_request(JSON.stringify({ reason: "Quiero atender más zonas" })),
    { callerVerifier: verifier_ok(), applicationCreator: creator },
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.application_id, APPLICATION_ID);
  assertEquals(creator.calls.length, 1);
  assertEquals(creator.calls[0].user_id, USER_ID);
  assertEquals(creator.calls[0].reason, "Quiero atender más zonas");
});

Deno.test("R-11: user_id/application_type del payload se IGNORAN (JWT manda)", async () => {
  const creator = creator_ok();
  const res = await handler(
    make_request(JSON.stringify({
      user_id: "99999999-9999-9999-9999-999999999999",
      application_type: "under_agency",
      reason: "Intento de spoof",
    })),
    { callerVerifier: verifier_ok(), applicationCreator: creator },
  );
  assertEquals(res.status, 201);
  assertEquals(creator.calls[0].user_id, USER_ID);
  // CreateApplicationParams no tiene application_type — el creator real
  // siempre inserta 'independent' (ver application_creator.ts); el payload
  // no puede forzar 'under_agency'.
  assertEquals("application_type" in creator.calls[0], false);
});

// ── [RED] Rol ya-agente/admin: aún SIN implementar (ver bloque de comentario
// al inicio del archivo para el contrato completo y por qué no se prescribe
// el mecanismo) ────────────────────────────────────────────────────────────

Deno.test("R-12 [RED]: caller con role='agent' → 409 ALREADY_AGENT, creator NO se llama", async () => {
  const creator = creator_ok();
  const res = await handler(
    make_request(JSON.stringify({ reason: "Quiero ser independiente" })),
    {
      callerVerifier: verifier_ok(ALREADY_AGENT_USER_ID, "agent"),
      applicationCreator: creator,
    },
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "ALREADY_AGENT");
  assertEquals(creator.calls.length, 0);
});

Deno.test("R-12b [RED]: caller con role='admin' → 409 ALREADY_AGENT, creator NO se llama", async () => {
  const creator = creator_ok();
  const res = await handler(
    make_request(JSON.stringify({ reason: "Quiero ser independiente" })),
    {
      callerVerifier: verifier_ok(ALREADY_ADMIN_USER_ID, "admin"),
      applicationCreator: creator,
    },
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "ALREADY_AGENT");
  assertEquals(creator.calls.length, 0);
});
