// supabase/functions/create-invitation/handler.test.ts
// Tests RED — subtarea 34.1
// Edge Function: create-invitation/handler.ts
// Framework: Deno.test + @std/assert
// Runner: deno test supabase/functions/create-invitation/handler.test.ts
//
// EDGE CASES (RED) — 34.1:
//
// ### CORS / Métodos HTTP
// - H-1: OPTIONS → 200 con headers CORS
// - H-2: GET → 405
//
// ### Body / parse (payload SIN campos requeridos: {} y body vacío son válidos)
// - H-3: JSON inválido (texto no-JSON) → 400
// - H-4: body vacío "" → tratado como {} → 201 con max_uses null
// - H-5: max_uses=0 → 400 · H-6: max_uses=2.5 → 400 · H-7: max_uses="5" → 400
// - H-8: expires_at en el pasado → 400
// - H-9: expires_at no parseable → 400
//
// ### Auth — CallerVerifier DI
// - H-10: verifier UNAUTHENTICATED → 401
//
// ### Mapeo de errores del creator
// - H-11: NOT_AGENCY_OWNER → 403
// - H-12: AGENCY_INACTIVE → 422
// - H-13: DB_ERROR → 500
//
// ### Happy path / anti-spoofing
// - H-14: éxito → 201 { invitation: { plain_token, ... } }; creator recibe
//         max_uses del payload y user_id del verifier
// - H-15: user_id/agency_id maliciosos en el payload se IGNORAN (el creator
//         recibe el user_id del JWT, nunca el del body)

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  CallerVerifier,
  CallerVerifyResult,
  CreatedInvitation,
  CreateInvitationParams,
  CreateInvitationResult,
  InvitationCreator,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "00000000-0000-0000-0000-00000000000a";

const INVITATION: CreatedInvitation = {
  token_id: "00000000-0000-0000-0000-00000000000b",
  plain_token: "Ab3dEf7h",
  agency_id: AGENCY_ID,
  max_uses: 5,
  expires_at: null,
};

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface FakeVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = OWNER_ID): FakeVerifier {
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

interface FakeCreator extends InvitationCreator {
  calls: CreateInvitationParams[];
}

function creator_ok(invitation: CreatedInvitation = INVITATION): FakeCreator {
  return {
    calls: [],
    create(params: CreateInvitationParams): Promise<CreateInvitationResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: true, invitation });
    },
  } as FakeCreator;
}

function creator_error(
  error_code: "NOT_AGENCY_OWNER" | "AGENCY_INACTIVE" | "DB_ERROR",
): FakeCreator {
  return {
    calls: [],
    create(params: CreateInvitationParams): Promise<CreateInvitationResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: false, error_code });
    },
  } as FakeCreator;
}

// ── Helper de requests ────────────────────────────────────────────────────────

function make_request(body: string | null, method = "POST"): Request {
  return new Request("http://localhost/create-invitation", {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer jwt-fake",
    },
    body: method === "POST" || method === "PUT" ? body : null,
  });
}

// ── CORS / Métodos ────────────────────────────────────────────────────────────

Deno.test("H-1: OPTIONS → 200 con headers CORS", async () => {
  const res = await handler(
    new Request("http://localhost/create-invitation", { method: "OPTIONS" }),
    { callerVerifier: verifier_ok(), invitationCreator: creator_ok() },
  );
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("H-2: GET → 405", async () => {
  const res = await handler(
    new Request("http://localhost/create-invitation", { method: "GET" }),
    { callerVerifier: verifier_ok(), invitationCreator: creator_ok() },
  );
  assertEquals(res.status, 405);
});

// ── Body / parse / validación ─────────────────────────────────────────────────

Deno.test("H-3: JSON inválido → 400", async () => {
  const res = await handler(make_request("esto no es json"), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("H-4: body vacío → tratado como {} → 201 con max_uses null", async () => {
  const creator = creator_ok({ ...INVITATION, max_uses: null });
  const res = await handler(make_request(null), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator,
  });
  assertEquals(res.status, 201);
  assertEquals(creator.calls[0].max_uses, null);
  assertEquals(creator.calls[0].expires_at, null);
});

Deno.test("H-5: max_uses=0 → 400", async () => {
  const res = await handler(make_request(JSON.stringify({ max_uses: 0 })), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("H-6: max_uses=2.5 → 400", async () => {
  const res = await handler(make_request(JSON.stringify({ max_uses: 2.5 })), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test('H-7: max_uses="5" (string) → 400', async () => {
  const res = await handler(make_request(JSON.stringify({ max_uses: "5" })), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("H-8: expires_at en el pasado → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ expires_at: "2020-01-01T00:00:00.000Z" })),
    { callerVerifier: verifier_ok(), invitationCreator: creator_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("H-9: expires_at no parseable → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ expires_at: "mañana como a las 5" })),
    { callerVerifier: verifier_ok(), invitationCreator: creator_ok() },
  );
  assertEquals(res.status, 400);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

Deno.test("H-10: verifier UNAUTHENTICATED → 401 y el creator NO se llama", async () => {
  const creator = creator_ok();
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_unauthenticated(),
    invitationCreator: creator,
  });
  assertEquals(res.status, 401);
  assertEquals(creator.calls.length, 0);
});

// ── Mapeo de errores del creator ──────────────────────────────────────────────

Deno.test("H-11: NOT_AGENCY_OWNER → 403", async () => {
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator_error("NOT_AGENCY_OWNER"),
  });
  assertEquals(res.status, 403);
});

Deno.test("H-12: AGENCY_INACTIVE → 422", async () => {
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator_error("AGENCY_INACTIVE"),
  });
  assertEquals(res.status, 422);
});

Deno.test("H-13: DB_ERROR → 500", async () => {
  const res = await handler(make_request(JSON.stringify({})), {
    callerVerifier: verifier_ok(),
    invitationCreator: creator_error("DB_ERROR"),
  });
  assertEquals(res.status, 500);
});

// ── Happy path / anti-spoofing ────────────────────────────────────────────────

Deno.test("H-14: éxito → 201 con invitation; params correctos al creator", async () => {
  const creator = creator_ok();
  const res = await handler(
    make_request(JSON.stringify({ max_uses: 5 })),
    { callerVerifier: verifier_ok(), invitationCreator: creator },
  );
  assertEquals(res.status, 201);
  const body = await res.json();
  assertEquals(body.invitation.plain_token, "Ab3dEf7h");
  assertEquals(body.invitation.token_id, INVITATION.token_id);
  assertEquals(creator.calls.length, 1);
  assertEquals(creator.calls[0].user_id, OWNER_ID);
  assertEquals(creator.calls[0].max_uses, 5);
});

Deno.test("H-15: user_id/agency_id del payload se IGNORAN (JWT manda)", async () => {
  const creator = creator_ok();
  const res = await handler(
    make_request(JSON.stringify({
      user_id: "99999999-9999-9999-9999-999999999999",
      agency_id: "88888888-8888-8888-8888-888888888888",
      max_uses: 1,
    })),
    { callerVerifier: verifier_ok(), invitationCreator: creator },
  );
  assertEquals(res.status, 201);
  assertEquals(creator.calls[0].user_id, OWNER_ID);
  // CreateInvitationParams no tiene agency_id — se deriva en el creator
  assertEquals("agency_id" in creator.calls[0], false);
});
