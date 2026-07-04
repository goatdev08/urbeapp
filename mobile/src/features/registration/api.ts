/**
 * api.ts — cliente de las Edge Functions de registro de agente.
 *   validate-invitation: valida el código y devuelve el nombre de la inmobiliaria.
 *   redeem-invitation:   canjea el código, crea la cuenta y la liga a la inmobiliaria.
 *
 * Ambas se invocan con la anon key (supabase.functions.invoke); la lógica de
 * service_role vive dentro de la función. Los errores de negocio llegan como
 * { error: { code, message } } con status 4xx/5xx → supabase-js los entrega como
 * FunctionsHttpError, cuyo cuerpo parseamos para recuperar el `code`.
 */
import { supabase } from '@/lib/supabase/client';
import { extract_error_code } from '@/lib/supabase/edge-errors';

export interface ValidateOk {
  ok: true;
  agency_name: string;
}

export interface RedeemOk {
  ok: true;
  user_id: string;
  agency_id: string;
  agency_name: string;
  agency_member_id: string;
}

export interface ApiError {
  ok: false;
  /** error_code del backend (TOKEN_NOT_FOUND, EMAIL_ALREADY_EXISTS, …) o undefined si fue red. */
  code: string | undefined;
}

export interface RedeemInput {
  invitationCode: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export async function validate_invitation(
  code: string,
): Promise<ValidateOk | ApiError> {
  const { data, error } = await supabase.functions.invoke('validate-invitation', {
    body: { invitationCode: code.trim() },
  });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, agency_name: data.agency_name };
}

export async function redeem_invitation(
  input: RedeemInput,
): Promise<RedeemOk | ApiError> {
  const { data, error } = await supabase.functions.invoke('redeem-invitation', {
    body: {
      invitationCode: input.invitationCode.trim(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      email: input.email.trim(),
      password: input.password,
    },
  });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return {
    ok: true,
    user_id: data.user_id,
    agency_id: data.agency_id,
    agency_name: data.agency_name,
    agency_member_id: data.agency_member_id,
  };
}
