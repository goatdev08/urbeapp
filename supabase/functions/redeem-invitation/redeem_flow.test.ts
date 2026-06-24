// Tests 5.4 — Orquestación del canje: handler llama redeem_invitation_atomic (RPC) tras crear
// el usuario, compensa con deleteUser si la RPC falla, y mapea los error_code a HTTP status.
// DI: se inyectan fakes de InvitationDb, AuthAdminClient e InvitationRedeemer (mock de dependencias,
// no del SUT). Runner: deno test --allow-net supabase/functions/redeem-invitation/redeem_flow.test.ts
//
// EDGE CASES:
// - Canje exitoso → 200 { user_id, agency_id, agency_name, agency_member_id }; redeemer llamado 1 vez
//   con token_id y user_id correctos; SIN compensación (deleteUser no se llama).
// - RPC TOKEN_MAX_USES_REACHED → 422 + compensación deleteUser(user_id).
// - RPC ALREADY_ACTIVE_MEMBER → 409 + compensación deleteUser(user_id).
// - RPC NO_ACTIVE_TERMS → 500 + compensación deleteUser(user_id).
// - Token inválido (db no encontrado) → 404; NO se crea usuario; redeemer NO se llama.
// - createUser falla (duplicado) → 409; redeemer NO se llama; deleteUser NO se llama.
// - ip (x-forwarded-for) se pasa a la RPC.

import { assertEquals } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  InvitationDb,
  InvitationTokenRow,
} from "../_shared/invitation.ts";
import type { AuthAdminClient } from "../_shared/auth_user.ts";
import type {
  InvitationRedeemer,
  RedeemParams,
  RedeemResult,
} from "../_shared/redeem.ts";

const PLAIN_CODE = "ABCDEF";
const TOKEN_ID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "00000000-0000-0000-0000-000000000002";
const AGENCY_NAME = "Inmobiliaria Demo SA de CV";
const USER_ID = "00000000-0000-0000-0000-000000000099";
const MEMBER_ID = "00000000-0000-0000-0000-0000000000aa";
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();

function fila_valida(): InvitationTokenRow {
  return {
    id: TOKEN_ID,
    agency_id: AGENCY_ID,
    token: "HASH",
    max_uses: 10,
    current_uses: 3,
    expires_at: FUTURE,
    revoked_at: null,
    agency_name: AGENCY_NAME,
    agency_status: "active",
  };
}

function db_valido(): InvitationDb {
  return { find_by_hash: (_h: string) => Promise.resolve(fila_valida()) };
}

function db_no_encontrado(): InvitationDb {
  return { find_by_hash: (_h: string) => Promise.resolve(null) };
}

interface FakeAdmin extends AuthAdminClient {
  delete_calls: string[];
  create_calls: number;
}

function admin_ok(): FakeAdmin {
  return {
    create_calls: 0,
    delete_calls: [],
    createUser(_params) {
      this.create_calls++;
      return Promise.resolve({ data: { user: { id: USER_ID } }, error: null });
    },
    deleteUser(uid: string) {
      this.delete_calls.push(uid);
      return Promise.resolve();
    },
  } as FakeAdmin;
}

function admin_duplicate(): FakeAdmin {
  return {
    create_calls: 0,
    delete_calls: [],
    createUser(_params) {
      this.create_calls++;
      return Promise.resolve({
        data: null,
        error: { message: "User already registered" },
      });
    },
    deleteUser(uid: string) {
      this.delete_calls.push(uid);
      return Promise.resolve();
    },
  } as FakeAdmin;
}

interface FakeRedeemer extends InvitationRedeemer {
  calls: RedeemParams[];
}

function redeemer_ok(): FakeRedeemer {
  return {
    calls: [],
    redeem_atomic(params: RedeemParams): Promise<RedeemResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: true, agency_member_id: MEMBER_ID });
    },
  } as FakeRedeemer;
}

