// supabase/functions/upgrade-to-agent/handler.test.ts
// Tests RED v3 (pase Deno de las EFs) — subtarea 71.3, Camino A del wizard de
// upgrade a agente. El backend SQL (RPC upgrade_to_agent_atomic, migración
// 20260805000004, ver supabase/tests/22_upgrade_to_agent_test.sql) ya pasó el
// guardian; este archivo cubre el handler HTTP que envuelve esa RPC.
// Framework: Deno.test + @std/assert. Patrón DI mirror de
// create-invitation/handler.test.ts (mismos fakes con `calls`, mismo
// make_request, sin red real — el handler es puro y recibe deps inyectadas).
// Runner: deno test supabase/functions/upgrade-to-agent/handler.test.ts
//
// EDGE CASES:
//
// ### CORS / Métodos HTTP
// - U-1: OPTIONS → 200 con headers CORS
// - U-2: GET → 405
//
// ### Body / parse
// - U-3: JSON inválido (texto no-JSON) → 400
// - U-4: invitationCode ausente → 400
// - U-5: invitationCode vacío "" → 400
// - U-6: invitationCode con menos de 6 caracteres → 400
// - U-7: invitationCode no-string (number) → 400
//
// ### Auth — CallerVerifier DI
// - U-8: verifier UNAUTHENTICATED → 401, upgradeRunner NO se llama
//
// ### Mapeo P0001 → HTTP (UPGRADE_ERROR_STATUS, los 8 códigos de la RPC)
// - U-9  TOKEN_NOT_FOUND → 404
// - U-10 TOKEN_REVOKED → 422
// - U-11 TOKEN_EXPIRED → 422
// - U-12 TOKEN_MAX_USES_REACHED → 422
// - U-13 AGENCY_INACTIVE → 422
// - U-14 ALREADY_AGENT → 409
// - U-15 ALREADY_ACTIVE_MEMBER → 409
// - U-16 USER_NOT_FOUND → 500
// - U-17 código desconocido (no mapeado) → 500 (fallback ?? 500)
//
// ### Happy path / anti-spoofing (user_id SIEMPRE del JWT)
// - U-18: éxito → 200 { agency_id, agency_member_id }; runner recibe
//         user_id del verifier y token=invitationCode
// - U-19: user_id falsificado en el payload se IGNORA (el runner recibe el
//         user_id del JWT, nunca el del body)

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  UpgradeAtomicParams,
  UpgradeAtomicResult,
  UpgradeRunner,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const USER_ID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "00000000-0000-0000-0000-00000000000a";
const MEMBER_ID = "00000000-0000-0000-0000-00000000000b";

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface FakeVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = USER_ID): FakeVerifier {
  return {
    calls: [],
    verify_caller(header: string | null): Promise<CallerVerifyResult> {
      this.calls.push(header);
      return Promise.resolve({ ok: true, user_id });
    },
  } as FakeVerifier;
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

interface FakeRunner extends UpgradeRunner {
  calls: UpgradeAtomicParams[];
}

function runner_ok(
  result: { agency_id: string; agency_member_id: string } = {
    agency_id: AGENCY_ID,
    agency_member_id: MEMBER_ID,
  },
): FakeRunner {
  return {
    calls: [],
    upgrade_atomic(params: UpgradeAtomicParams): Promise<UpgradeAtomicResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: true, ...result });
    },
  } as FakeRunner;
}

function runner_error(error_code: string): FakeRunner {
  return {
    calls: [],
    upgrade_atomic(params: UpgradeAtomicParams): Promise<UpgradeAtomicResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: false, error_code });
    },
  } as FakeRunner;
}

// ── Helper de requests ────────────────────────────────────────────────────────

function make_request(body: string | null, method = "POST"): Request {
  return new Request("http://localhost/upgrade-to-agent", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer jwt-fake",
    },
    body: method === "POST" || method === "PUT" ? body : null,
  });
}

// ── CORS / Métodos ────────────────────────────────────────────────────────────

