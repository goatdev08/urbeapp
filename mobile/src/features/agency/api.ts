/**
 * api.ts — cliente de la Edge Function create-invitation (feature agency).
 *
 * create-invitation: el OWNER autenticado genera un código de invitación para
 * SU agencia (la EF deriva la agencia de la membresía owner del JWT — el
 * payload solo lleva max_uses/expires_at). El código plano viaja UNA sola vez
 * en la respuesta; en BD queda solo el hash.
 *
 * Mismo patrón que registration/api.ts: invoke con la sesión del usuario,
 * errores de negocio como { error: { code } } extraídos vía edge-errors.
 */
import { supabase } from '@/lib/supabase/client';
import { extract_error_code } from '@/lib/supabase/edge-errors';

export interface CreatedInvitation {
  token_id: string;
  plain_token: string;
  agency_id: string;
  max_uses: number | null;
  expires_at: string | null;
}

export interface CreateInvitationOk {
  ok: true;
  invitation: CreatedInvitation;
}

export interface ApiError {
  ok: false;
  /** error_code del backend (NOT_AGENCY_OWNER, AGENCY_INACTIVE, …) o undefined si fue red. */
  code: string | undefined;
}

export interface CreateInvitationInput {
  max_uses: number | null;
  expires_at: string | null;
}

export async function create_invitation(
  input: CreateInvitationInput,
): Promise<CreateInvitationOk | ApiError> {
  const { data, error } = await supabase.functions.invoke('create-invitation', {
    body: {
      max_uses: input.max_uses,
      expires_at: input.expires_at,
    },
  });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, invitation: data.invitation };
}
