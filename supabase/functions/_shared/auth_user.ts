// _shared/auth_user.ts
// Stub mínimo — fase RED subtarea 5.3.
// El agente supabase implementará la lógica real en la fase GREEN de 5.3.
//
// Contrato público:
//   AuthAdminClient — interfaz inyectable del cliente supabase.auth.admin.
//   create_agent_auth_user(admin, payload) — crea usuario en auth.users con
//     email_confirm: true (la invitación reemplaza la verificación de email).
//     Devuelve { ok: true, user_id } o { ok: false, error_code, message }.
//
// Por qué email_confirm: true:
//   El flujo de invitación actúa como verificación de email implícita.
//   No queremos que el usuario reciba un correo de confirmación tras registrarse.
//
// Compensación (rollback parcial para 5.4+):
//   deleteUser existe en la interfaz para que pasos posteriores puedan revertir
//   la creación del usuario si falla algo más adelante (no hay transacción
//   distribuida entre auth.admin y public.*).

// ── Tipos públicos ────────────────────────────────────────────────────────────

/**
 * Parámetros que se pasan a supabase.auth.admin.createUser.
 * Tipados explícitamente para que el fake de tests pueda inspeccionarlos.
 */
export interface CreateUserParams {
  email: string;
  password: string;
  email_confirm: boolean;
  user_metadata: {
    first_name: string;
    last_name: string;
  };
}

/**
 * Respuesta de supabase.auth.admin.createUser (subconjunto mínimo).
 * El cliente real devuelve { data: { user: { id } } | null, error: ... | null }.
 */
export interface AdminCreateUserResponse {
  data: { user: { id: string } } | null;
  error: { message: string } | null;
}

// ── Tipos para invitación de owner (7.5) ─────────────────────────────────────

/**
 * Parámetros para supabase.auth.admin.generateLink({ type: 'invite', ... }).
 * `data` se pasa como user_metadata (first_name, last_name del owner).
 */
export interface GenerateInviteLinkParams {
  email: string;
  data?: Record<string, unknown>;
}

/**
 * Respuesta de supabase.auth.admin.generateLink (subconjunto mínimo).
 * action_link: URL de invitación con token OTP que el owner usa para activar su cuenta.
 */
export interface GenerateInviteLinkResponse {
  data: { user: { id: string }; action_link: string } | null;
  error: { message: string } | null;
}

/**
 * Interfaz inyectable del cliente supabase.auth.admin.
 * En producción: el cliente supabase-js real (service_role).
 * En tests: un fake controlado que graba las llamadas.
 *
 * Por qué DI: permite testear la lógica sin llamar a Supabase real.
 *
 * generateInviteLink (7.5): crea usuario sin password vía tipo 'invite' y
 * retorna action_link para que el owner active su cuenta.
 */
export interface AuthAdminClient {
  createUser(params: CreateUserParams): Promise<AdminCreateUserResponse>;
  deleteUser(uid: string): Promise<void>;
  generateInviteLink(
    params: GenerateInviteLinkParams,
  ): Promise<GenerateInviteLinkResponse>;
}

// ── Tipos de resultado ────────────────────────────────────────────────────────

export type CreateAgentAuthUserOk = {
  ok: true;
  user_id: string;
};

export type CreateAgentAuthUserError = {
  ok: false;
  error_code: "EMAIL_ALREADY_EXISTS" | "AUTH_CREATE_FAILED";
  message: string;
};

export type CreateAgentAuthUserResult =
  | CreateAgentAuthUserOk
  | CreateAgentAuthUserError;

// ── Payload de entrada ────────────────────────────────────────────────────────

export interface CreateAgentAuthUserPayload {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
}

// ── SUT — stub (fase RED) ─────────────────────────────────────────────────────

