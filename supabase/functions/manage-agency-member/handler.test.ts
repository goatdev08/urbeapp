// supabase/functions/manage-agency-member/handler.test.ts
// Tests RED — subtarea 71.6 (gestión de agentes por inmobiliaria — alta/baja/
// suspensión, PRD §4.7 "Funcionalidades MVP de la cuenta inmobiliaria: Alta,
// baja y suspensión de agentes asociados").
// Framework: Deno.test + @std/assert. Patrón DI mirror de
// register-agency/handler.test.ts / update-property-status/handler.test.ts
// (fakes con `calls`, `make_request`, sin red real — el handler es puro y
// recibe deps inyectadas).
// Runner: deno test supabase/functions/manage-agency-member/handler.test.ts
//
// SEAM bajo test: el contrato público del handler HTTP (request → status +
// body) construido sobre dos dependencias inyectables (CallerVerifier,
// AgencyMemberManager). El AgencyMemberManager real (GREEN, fuera de esta fase
// RED) reimplica en TS la matriz de permisos de private.can_manage_agency_member
// (owner=todo sobre su agencia; admin=todo EXCEPTO la fila owner; agent/viewer=
// nada) vía service_role — ver rationale completo en ./types.ts. Este archivo
// SOLO ejercita el handler con el manager MOCKEADO: no depende de Postgres.
//
// FASE RED: handler.ts es un STUB que SIEMPRE devuelve 501 NOT_IMPLEMENTED
// (no importa supabase-js, no tiene lógica de negocio) — cada caso de abajo
// falla por aserción de status/body, nunca por import faltante.
//
// EDGE CASES:
//
// ### CORS / Métodos HTTP
// - M-1: OPTIONS → 200 con headers CORS
// - M-2: GET → 405
// - M-3: PUT → 405
//
// ### Body / parse
// - M-4: JSON inválido (texto no-JSON) → 400
// - M-5: member_id ausente → 400
// - M-6: member_id vacío "" → 400
// - M-7: action ausente → 400
// - M-8: action con valor fuera de {suspend,reactivate,remove} (p.ej. "delete") → 400
//
// ### Auth — CallerVerifier DI
// - M-9: sin Authorization / verifier UNAUTHENTICATED → 401, el manager NO se llama
//
// ### Anti-spoofing (caller_user_id SIEMPRE del JWT)
// - M-10: caller_user_id falsificado en el payload se IGNORA — el manager
//         recibe el user_id del verifier, nunca el del body
//
// ### Happy path — una acción por transición de negocio (§4.7)
// - M-11: action='suspend'    → 200, member.status='suspended' (owner suspende a un agente)
// - M-12: action='reactivate' → 200, member.status='active' (owner reactiva a un suspendido)
// - M-13: action='remove'     → 200, member.status='removed' (baja definitiva)
//
// ### Mapeo error_code → HTTP (contrato fijado en esta fase RED)
// - M-14: MEMBER_NOT_FOUND     → 404 (miembro de otra agencia o inexistente — oculta existencia, ver types.ts)
// - M-15: NOT_AUTHORIZED       → 403 (caller es agent/viewer, o owner/admin de OTRA agencia sobre una fila que SÍ puede ver)
// - M-16: CANNOT_MANAGE_OWNER  → 403 (admin de agencia intentando tocar la fila owner)
// - M-17: INVALID_TRANSITION   → 409 (p.ej. reactivar a alguien ya activo)
// - M-18: DB_ERROR             → 500
// - M-19: código desconocido (no mapeado) → 500 (fallback ?? 500)

import { assertEquals, assertExists } from "@std/assert";
import { handler } from "./handler.ts";
import type {
  AgencyMemberManager,
  CallerVerifier,
  CallerVerifyResult,
  ManageAgencyMemberParams,
  ManageAgencyMemberResult,
  ManagedMember,
  MemberAction,
} from "./types.ts";

// ── Constantes ────────────────────────────────────────────────────────────────

