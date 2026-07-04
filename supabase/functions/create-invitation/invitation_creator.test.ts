// supabase/functions/create-invitation/invitation_creator.test.ts
// Tests RED — subtarea 34.1
// Edge Function: create-invitation/invitation_creator.ts
// Framework: Deno.test + @std/assert
// Runner: deno test supabase/functions/create-invitation/invitation_creator.test.ts
//
// EDGE CASES (RED) — 34.1:
//
// ### Happy path
// - IC-1: owner activo + agencia activa + insert ok → ok:true; plain_token de 8
//         chars alfanuméricos; en BD se inserta sha256_hex(plain), NUNCA el plano
// - IC-7: created_by_user_id = user_id del caller; max_uses/expires_at pasan
//         al INSERT tal cual
// - IC-8: max_uses null → INSERT con max_uses null (ilimitado)
//
// ### Autorización (membresía owner)
// - IC-2: sin membresía owner activa → NOT_AGENCY_OWNER
//
// ### Agencia inactiva
// - IC-4: agencies.status='suspended' → AGENCY_INACTIVE
// - IC-5: agencia no encontrada (fila null) → AGENCY_INACTIVE (fail-closed)
//
// ### DB errors
// - IC-3: error en query de membresía → DB_ERROR
// - IC-6: error en INSERT → DB_ERROR

import { assertEquals, assertExists, assertMatch, assertNotEquals } from "@std/assert";
import { make_invitation_creator } from "./invitation_creator.ts";
import { sha256_hex } from "../_shared/crypto.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const OWNER_ID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "00000000-0000-0000-0000-00000000000a";
const TOKEN_ID = "00000000-0000-0000-0000-00000000000b";

// ── Fake client chainable (patrón note_updater.test.ts + insert) ─────────────

interface FakeResponse {
  data: unknown;
  error: { message: string } | null;
}

interface CapturedCall {
  table: string;
  insert_payload?: Record<string, unknown>;
  eq_calls: Array<[string, unknown]>;
}

function make_fake_client(responses: FakeResponse[]): {
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any };
  captured_calls: CapturedCall[];
} {
  let idx = 0;
  const captured_calls: CapturedCall[] = [];

  // deno-lint-ignore no-explicit-any
  function builder(response: FakeResponse, capture: CapturedCall): any {
    return {
      select(_cols?: string) {
        return this;
      },
      insert(payload: Record<string, unknown>) {
        capture.insert_payload = { ...payload };
        return this;
      },
      eq(col: string, val: unknown) {
        capture.eq_calls.push([col, val]);
        return this;
      },
      maybeSingle() {
        return Promise.resolve(response);
      },
      single() {
        return Promise.resolve(response);
      },
    };
  }

  const client = {
    from(table: string) {
      const capture: CapturedCall = { table, eq_calls: [] };
      captured_calls.push(capture);
      const response = responses[idx] ??
        { data: null, error: { message: "fake: sin response configurada" } };
      idx += 1;
      return builder(response, capture);
    },
  };

  return { client, captured_calls };
}

// Respuestas estándar del happy path: membresía → agencia → insert
function happy_responses(): FakeResponse[] {
  return [
    { data: { agency_id: AGENCY_ID }, error: null }, // agency_members
    { data: { status: "active" }, error: null }, // agencies
    { data: { id: TOKEN_ID }, error: null }, // insert token
  ];
}

const PARAMS = {
  user_id: OWNER_ID,
  max_uses: 5,
  expires_at: "2027-01-01T00:00:00.000Z",
};

// ── Happy path ────────────────────────────────────────────────────────────────

Deno.test("IC-1: happy path → ok:true, plano de 8 chars, BD recibe el hash", async () => {
  const { client, captured_calls } = make_fake_client(happy_responses());
  const creator = make_invitation_creator(client);

  const result = await creator.create(PARAMS);

  assertEquals(result.ok, true);
  if (!result.ok) return;
  assertEquals(result.invitation.token_id, TOKEN_ID);
  assertEquals(result.invitation.agency_id, AGENCY_ID);
  assertMatch(result.invitation.plain_token, /^[A-Za-z0-9]{8}$/);

  // El INSERT persiste sha256_hex(plano), nunca el plano
  const insert_call = captured_calls.find((c) => c.insert_payload !== undefined);
  assertExists(insert_call);
  const persisted_token = insert_call!.insert_payload!.token as string;
  assertNotEquals(persisted_token, result.invitation.plain_token);
  assertEquals(persisted_token, await sha256_hex(result.invitation.plain_token));
});

