/**
 * api.ts — cliente de las Edge Functions de la feature agency.
 *
 * create-invitation: el OWNER autenticado genera un código de invitación para
 * SU agencia (la EF deriva la agencia de la membresía owner del JWT — el
 * payload solo lleva max_uses/expires_at). El código plano viaja UNA sola vez
 * en la respuesta; en BD queda solo el hash.
 *
 * register-agency (subtarea 71.4, tramo mobile): un usuario autenticado
 * (prospecto) funda una inmobiliaria propia — flujo SEPARADO de "Convertirme
 * en agente" (features/upgrade, que une la cuenta a una agencia EXISTENTE).
 * La agencia nace SIEMPRE 'pending_approval'; created_by_user_id sale del JWT
 * en el servidor (nunca viaja en el payload). logo_url es opcional — sin
 * pieza reutilizable de subida en mobile todavía (ver comentario ponytail en
 * register.tsx), se omite del payload cuando no hay valor.
 *
 * Mismo patrón que registration/api.ts y upgrade/api.ts: invoke con la sesión
 * del usuario, errores de negocio como { error: { code } } extraídos vía
 * edge-errors.
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

// ── register-agency (71.4) ───────────────────────────────────────────────────

export interface RegisterAgencyInput {
  name: string;
  slug: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  /** Opcional — omitido del payload cuando es null. */
  logo_url: string | null;
}

export interface RegisteredAgency {
  agency_id: string;
  name: string;
  slug: string;
  status: string;
  logo_url: string | null;
}

export interface RegisterAgencyOk {
  ok: true;
  agency: RegisteredAgency;
}

export async function register_agency(
  input: RegisterAgencyInput,
): Promise<RegisterAgencyOk | ApiError> {
  const body: Record<string, string> = {
    name: input.name,
    slug: input.slug,
    contact_name: input.contact_name,
    contact_phone: input.contact_phone,
    contact_email: input.contact_email,
  };
  if (input.logo_url !== null) {
    body['logo_url'] = input.logo_url;
  }

  const { data, error } = await supabase.functions.invoke('register-agency', { body });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, agency: data as RegisteredAgency };
}