const CALLER_ID = "00000000-0000-0000-0000-0000000a0001";
const SPOOFED_CALLER_ID = "99999999-9999-9999-9999-999999999999";
const MEMBER_ID = "00000000-0000-0000-0000-0000000a000b";
const AGENCY_ID = "00000000-0000-0000-0000-0000000a000c";
const TARGET_USER_ID = "00000000-0000-0000-0000-0000000a000d";

const VALID_PAYLOAD = { member_id: MEMBER_ID, action: "suspend" as MemberAction };

// ── Fakes ─────────────────────────────────────────────────────────────────────

interface FakeVerifier extends CallerVerifier {
  calls: (string | null)[];
}

function verifier_ok(user_id = CALLER_ID): FakeVerifier {
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

interface FakeManager extends AgencyMemberManager {
  calls: ManageAgencyMemberParams[];
}

function managed_member(overrides: Partial<ManagedMember> = {}): ManagedMember {
  return {
    id: MEMBER_ID,
    agency_id: AGENCY_ID,
    user_id: TARGET_USER_ID,
    member_role: "agent",
    status: "suspended",
    ...overrides,
  };
}

function manager_ok(member: ManagedMember = managed_member()): FakeManager {
  return {
    calls: [],
    manage(params: ManageAgencyMemberParams): Promise<ManageAgencyMemberResult> {
      this.calls.push({ ...params });
      return Promise.resolve({ ok: true, member });
    },
  } as FakeManager;
}

function manager_error(error_code: string): FakeManager {
  return {
    calls: [],
    manage(params: ManageAgencyMemberParams): Promise<ManageAgencyMemberResult> {
      this.calls.push({ ...params });
      return Promise.resolve(
        { ok: false, error_code } as unknown as ManageAgencyMemberResult,
      );
    },
  } as FakeManager;
}

// ── Helper de requests ────────────────────────────────────────────────────────

function make_request(
  body: string | null,
  method = "POST",
  withAuth = true,
): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (withAuth) headers["Authorization"] = "Bearer jwt-fake";
  return new Request("http://localhost/manage-agency-member", {
    method,
    headers,
    body: method === "POST" || method === "PUT" ? body : null,
  });
}

// ── CORS / Métodos ────────────────────────────────────────────────────────────

Deno.test("M-1: OPTIONS → 200 con headers CORS", async () => {
  const res = await handler(
    new Request("http://localhost/manage-agency-member", { method: "OPTIONS" }),
    { callerVerifier: verifier_ok(), memberManager: manager_ok() },
  );
  assertEquals(res.status, 200);
  assertExists(res.headers.get("Access-Control-Allow-Origin"));
});

Deno.test("M-2: GET → 405", async () => {
  const res = await handler(
    new Request("http://localhost/manage-agency-member", { method: "GET" }),
    { callerVerifier: verifier_ok(), memberManager: manager_ok() },
  );
  assertEquals(res.status, 405);
});

Deno.test("M-3: PUT → 405", async () => {
  const res = await handler(
    make_request(JSON.stringify(VALID_PAYLOAD), "PUT"),
    { callerVerifier: verifier_ok(), memberManager: manager_ok() },
  );
  assertEquals(res.status, 405);
});

// ── Body / parse / validación ─────────────────────────────────────────────────

Deno.test("M-4: JSON inválido → 400", async () => {
  const res = await handler(make_request("esto no es json"), {
    callerVerifier: verifier_ok(),
    memberManager: manager_ok(),
  });
  assertEquals(res.status, 400);
});