Deno.test("IC-7: created_by_user_id=caller y max_uses/expires_at van al INSERT", async () => {
  const { client, captured_calls } = make_fake_client(happy_responses());
  const creator = make_invitation_creator(client);

  const result = await creator.create(PARAMS);

  assertEquals(result.ok, true);
  const payload = captured_calls.find((c) => c.insert_payload)!.insert_payload!;
  assertEquals(payload.created_by_user_id, OWNER_ID);
  assertEquals(payload.agency_id, AGENCY_ID);
  assertEquals(payload.max_uses, 5);
  assertEquals(payload.expires_at, "2027-01-01T00:00:00.000Z");
});

Deno.test("IC-8: max_uses null → INSERT con null (ilimitado)", async () => {
  const { client, captured_calls } = make_fake_client(happy_responses());
  const creator = make_invitation_creator(client);

  const result = await creator.create({ ...PARAMS, max_uses: null, expires_at: null });

  assertEquals(result.ok, true);
  const payload = captured_calls.find((c) => c.insert_payload)!.insert_payload!;
  assertEquals(payload.max_uses, null);
  assertEquals(payload.expires_at, null);
});

// ── Autorización ──────────────────────────────────────────────────────────────

Deno.test("IC-2: sin membresía owner activa → NOT_AGENCY_OWNER", async () => {
  const { client } = make_fake_client([{ data: null, error: null }]);
  const creator = make_invitation_creator(client);

  const result = await creator.create(PARAMS);

  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.error_code, "NOT_AGENCY_OWNER");
});

Deno.test("IC-2b: la query de membresía filtra por user+owner+active", async () => {
  const { client, captured_calls } = make_fake_client(happy_responses());
  const creator = make_invitation_creator(client);

  await creator.create(PARAMS);

  const membership_call = captured_calls[0];
  assertEquals(membership_call.table, "agency_members");
  const eqs = new Map(membership_call.eq_calls);
  assertEquals(eqs.get("user_id"), OWNER_ID);
  assertEquals(eqs.get("member_role"), "owner");
  assertEquals(eqs.get("status"), "active");
});

// ── Agencia inactiva ──────────────────────────────────────────────────────────

Deno.test("IC-4: agencia suspendida → AGENCY_INACTIVE", async () => {
  const { client } = make_fake_client([
    { data: { agency_id: AGENCY_ID }, error: null },
    { data: { status: "suspended" }, error: null },
  ]);
  const creator = make_invitation_creator(client);

  const result = await creator.create(PARAMS);

  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.error_code, "AGENCY_INACTIVE");
});

Deno.test("IC-5: agencia no encontrada → AGENCY_INACTIVE (fail-closed)", async () => {
  const { client } = make_fake_client([
    { data: { agency_id: AGENCY_ID }, error: null },
    { data: null, error: null },
  ]);
  const creator = make_invitation_creator(client);

  const result = await creator.create(PARAMS);

  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.error_code, "AGENCY_INACTIVE");
});

// ── DB errors ─────────────────────────────────────────────────────────────────

Deno.test("IC-3: error en query de membresía → DB_ERROR", async () => {
  const { client } = make_fake_client([
    { data: null, error: { message: "conexión caída" } },
  ]);
  const creator = make_invitation_creator(client);

  const result = await creator.create(PARAMS);

  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.error_code, "DB_ERROR");
});

Deno.test("IC-6: error en INSERT → DB_ERROR", async () => {
  const { client } = make_fake_client([
    { data: { agency_id: AGENCY_ID }, error: null },
    { data: { status: "active" }, error: null },
    { data: null, error: { message: "unique violation" } },
  ]);
  const creator = make_invitation_creator(client);

  const result = await creator.create(PARAMS);

  assertEquals(result.ok, false);
  if (result.ok) return;
  assertEquals(result.error_code, "DB_ERROR");
});
