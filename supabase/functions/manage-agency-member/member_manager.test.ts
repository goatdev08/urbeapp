// supabase/functions/manage-agency-member/member_manager.test.ts
// Tests del AgencyMemberManager REAL (make_agency_member_manager).
// Ancla la lógica de dominio que los tests DI del handler nunca pueden ver
// (el handler mockea AgencyMemberManager por completo — ver handler.test.ts):
//   - reimplementación de private.can_manage_agency_member (owner/admin/agent/
//     viewer/admin-global) contra un cliente service_role duck-typed
//   - convención anti-IDOR 404 vs 403 (MEMBER_NOT_FOUND vs NOT_AUTHORIZED/
//     CANNOT_MANAGE_OWNER)
//   - tabla VALID_TRANSITIONS real (suspend/reactivate/remove)
//   - shape exacto del UPDATE payload (status, removed_at solo en remove)
//
// Motivo (hallazgo del guardian, 71.6): sin este archivo, borrar por completo
// el guard de autorización (`if (caller_can_manage)` -> `if (false)`) deja
// 756/756 verdes -- el módulo quedaba sin red propia, solo cubierto por el
// handler con el manager mockeado.
//
// Técnica: fake supabase client chainable con cola de respuestas por llamada
// `.from()` (MISMO patrón que update-property-status/property_status_updater.test.ts,
// que member_manager.ts declara espejar). Orden real de `.from()` dentro de
// `.manage()`:
//   1) agency_members: fila objetivo (member_id)
//   2) agency_members: membresía ACTIVA del caller en la agencia objetivo
//   3) users: perfil del caller (role, para admin global)
//   4) agency_members: UPDATE (solo si pasa autorización + transición válida)

import { assertEquals } from "@std/assert";
import { make_agency_member_manager } from "./member_manager.ts";

// ── Fake client ───────────────────────────────────────────────────────────────

interface FakeResponse {
  data: unknown;
  error: { message: string } | null;
}

interface CapturedCall {
  update_payload?: Record<string, unknown>;
  eq_calls: Array<[string, unknown]>;
}

/**
 * Crea un fake client chainable. Cada llamada a `.from()` consume el siguiente
 * response de `responses[]` y registra los `.eq()`/`.update()` de esa chain.
 */
function make_fake_client(responses: FakeResponse[]): {
  // deno-lint-ignore no-explicit-any
  client: { from(table: string): any };
  captured_calls: CapturedCall[];
} {
  let idx = 0;
  const captured_calls: CapturedCall[] = [];

  // deno-lint-ignore no-explicit-any
  function builder(response: FakeResponse, capture: CapturedCall): any {
    const b = {
      select(_cols?: string) {
        return this;
      },
      update(payload: Record<string, unknown>) {
        capture.update_payload = { ...payload };
        return this;
      },
      eq(col: string, val: unknown) {
        capture.eq_calls.push([col, val]);
        return this;
      },
      async maybeSingle() {
        return response;
      },
      async single() {
        return response;
      },
    };
    return b;
  }

  const client = {
    from(_table: string) {
      const i = idx++;
      const response = responses[i] ?? { data: null, error: null };
      const capture: CapturedCall = { eq_calls: [] };
      captured_calls.push(capture);
      return builder(response, capture);
    },
  };

  return { client, captured_calls };
}

// ── Constantes ────────────────────────────────────────────────────────────────

const MEMBER_ID = "00000000-0000-0000-0000-0000000b0001";
const AGENCY_ID = "00000000-0000-0000-0000-0000000b0002";
const OTHER_AGENCY_ID = "00000000-0000-0000-0000-0000000b0003";
const TARGET_USER_ID = "00000000-0000-0000-0000-0000000b0004";
const CALLER_ID = "00000000-0000-0000-0000-0000000b0005";

function target_row(
  overrides: Partial<{ member_role: string; status: string; agency_id: string; user_id: string }> = {},
) {
  return {
    id: MEMBER_ID,
    agency_id: AGENCY_ID,
    user_id: TARGET_USER_ID,
    member_role: "agent",
    status: "active",
    ...overrides,
  };
}

function ok_response(data: unknown): FakeResponse {
  return { data, error: null };
}

const NULL_RESPONSE: FakeResponse = { data: null, error: null };

function make_manager(responses: FakeResponse[]) {
  const { client, captured_calls } = make_fake_client(responses);
  return { manager: make_agency_member_manager(client), captured_calls };
}

function make_params(
  action: "suspend" | "reactivate" | "remove",
  caller_user_id = CALLER_ID,
  member_id = MEMBER_ID,
) {
  return { caller_user_id, member_id, action };
}

// ── 1) Owner sobre agente de su propia agencia → permitido ──────────────────

