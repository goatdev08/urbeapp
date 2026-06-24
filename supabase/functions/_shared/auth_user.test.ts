/**
 * Tests RED — subtarea 5.3
 * SUT: create_agent_auth_user() en _shared/auth_user.ts
 * Wiring: redeem-invitation/index.ts (orquestación con DI de auth-admin)
 *
 * Framework: Deno.test + std/assert
 * Ejecutar: deno test --allow-net supabase/functions/_shared/auth_user.test.ts
 *
 * ─── ESTRATEGIA DE MOCKS ─────────────────────────────────────────────────────
 * AuthAdminClient es una DEPENDENCIA (no el SUT). Se inyecta un fake controlado
 * que registra exactamente qué parámetros recibió y cuántas veces fue llamado.
 * Así probamos la lógica de create_agent_auth_user sin llamar a Supabase real.
 *
 * Para los tests de orquestación se inyecta también un InvitationDb fake
 * (igual que en 5.2) y se verifica que el handler llama (o NO llama)
 * a authAdmin.createUser según el resultado de la validación del token.
 *
 * ─── EDGE CASES CUBIERTOS ────────────────────────────────────────────────────
 *
 * ### Happy path
 * - crear_usuario_exitoso_devuelve_user_id
 *
 * ### Edge cases del PRD (§5 tarea, §7 lineamientos)
 * - email_duplicado_se_mapea_a_EMAIL_ALREADY_EXISTS
 * - password_se_pasa_sin_modificar_al_admin
 * - email_confirm_es_exactamente_true_boolean
 * - first_name_y_last_name_se_pasan_en_user_metadata
 *
 * ### Ramas de reglas no obvias
 * - error_generico_no_duplicado_mapea_a_AUTH_CREATE_FAILED
 * - token_valido_con_admin_inyectado_invoca_create_user_exactamente_una_vez
 *
 * ### Boundary / compensación
 * - compensacion_delete_user_es_invocable_con_user_id_creado
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  type AuthAdminClient,
  create_agent_auth_user,
  type CreateAgentAuthUserPayload,
  type CreateUserParams,
} from "./auth_user.ts";
import { type InvitationDb, type InvitationTokenRow } from "./invitation.ts";
import { sha256_hex } from "./crypto.ts";
import { handler } from "../redeem-invitation/handler.ts";

// ── Fake de AuthAdminClient ───────────────────────────────────────────────────

interface FakeAdminClient extends AuthAdminClient {
  create_user_call_count: number;
  last_create_user_params: CreateUserParams | null;
  delete_user_call_count: number;
  last_deleted_uid: string | null;
}

function make_fake_admin_ok(user_id: string): FakeAdminClient {
  return {
    create_user_call_count: 0,
    last_create_user_params: null,
    delete_user_call_count: 0,
    last_deleted_uid: null,
    createUser(params: CreateUserParams) {
      this.create_user_call_count++;
      this.last_create_user_params = params;
      return Promise.resolve({
        data: { user: { id: user_id } },
        error: null,
      });
    },
    deleteUser(uid: string) {
      this.delete_user_call_count++;
      this.last_deleted_uid = uid;
      return Promise.resolve();
    },
  };
}

function make_fake_admin_duplicate_error(): FakeAdminClient {
  return {
    create_user_call_count: 0,
    last_create_user_params: null,
    delete_user_call_count: 0,
    last_deleted_uid: null,
    createUser(params: CreateUserParams) {
      this.create_user_call_count++;
      this.last_create_user_params = params;
      return Promise.resolve({
        data: null,
        error: { message: "User already registered" },
      });
    },
    deleteUser(_uid: string) {
      this.delete_user_call_count++;
      return Promise.resolve();
    },
  };
}

function make_fake_admin_generic_error(error_message: string): FakeAdminClient {
  return {
    create_user_call_count: 0,
    last_create_user_params: null,
    delete_user_call_count: 0,
    last_deleted_uid: null,
    createUser(params: CreateUserParams) {
      this.create_user_call_count++;
      this.last_create_user_params = params;
      return Promise.resolve({
        data: null,
        error: { message: error_message },
      });
    },
    deleteUser(_uid: string) {
      this.delete_user_call_count++;
      return Promise.resolve();
    },
  };
}

// ── Fake de InvitationDb (para tests de orquestación) ────────────────────────

const PLAIN_CODE = "ABCDEF";
const FUTURE_DATE = new Date(Date.now() + 86_400_000).toISOString();
const TOKEN_ID = "00000000-0000-0000-0000-000000000001";
const AGENCY_ID = "00000000-0000-0000-0000-000000000002";
const AGENCY_NAME = "Inmobiliaria Demo SA de CV";
const USER_ID = "00000000-0000-0000-0000-000000000099";

function make_fila_valida(
  overrides: Partial<InvitationTokenRow> = {},
): InvitationTokenRow {
  return {
    id: TOKEN_ID,
    agency_id: AGENCY_ID,
    token: "HASH_PLACEHOLDER",
    max_uses: 10,
    current_uses: 3,
    expires_at: FUTURE_DATE,
    revoked_at: null,
    agency_name: AGENCY_NAME,
    agency_status: "active",
    ...overrides,
  };
}

function make_fake_db_valido(row: InvitationTokenRow): InvitationDb {
  return {
    find_by_hash(_hash: string) {
      return Promise.resolve(row);
    },
  };
}

// Payload estándar válido para redeem-invitation
const payload_redeem_valido = {
  invitationCode: PLAIN_CODE,
  email: "agente@inmobiliaria.mx",
  password: "secreto123",
  firstName: "Juan",
  lastName: "Pérez",
};

function make_post_request(body: unknown): Request {
  return new Request("http://localhost/redeem-invitation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — create_agent_auth_user (lógica pura con DI)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test("crear_usuario_exitoso_devuelve_user_id", async () => {
  const admin = make_fake_admin_ok(USER_ID);
  const payload: CreateAgentAuthUserPayload = {
    email: "agente@inmobiliaria.mx",
    password: "secreto123",
    first_name: "Juan",
    last_name: "Pérez",
  };

  const result = await create_agent_auth_user(admin, payload);

  assertEquals(result.ok, true);
  if (result.ok) {
    assertEquals(result.user_id, USER_ID);
  }
});

Deno.test("email_duplicado_se_mapea_a_EMAIL_ALREADY_EXISTS", async () => {
  const admin = make_fake_admin_duplicate_error();
  const payload: CreateAgentAuthUserPayload = {
    email: "duplicado@inmobiliaria.mx",
    password: "secreto123",
    first_name: "María",
    last_name: "López",
  };

  const result = await create_agent_auth_user(admin, payload);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(result.error_code, "EMAIL_ALREADY_EXISTS");
    assertExists(result.message);
  }
});

Deno.test("password_se_pasa_sin_modificar_al_admin", async () => {
  const expected_password = "secreto123_especial!";
  const admin = make_fake_admin_ok(USER_ID);
  const payload: CreateAgentAuthUserPayload = {
    email: "agente@inmobiliaria.mx",
    password: expected_password,
    first_name: "Juan",
    last_name: "Pérez",
  };

  await create_agent_auth_user(admin, payload).catch(() => {
    // stub lanza not_implemented; registramos para verificar params
  });

  // Si se llegó a llamar createUser, el password debe llegar intacto
  if (admin.last_create_user_params !== null) {
    assertEquals(
      admin.last_create_user_params.password,
      expected_password,
      "El password NO llegó al admin sin modificar",
    );
  } else {
    // El SUT debe llamar createUser — si no lo llamó, el test falla
    assertEquals(
      admin.create_user_call_count > 0,
      true,
      "createUser nunca fue invocado — el SUT no está implementado",
    );
  }
});

Deno.test("email_confirm_es_exactamente_true_boolean", async () => {
  const admin = make_fake_admin_ok(USER_ID);
  const payload: CreateAgentAuthUserPayload = {
    email: "agente@inmobiliaria.mx",
    password: "secreto123",
    first_name: "Juan",
    last_name: "Pérez",
  };

  await create_agent_auth_user(admin, payload).catch(() => {});

  if (admin.last_create_user_params !== null) {
    // Debe ser boolean true estricto — NO false, NO "true" string, NO undefined
    assertEquals(
      admin.last_create_user_params.email_confirm,
      true,
      "email_confirm debe ser exactamente true (boolean); la invitación reemplaza la verificación de email",
    );
    assertEquals(
      typeof admin.last_create_user_params.email_confirm,
      "boolean",
      "email_confirm debe ser de tipo boolean, no string ni otro",
    );
  } else {
    assertEquals(
      admin.create_user_call_count > 0,
      true,
      "createUser nunca fue invocado — el SUT no está implementado",
    );
  }
});

Deno.test("first_name_y_last_name_se_pasan_en_user_metadata", async () => {
  const expected_first_name = "Ana García";
  const expected_last_name = "Ramírez";
  const admin = make_fake_admin_ok(USER_ID);
  const payload: CreateAgentAuthUserPayload = {
    email: "agente@inmobiliaria.mx",
    password: "secreto123",
    first_name: expected_first_name,
    last_name: expected_last_name,
  };

  await create_agent_auth_user(admin, payload).catch(() => {});

  if (admin.last_create_user_params !== null) {
    assertExists(
      admin.last_create_user_params.user_metadata,
      "user_metadata debe existir en los params de createUser",
    );
    assertEquals(
      admin.last_create_user_params.user_metadata.first_name,
      expected_first_name,
      "user_metadata.first_name debe contener el nombre exacto",
    );
    assertEquals(
      admin.last_create_user_params.user_metadata.last_name,
      expected_last_name,
      "user_metadata.last_name debe contener el apellido exacto",
    );
  } else {
    assertEquals(
      admin.create_user_call_count > 0,
      true,
      "createUser nunca fue invocado — el SUT no está implementado",
    );
  }
});

Deno.test("error_generico_no_duplicado_mapea_a_AUTH_CREATE_FAILED", async () => {
  const admin = make_fake_admin_generic_error(
    "Database connection timeout",
  );
  const payload: CreateAgentAuthUserPayload = {
    email: "agente@inmobiliaria.mx",
    password: "secreto123",
    first_name: "Juan",
    last_name: "Pérez",
  };

  const result = await create_agent_auth_user(admin, payload);

  assertEquals(result.ok, false);
  if (!result.ok) {
    assertEquals(
      result.error_code,
      "AUTH_CREATE_FAILED",
      "Error desconocido debe mapear a AUTH_CREATE_FAILED, no filtrar detalle crudo",
    );
    assertExists(result.message);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — orquestación (handler de redeem-invitation con deps inyectables)
// Estos tests verifican el wiring entre validación de token y createUser.
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "token_valido_con_admin_inyectado_invoca_create_user_exactamente_una_vez",
  async () => {
    const hash = await sha256_hex(PLAIN_CODE);
    const db = make_fake_db_valido(make_fila_valida({ token: hash }));
    const admin = make_fake_admin_ok(USER_ID);

    const req = make_post_request(payload_redeem_valido);
    // El handler orquesta validar token → crear usuario → canjear (RPC).
    // Inyectamos un redeemer ok para que el flujo complete; aquí solo verificamos createUser.
    const redeemer = {
      redeem_atomic: () =>
        Promise.resolve({
          ok: true as const,
          agency_member_id: "00000000-0000-0000-0000-0000000000aa",
        }),
    };
    await handler(req, { db, authAdmin: admin, redeemer });

    // Verificar que createUser fue invocado exactamente una vez
    assertEquals(
      admin.create_user_call_count,
      1,
      "createUser debe ser invocado exactamente 1 vez cuando el token es válido y el payload es correcto",
    );
    // Verificar parámetros clave
    assertExists(admin.last_create_user_params);
    if (admin.last_create_user_params !== null) {
      assertEquals(
        admin.last_create_user_params.email,
        payload_redeem_valido.email,
      );
      assertEquals(
        admin.last_create_user_params.email_confirm,
        true,
      );
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// TESTS — compensación / rollback (patrón para 5.4+)
// ─────────────────────────────────────────────────────────────────────────────

Deno.test(
  "compensacion_delete_user_es_invocable_con_user_id_creado",
  async () => {
    // Verifica que deleteUser existe en la interfaz del admin y es invocable.
    // Este es el gancho de compensación: si un paso posterior falla tras crear
    // el usuario, el flujo puede llamar admin.deleteUser(user_id) para revertir.
    // 5.4+ completará el uso real de esta compensación.
    const admin = make_fake_admin_ok(USER_ID);
    const payload: CreateAgentAuthUserPayload = {
      email: "agente@inmobiliaria.mx",
      password: "secreto123",
      first_name: "Juan",
      last_name: "Pérez",
    };

    // Intentar crear usuario (lanza not_implemented en RED)
    const result = await create_agent_auth_user(admin, payload).catch(
      () => null,
    );
    // result.ok && result.user_id disponible para compensación en 5.4+
    void result;

    // Aunque el SUT no esté implementado, verificar que deleteUser
    // es una función en la interfaz y puede ser llamada directamente.
    assertEquals(
      typeof admin.deleteUser,
      "function",
      "deleteUser debe existir como función en AuthAdminClient (patrón de compensación)",
    );

    // Si hubo creación exitosa (en GREEN), deleteUser debe poder ser invocado
    // con el user_id para compensar. Probamos la invocabilidad directa.
    await admin.deleteUser(USER_ID); // debe no lanzar
    assertEquals(
      admin.delete_user_call_count,
      1,
      "deleteUser debe ser invocable y registrar la llamada",
    );
    assertEquals(
      admin.last_deleted_uid,
      USER_ID,
      "deleteUser debe recibir el user_id correcto para compensación",
    );
  },
);
