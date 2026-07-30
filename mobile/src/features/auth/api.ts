/**
 * api.ts — cliente de la Edge Function `register` (registro libre §5.1, subtarea 93.3).
 *
 * UBICACIÓN (decisión de la fase RED 93.3, ver bitácora de la subtarea):
 * vive en `features/auth` y NO se agrega a `features/registration/api.ts`.
 * `registration/api.ts` es el cliente del flujo de AGENTE por código de
 * invitación (validate-invitation/redeem-invitation) — un dominio cerrado que
 * el modo 'agent' de register.tsx ya usa tal cual. El registro libre (§5.1) es
 * un flujo de auth propio que comparte carpeta con validation.ts/auth-errors.ts
 * (modo 'user' de la misma pantalla) y con record-consents.ts (que esta misma
 * subtarea retira). Crear el archivo aquí es MENOS código neto que extender
 * registration/api.ts: no hay que tocar un módulo ajeno al dominio de agentes
 * ni mezclar tipos de agencia con los de un usuario libre. Mismo patrón que
 * registration/api.ts: supabase.functions.invoke + extract_error_code
 * (edge-errors.ts) para recuperar el `code` cuando la EF responde
 * { error: { code, message } }.
 *
 * Contrato real de la EF `register` (supabase/functions/register/{handler,types}.ts,
 * subtarea 93.2): POST público, body RegisterUserInput → 200 { user_id } |
 * 4xx/5xx { error: { code, message } } (INVALID_INPUT, UNDERAGE, PHONE_TAKEN,
 * EMAIL_ALREADY_EXISTS, AUTH_CREATE_FAILED, FIELDS_INCOMPLETE, NO_ACTIVE_TERMS,
 * NO_ACTIVE_PRIVACY, INTERNAL_ERROR).
 */

export interface RegisterUserInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  /** Ya en E.164 (+52##########) — el caller normaliza con to_e164_mx antes de invocar. */
  phone: string;
  /** YYYY-MM-DD */
  date_of_birth: string;
  /** 2 dígitos, catálogo INEGI mx_states */
  state_id: string;
  /** 5 dígitos (cvegeo), catálogo INEGI mx_municipalities */
  municipality_id: string;
}

export interface RegisterUserOk {
  ok: true;
  user_id: string;
}

export interface RegisterUserApiError {
  ok: false;
  /** error_code del backend (PHONE_TAKEN, EMAIL_ALREADY_EXISTS, UNDERAGE, …) o undefined si fue red. */
  code: string | undefined;
}

/**
 * ponytail: stub de la fase RED (93.3) — sin lógica todavía. La fase GREEN
 * invoca `supabase.functions.invoke('register', { body: input })` y traduce
 * el resultado con `extract_error_code`, mismo patrón que
 * `registration/api.ts::redeem_invitation`.
 */
export async function register_user(
  _input: RegisterUserInput,
): Promise<RegisterUserOk | RegisterUserApiError> {
  throw new Error('not_implemented');
}