Deno.test("manager_real_owner_suspende_agente_de_su_agencia_permitido", async () => {
  const { manager, captured_calls } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })), // 1: fila objetivo
    ok_response({ member_role: "owner" }),                               // 2: membresía del caller (owner)
    ok_response({ role: "agent" }),                                      // 3: perfil caller (no admin global)
    ok_response(target_row({ status: "suspended" })),                   // 4: UPDATE
  ]);
  const result = await manager.manage(make_params("suspend"));

  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.member.status, "suspended");
  assertEquals(captured_calls.length, 4, "debe llegar hasta el UPDATE (4 llamadas .from())");
});

Deno.test("manager_real_owner_reactiva_agente_de_su_agencia_permitido", async () => {
  const { manager } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "suspended" })),
    ok_response({ member_role: "owner" }),
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "active" })),
  ]);
  const result = await manager.manage(make_params("reactivate"));

  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.member.status, "active");
});

Deno.test("manager_real_owner_da_de_baja_agente_de_su_agencia_permitido", async () => {
  const { manager } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })),
    ok_response({ member_role: "owner" }),
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "removed" })),
  ]);
  const result = await manager.manage(make_params("remove"));

  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.member.status, "removed");
});

// ── 2) Admin de agencia sobre agente (NO owner) → permitido ─────────────────

Deno.test("manager_real_admin_de_agencia_gestiona_agente_permitido", async () => {
  const { manager } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })),
    ok_response({ member_role: "admin" }),
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "suspended" })),
  ]);
  const result = await manager.manage(make_params("suspend"));

  assertEquals(result.ok, true);
});

// ── 3) [MATA EL MUTANTE] Admin de agencia sobre la fila OWNER → CANNOT_MANAGE_OWNER ──

Deno.test("manager_real_admin_de_agencia_sobre_fila_owner_devuelve_CANNOT_MANAGE_OWNER", async () => {
  const { manager, captured_calls } = make_manager([
    ok_response(target_row({ member_role: "owner", status: "active" })), // fila objetivo es el OWNER
    ok_response({ member_role: "admin" }),                               // caller es admin de la MISMA agencia
    ok_response({ role: "agent" }),                                      // no admin global
    ok_response(target_row({ status: "suspended" })),                   // NUNCA debería llegar aquí
  ]);
  const result = await manager.manage(make_params("suspend"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "CANNOT_MANAGE_OWNER");
  assertEquals(
    captured_calls.length,
    3,
    "el guard de autorización debe cortar ANTES del UPDATE (solo 3 llamadas .from())",
  );
});

// ── 4) agent/viewer intentando gestionar → NOT_AUTHORIZED ───────────────────

Deno.test("manager_real_agent_intenta_gestionar_devuelve_NOT_AUTHORIZED", async () => {
  // La fila objetivo es la PROPIA fila del caller (visible vía members_select
  // "user_id = self"), para aislar el guard de AUTORIZACIÓN de ESCRITURA del
  // de VISIBILIDAD -- un agent raso sobre la fila de OTRO usuario ni siquiera
  // la ve (-> MEMBER_NOT_FOUND, caso 5); sobre la propia SÍ la ve pero no
  // puede gestionarla (-> NOT_AUTHORIZED, este caso).
  const { manager, captured_calls } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active", user_id: CALLER_ID })),
    ok_response({ member_role: "agent" }), // caller es agent raso de esa agencia
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "suspended" })), // no debería llegar
  ]);
  const result = await manager.manage(make_params("suspend"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "NOT_AUTHORIZED");
  assertEquals(captured_calls.length, 3, "solo lectura, sin UPDATE");
});

Deno.test("manager_real_viewer_intenta_gestionar_devuelve_NOT_AUTHORIZED", async () => {
  const { manager } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })),
    ok_response({ member_role: "viewer" }), // caller es viewer de esa agencia
    ok_response({ role: "agent" }),
  ]);
  const result = await manager.manage(make_params("suspend"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "NOT_AUTHORIZED");
});

// ── 5) [Anti-IDOR] caller sin membresía en la agencia objetivo → MEMBER_NOT_FOUND (404, NO 403) ──

Deno.test("manager_real_caller_de_otra_agencia_devuelve_MEMBER_NOT_FOUND_no_403", async () => {
  // La fila objetivo pertenece a AGENCY_ID; el caller NO tiene membresía activa
  // ahí (su query de membresía por agency_id=AGENCY_ID no matchea -> null) y
  // tampoco es la propia fila ni admin global -> debe ocultarse como 404, NO
  // filtrar un 403 que revelaría que la fila existe.
  const { manager } = make_manager([
    ok_response(target_row({ agency_id: AGENCY_ID })),
    NULL_RESPONSE,               // caller no tiene membresía activa en AGENCY_ID
    ok_response({ role: "agent" }), // no admin global
  ]);
  const result = await manager.manage(make_params("suspend", CALLER_ID));

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(
      result.error_code,
      "MEMBER_NOT_FOUND",
      "caller ajeno a la agencia debe ver 404, nunca 403 (anti-IDOR)",
    );
  }
});