Deno.test("M-5: member_id ausente → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ action: "suspend" })),
    { callerVerifier: verifier_ok(), memberManager: manager_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("M-6: member_id vacío → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ ...VALID_PAYLOAD, member_id: "" })),
    { callerVerifier: verifier_ok(), memberManager: manager_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("M-7: action ausente → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ member_id: MEMBER_ID })),
    { callerVerifier: verifier_ok(), memberManager: manager_ok() },
  );
  assertEquals(res.status, 400);
});

Deno.test("M-8: action fuera de {suspend,reactivate,remove} → 400", async () => {
  const res = await handler(
    make_request(JSON.stringify({ ...VALID_PAYLOAD, action: "delete" })),
    { callerVerifier: verifier_ok(), memberManager: manager_ok() },
  );
  assertEquals(res.status, 400);
});

// ── Auth ──────────────────────────────────────────────────────────────────────

Deno.test("M-9: sin autenticación → 401 y el manager NO se llama", async () => {
  const manager = manager_ok();
  const res = await handler(
    make_request(JSON.stringify(VALID_PAYLOAD)),
    { callerVerifier: verifier_unauthenticated(), memberManager: manager },
  );
  assertEquals(res.status, 401);
  assertEquals(manager.calls.length, 0);
});

// ── Anti-spoofing ──────────────────────────────────────────────────────────────

Deno.test("M-10: caller_user_id falsificado en el payload se IGNORA (JWT manda)", async () => {
  const manager = manager_ok();
  const res = await handler(
    make_request(
      JSON.stringify({ ...VALID_PAYLOAD, caller_user_id: SPOOFED_CALLER_ID }),
    ),
    { callerVerifier: verifier_ok(), memberManager: manager },
  );
  assertEquals(res.status, 200);
  assertEquals(manager.calls.length, 1);
  assertEquals(manager.calls[0].caller_user_id, CALLER_ID);
});

// ── Happy path ─────────────────────────────────────────────────────────────────

Deno.test("M-11: action=suspend → 200, owner suspende a un agente de su agencia", async () => {
  const manager = manager_ok(managed_member({ status: "suspended" }));
  const res = await handler(
    make_request(JSON.stringify({ member_id: MEMBER_ID, action: "suspend" })),
    { callerVerifier: verifier_ok(), memberManager: manager },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.member.status, "suspended");
  assertEquals(body.member.id, MEMBER_ID);
  assertEquals(manager.calls.length, 1);
  assertEquals(manager.calls[0].action, "suspend");
  assertEquals(manager.calls[0].member_id, MEMBER_ID);
});

Deno.test("M-12: action=reactivate → 200, owner reactiva a un agente suspendido", async () => {
  const manager = manager_ok(managed_member({ status: "active" }));
  const res = await handler(
    make_request(JSON.stringify({ member_id: MEMBER_ID, action: "reactivate" })),
    { callerVerifier: verifier_ok(), memberManager: manager },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.member.status, "active");
  assertEquals(manager.calls[0].action, "reactivate");
});

Deno.test("M-13: action=remove → 200, baja definitiva del agente", async () => {
  const manager = manager_ok(managed_member({ status: "removed" }));
  const res = await handler(
    make_request(JSON.stringify({ member_id: MEMBER_ID, action: "remove" })),
    { callerVerifier: verifier_ok(), memberManager: manager },
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.member.status, "removed");
  assertEquals(manager.calls[0].action, "remove");
});

// ── Mapeo error_code → HTTP ──────────────────────────────────────────────────

const ERROR_STATUS_CASES: Array<[string, number]> = [
  ["MEMBER_NOT_FOUND", 404],
  ["NOT_AUTHORIZED", 403],
  ["CANNOT_MANAGE_OWNER", 403],
  ["INVALID_TRANSITION", 409],
  ["DB_ERROR", 500],
];

for (const [code, status] of ERROR_STATUS_CASES) {
  Deno.test(`M-14..18: ${code} → ${status}`, async () => {
    const res = await handler(
      make_request(JSON.stringify(VALID_PAYLOAD)),
      { callerVerifier: verifier_ok(), memberManager: manager_error(code) },
    );
    assertEquals(res.status, status);
    const body = await res.json();
    assertEquals(body.error.code, code);
  });
}

Deno.test("M-19: código de error desconocido → 500 (fallback)", async () => {
  const res = await handler(
    make_request(JSON.stringify(VALID_PAYLOAD)),
    {
      callerVerifier: verifier_ok(),
      memberManager: manager_error("ALGO_NUEVO_NO_MAPEADO"),
    },
  );
  assertEquals(res.status, 500);
});