function redeemer_error(code: string): FakeRedeemer {
  return {
    calls: [],
    redeem_atomic(params: RedeemParams): Promise<RedeemResult> {
      this.calls.push(params);
      return Promise.resolve({ ok: false, error_code: code });
    },
  } as FakeRedeemer;
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/redeem-invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const PAYLOAD = {
  invitationCode: PLAIN_CODE,
  email: "agente@inmobiliaria.mx",
  password: "secreto123",
  firstName: "Juan",
  lastName: "Pérez",
};

Deno.test("canje_exitoso_retorna_200_con_agency_member_id", async () => {
  const db = db_valido(), admin = admin_ok(), redeemer = redeemer_ok();
  const res = await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.user_id, USER_ID);
  assertEquals(body.agency_id, AGENCY_ID);
  assertEquals(body.agency_name, AGENCY_NAME);
  assertEquals(body.agency_member_id, MEMBER_ID);
});

Deno.test("canje_exitoso_invoca_redeemer_una_vez_con_token_y_user", async () => {
  const db = db_valido(), admin = admin_ok(), redeemer = redeemer_ok();
  await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(redeemer.calls.length, 1);
  assertEquals(redeemer.calls[0].token_id, TOKEN_ID);
  assertEquals(redeemer.calls[0].user_id, USER_ID);
});

Deno.test("canje_exitoso_no_compensa_deleteUser", async () => {
  const db = db_valido(), admin = admin_ok(), redeemer = redeemer_ok();
  await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(admin.delete_calls.length, 0);
});

Deno.test("rpc_token_agotado_retorna_422_y_compensa", async () => {
  const db = db_valido(), admin = admin_ok();
  const redeemer = redeemer_error("TOKEN_MAX_USES_REACHED");
  const res = await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(res.status, 422);
  const body = await res.json();
  assertEquals(body.error.code, "TOKEN_MAX_USES_REACHED");
  assertEquals(admin.delete_calls, [USER_ID]); // compensación: usuario huérfano eliminado
});

Deno.test("rpc_doble_membresia_retorna_409_y_compensa", async () => {
  const db = db_valido(), admin = admin_ok();
  const redeemer = redeemer_error("ALREADY_ACTIVE_MEMBER");
  const res = await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.error.code, "ALREADY_ACTIVE_MEMBER");
  assertEquals(admin.delete_calls, [USER_ID]);
});

Deno.test("rpc_error_servidor_retorna_500_y_compensa", async () => {
  const db = db_valido(), admin = admin_ok();
  const redeemer = redeemer_error("NO_ACTIVE_TERMS");
  const res = await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(res.status, 500);
  assertEquals(admin.delete_calls, [USER_ID]);
});

Deno.test("token_invalido_no_crea_usuario_ni_canjea", async () => {
  const db = db_no_encontrado(), admin = admin_ok(), redeemer = redeemer_ok();
  const res = await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(res.status, 404);
  assertEquals(admin.create_calls, 0);
  assertEquals(redeemer.calls.length, 0);
});

Deno.test("create_user_duplicado_no_canjea_ni_compensa", async () => {
  const db = db_valido(), admin = admin_duplicate(), redeemer = redeemer_ok();
  const res = await handler(post(PAYLOAD), { db, authAdmin: admin, redeemer });
  assertEquals(res.status, 409);
  assertEquals(redeemer.calls.length, 0); // no se canjea si no hubo usuario
  assertEquals(admin.delete_calls.length, 0); // no hay usuario que compensar
});

Deno.test("ip_x_forwarded_for_se_pasa_a_la_rpc", async () => {
  const db = db_valido(), admin = admin_ok(), redeemer = redeemer_ok();
  await handler(post(PAYLOAD, { "x-forwarded-for": "189.203.10.55" }), {
    db,
    authAdmin: admin,
    redeemer,
  });
  assertEquals(redeemer.calls[0].ip, "189.203.10.55");
});

Deno.test("ip_x_forwarded_for_lista_csv_se_pasa_solo_la_primera_ip", async () => {
  // x-forwarded-for puede ser una lista "cliente, proxy1, proxy2"; el tipo inet
  // de la RPC solo acepta UNA IP. Debe pasarse la primera (el cliente real),
  // recortada. Regresión: una lista CSV completa rompía la RPC con
  // "invalid input syntax for type inet".
  const db = db_valido(), admin = admin_ok(), redeemer = redeemer_ok();
  await handler(
    post(PAYLOAD, { "x-forwarded-for": "187.213.225.127, 99.82.166.107" }),
    { db, authAdmin: admin, redeemer },
  );
  assertEquals(redeemer.calls[0].ip, "187.213.225.127");
});