Deno.test("manager_real_owner_de_otra_agencia_no_ve_miembro_ajeno_MEMBER_NOT_FOUND", async () => {
  // Variante: el caller SÍ es owner, pero de OTHER_AGENCY_ID, no de la agencia
  // de la fila objetivo -- sigue sin ser visible.
  const { manager } = make_manager([
    ok_response(target_row({ agency_id: AGENCY_ID })),
    NULL_RESPONSE, // su membresía owner es de OTHER_AGENCY_ID, no matchea agency_id=AGENCY_ID
    ok_response({ role: "agent" }),
  ]);
  const result = await manager.manage({
    caller_user_id: CALLER_ID,
    member_id: MEMBER_ID,
    action: "suspend" as const,
  });
  void OTHER_AGENCY_ID; // documental: la membresía real del caller vive en otra agencia

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "MEMBER_NOT_FOUND");
});

// ── 6) member_id inexistente → MEMBER_NOT_FOUND ─────────────────────────────

Deno.test("manager_real_member_id_inexistente_devuelve_MEMBER_NOT_FOUND", async () => {
  const { manager, captured_calls } = make_manager([
    NULL_RESPONSE, // fila objetivo: no existe
  ]);
  const result = await manager.manage(make_params("suspend"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "MEMBER_NOT_FOUND");
  assertEquals(
    captured_calls.length,
    1,
    "member_id inexistente corta en la primera query (sin consultar caller)",
  );
});

// ── 7) Admin global → permitido incluso sobre la fila owner ─────────────────

Deno.test("manager_real_admin_global_gestiona_incluso_fila_owner_permitido", async () => {
  const { manager } = make_manager([
    ok_response(target_row({ member_role: "owner", status: "active" })),
    NULL_RESPONSE,                 // admin global no necesita membresía en esa agencia
    ok_response({ role: "admin" }), // caller es admin global
    ok_response(target_row({ member_role: "owner", status: "removed" })),
  ]);
  const result = await manager.manage(make_params("remove"));

  assertEquals(result.ok, true);
  if (result.ok) assertEquals(result.member.status, "removed");
});

// ── 8) Transición inválida (removed -> suspended vía VALID_TRANSITIONS real) → INVALID_TRANSITION ──

Deno.test("manager_real_transicion_invalida_removed_a_suspended_devuelve_INVALID_TRANSITION", async () => {
  const { manager, captured_calls } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "removed" })), // ya dado de baja
    ok_response({ member_role: "owner" }),
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "suspended" })), // NUNCA debería llegar aquí
  ]);
  const result = await manager.manage(make_params("suspend"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
  assertEquals(
    captured_calls.length,
    3,
    "transición inválida corta ANTES del UPDATE (solo 3 llamadas .from())",
  );
});

Deno.test("manager_real_transicion_invalida_active_a_active_reactivate_devuelve_INVALID_TRANSITION", async () => {
  // reactivate solo es válido desde 'suspended' -- desde 'active' es inválida.
  const { manager } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })),
    ok_response({ member_role: "owner" }),
    ok_response({ role: "agent" }),
  ]);
  const result = await manager.manage(make_params("reactivate"));

  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error_code, "INVALID_TRANSITION");
});

// ── Shape exacto del UPDATE (riesgo: mock pasa, prod falla) ──────────────────

Deno.test("manager_real_update_payload_remove_incluye_removed_at", async () => {
  const { manager, captured_calls } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })),
    ok_response({ member_role: "owner" }),
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "removed" })),
  ]);
  await manager.manage(make_params("remove"));

  const update_payload = captured_calls[3].update_payload;
  assertEquals(update_payload?.status, "removed");
  assertEquals(
    typeof update_payload?.removed_at,
    "string",
    "el UPDATE de 'remove' debe incluir removed_at (timestamp ISO)",
  );
});

Deno.test("manager_real_update_payload_suspend_NO_incluye_removed_at", async () => {
  const { manager, captured_calls } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })),
    ok_response({ member_role: "owner" }),
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "suspended" })),
  ]);
  await manager.manage(make_params("suspend"));

  const update_payload = captured_calls[3].update_payload;
  assertEquals(update_payload?.status, "suspended");
  assertEquals(
    "removed_at" in (update_payload ?? {}),
    false,
    "el UPDATE de 'suspend' NO debe tocar removed_at",
  );
});

Deno.test("manager_real_update_eq_filtra_por_member_id", async () => {
  const { manager, captured_calls } = make_manager([
    ok_response(target_row({ member_role: "agent", status: "active" })),
    ok_response({ member_role: "owner" }),
    ok_response({ role: "agent" }),
    ok_response(target_row({ status: "suspended" })),
  ]);
  await manager.manage(make_params("suspend"));

  const id_eq = captured_calls[3].eq_calls.find(([col]) => col === "id");
  assertEquals(id_eq?.[1], MEMBER_ID, "UPDATE debe incluir .eq('id', member_id)");
});