Deno.test("U-1: OPTIONS → 200 con headers CORS", async () => {
  const res = await handler(
    new Request("http://localhost/upgrade-to-agent", { method: "OPTIONS" }),
    { callerVerifier: verifier_ok(), upgradeRunner: runner_ok() },
  );
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("U-2: GET → 405", async () => {
  const res = await handler(
    new Request("http://localhost/upgrade-to-agent", { method: "GET" }),
    { callerVerifier: verifier_ok(), upgradeRunner: runner_ok() },
  );
  assertEquals(res.status, 405);
});

// ── Body / parse / validación ─────────────────────────────────────────────────

Deno.test("U-3: JSON inválido → 400", async () => {
  const res = await handler(make_request("esto no es json"), {
    callerVerifier: verifier_ok(),
    upgradeRunner: runner_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("U-4: invitationCode ausente → 400", async () => {
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_ok(),
    upgradeRunner: runner_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("U-5: invitationCode vacío → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ invitationCode: "" })),
    { callerVerifier: verifier_ok(), upgradeRunner: runner_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("U-6: invitationCode con menos de 6 caracteres → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ invitationCode: "Ab3dE" })),
    { callerVerifier: verifier_ok(), upgradeRunner: runner_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("U-7: invitationCode no-string (number) → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ invitationCode: 123456 })),
    { callerVerifier: verifier_ok(), upgradeRunner: runner_ok() },
  );
  assertEquals(res.status, 400);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

Deno.test("U-8: verifier UNAUTHENTICATED → 401 y el runner NO se llama", async () => {
  const runner = runner_ok();
  const res = await handler(
    make_request(JSON.stringify({ invitationCode: "Ab3dEf7h" })),
    { callerVerifier: verifier_unauthenticated(), upgradeRunner: runner },
  );
  assertEquals(res.status, 401);
  assertEquals(runner.calls.length, 0);
});

// ── Mapeo P0001 → HTTP ─────────────────────────────────────────────────────────

const ERROR_STATUS_CASES: Array<[string, number]> = [
  ["TOKEN_NOT_FOUND", 404],
  ["TOKEN_REVOKED", 422],
  ["TOKEN_EXPIRED", 422],
  ["TOKEN_MAX_USES_REACHED", 422],
  ["AGENCY_INACTIVE", 422],
  ["ALREADY_AGENT", 409],
  ["ALREADY_ACTIVE_MEMBER", 409],
  ["USER_NOT_FOUND", 500],
];

for (const [code, status] of ERROR_STATUS_CASES) {
  Deno.test(`U-9..16: ${code} → ${status}`, async () => {
    const res = await handler(
      make_request(JSON.stringify({ invitationCode: "Ab3dEf7h" })),
      { callerVerifier: verifier_ok(), upgradeRunner: runner_error(code) },
    );
    assertEquals(res.status, status);
    const body = await res.json();
    assertEquals(body.error.code, code);
  });
}

Deno.test("U-17: código de error desconocido → 500 (fallback)", async () => {
  const res = await handler(
    make_request(JSON.stringify({ invitationCode: "Ab3dEf7h" })),
    { callerVerifier: verifier_ok(), upgradeRunner: runner_error("ALGO_NUEVO_NO_MAPEADO") },
  );
  assertEquals(res.status, 500);
});

// ── Happy path / anti-spoofing ────────────────────────────────────────────────

Deno.test("U-18: éxito → 200 con agency_id/agency_member_id; params correctos al runner", async () => {
  const runner = runner_ok();
  const res = await handler(
    make_request(JSON.stringify({ invitationCode: "Ab3dEf7h" })),
    { callerVerifier: verifier_ok(), upgradeRunner: runner },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.agency_id, AGENCY_ID);
  assertEquals(body.agency_member_id, MEMBER_ID);
  assertEquals(runner.calls.length, 1);
  assertEquals(runner.calls[0].user_id, USER_ID);
  assertEquals(runner.calls[0].token, "Ab3dEf7h");
});

Deno.test("U-19: user_id falsificado en el payload se IGNORA (JWT manda)", async () => {
  const runner = runner_ok();
  const res = await handler(
    make_request(JSON.stringify({
      invitationCode: "Ab3dEf7h",
      user_id: "99999999-9999-9999-9999-999999999999",
    })),
    { callerVerifier: verifier_ok(), upgradeRunner: runner },
  );
  assertEquals(res.status, 200);
  assertEquals(runner.calls[0].user_id, USER_ID);
});