/**
 * Crea un usuario en auth.users via el admin client de Supabase.
 *
 * Pasos (GREEN lo implementará):
 *   1. Llamar admin.createUser con email, password, email_confirm: true,
 *      user_metadata: { first_name, last_name }.
 *   2. Si error.message contiene 'already registered' → EMAIL_ALREADY_EXISTS (409).
 *   3. Si error distinto → AUTH_CREATE_FAILED (500) con el mensaje del error.
 *   4. Si ok → { ok: true, user_id: data.user.id }.
 *
 * Nota sobre el trigger handle_new_user (migración 0002):
 *   Al crear el usuario en auth.users, el trigger crea automáticamente la fila
 *   en public.users con role='user', agency_id=NULL. NO hay que crear esa fila
 *   manualmente desde este código.
 *
 * @param admin   Cliente admin inyectable (DI).
 * @param payload { email, password, first_name, last_name } del payload validado.
 */
export async function create_agent_auth_user(
  admin: AuthAdminClient,
  payload: CreateAgentAuthUserPayload,
): Promise<CreateAgentAuthUserResult> {
  const { email, password, first_name, last_name } = payload;

  const params: CreateUserParams = {
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name, last_name },
  };

  const { data, error } = await admin.createUser(params);

  if (error !== null) {
    // Detectar email duplicado por el mensaje que devuelve Supabase Auth
    if (error.message.includes("already registered")) {
      return {
        ok: false,
        error_code: "EMAIL_ALREADY_EXISTS",
        message: error.message,
      };
    }
    // Cualquier otro error
    return {
      ok: false,
      error_code: "AUTH_CREATE_FAILED",
      message: error.message,
    };
  }

  if (data === null || data.user === null || data.user === undefined) {
    return {
      ok: false,
      error_code: "AUTH_CREATE_FAILED",
      message: "createUser no devolvió data.user",
    };
  }

  return {
    ok: true,
    user_id: data.user.id,
  };
}

// ── create_owner_invite — stub fase RED 7.5 ───────────────────────────────────

export interface CreateOwnerInvitePayload {
  email: string;
  first_name: string;
  last_name: string;
}

export type CreateOwnerInviteResult =
  | { ok: true; user_id: string; action_link: string }
  | {
    ok: false;
    error_code: "EMAIL_ALREADY_EXISTS" | "AUTH_INVITE_FAILED";
    message: string;
  };

/**
 * Crea un owner de agencia en auth.users vía invitación (sin password).
 * El owner activa su cuenta usando el action_link que Supabase envía por email.
 *
 * Pasos:
 *   1. admin.generateInviteLink({ email, data: { first_name, last_name } })
 *   2. Si error.message contiene 'already been registered' o 'already registered' → EMAIL_ALREADY_EXISTS.
 *   3. Cualquier otro error → AUTH_INVITE_FAILED.
 *   4. Si ok → { ok: true, user_id: data.user.id, action_link: data.action_link }.
 *
 * La función usa generateInviteLink (no createUser) para crear al owner SIN password:
 * el owner activa su cuenta usando el action_link recibido por email.
 */
export async function create_owner_invite(
  admin: AuthAdminClient,
  payload: CreateOwnerInvitePayload,
): Promise<CreateOwnerInviteResult> {
  const { email, first_name, last_name } = payload;

  const { data, error } = await admin.generateInviteLink({
    email,
    data: { first_name, last_name },
  });

  if (error !== null) {
    // Detectar email duplicado por el mensaje que devuelve Supabase Auth
    if (
      error.message.includes("already been registered") ||
      error.message.includes("already registered")
    ) {
      return {
        ok: false,
        error_code: "EMAIL_ALREADY_EXISTS",
        message: error.message,
      };
    }
    return {
      ok: false,
      error_code: "AUTH_INVITE_FAILED",
      message: error.message,
    };
  }

  if (data === null || data.user === null || data.user === undefined) {
    return {
      ok: false,
      error_code: "AUTH_INVITE_FAILED",
      message: "generateInviteLink no devolvió data.user",
    };
  }

  return {
    ok: true,
    user_id: data.user.id,
    action_link: data.action_link,
  };
}
