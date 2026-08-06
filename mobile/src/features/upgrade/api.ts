/**
 * api.ts — cliente de las Edge Functions del wizard "Convertirme en agente"
 * (§4.2, subtarea 71.3, tramo mobile).
 *
 * Camino A (token de invitación): reusa `validate_invitation` de
 * `features/registration/api.ts` TAL CUAL — misma EF `validate-invitation`,
 * mismo contrato — y agrega `upgrade_to_agent` para el canje (EF nueva
 * `upgrade-to-agent`, autenticada, user_id sale del JWT).
 * Camino B (solicitud a admin): `request_agent_upgrade` invoca la EF nueva
 * `request-agent-upgrade` (autenticada, reason opcional).
 *
 * Mismo patrón que agency/api.ts y auth/api.ts: supabase.functions.invoke
 * (adjunta el JWT de la sesión activa automáticamente) + extract_error_code
 * para recuperar el `code` cuando la EF responde { error: { code, message } }.
 */
import { supabase } from '@/lib/supabase/client';
import { extract_error_code } from '@/lib/supabase/edge-errors';

export interface ApiError {
  ok: false;
  /** error_code del backend (TOKEN_NOT_FOUND, ALREADY_AGENT, …) o undefined si fue red. */
  code: string | undefined;
}

// ── Camino A: canje del token (upgrade-to-agent) ────────────────────────────

export interface UpgradeToAgentOk {
  ok: true;
  agency_id: string;
  agency_member_id: string;
}

export async function upgrade_to_agent(
  invitationCode: string,
): Promise<UpgradeToAgentOk | ApiError> {
  const { data, error } = await supabase.functions.invoke('upgrade-to-agent', {
    body: { invitationCode: invitationCode.trim() },
  });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, agency_id: data.agency_id, agency_member_id: data.agency_member_id };
}

// ── Camino B: solicitud a admin (request-agent-upgrade) ─────────────────────

export interface RequestAgentUpgradeOk {
  ok: true;
  application_id: string;
}

export async function request_agent_upgrade(
  reason: string | null,
): Promise<RequestAgentUpgradeOk | ApiError> {
  const { data, error } = await supabase.functions.invoke('request-agent-upgrade', {
    body: { reason },
  });

  if (error !== null) {
    return { ok: false, code: await extract_error_code(error) };
  }
  return { ok: true, application_id: data.application_id };
}
