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
    full_name: string;
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

/**
 * Interfaz inyectable del cliente supabase.auth.admin.
 * En producción: el cliente supabase-js real (service_role).
 * En tests: un fake controlado que graba las llamadas.
 *
 * Por qué DI: permite testear la lógica sin llamar a Supabase real.
 */
export interface AuthAdminClient {
  createUser(params: CreateUserParams): Promise<AdminCreateUserResponse>;
  deleteUser(uid: string): Promise<void>;
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
  full_name: string;
}

// ── SUT — stub (fase RED) ─────────────────────────────────────────────────────

/**
 * Crea un usuario en auth.users via el admin client de Supabase.
 *
 * Pasos (GREEN lo implementará):
 *   1. Llamar admin.createUser con email, password, email_confirm: true,
 *      user_metadata: { full_name }.
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
 * @param payload { email, password, full_name } del payload validado.
 */
export async function create_agent_auth_user(
  _admin: AuthAdminClient,
  _payload: CreateAgentAuthUserPayload,
): Promise<CreateAgentAuthUserResult> {
  throw new Error("not_implemented");
}
