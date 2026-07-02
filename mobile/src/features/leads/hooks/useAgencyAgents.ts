/**
 * useAgencyAgents — STUB fase RED (subtarea 28.2).
 *
 * Contrato (implementación real, fase GREEN):
 *   - Solo ejecuta la query si enabled===true && agencyId!=null (enabled = isOwner,
 *     ver useAgencyRole de la subtarea 28.1).
 *   - Query: from('agency_members')
 *       .select('user_id, users(id, user_preferences(full_name, profile_photo_url))' as never)
 *       .eq('agency_id', agencyId).eq('member_role', 'agent').eq('status', 'active')
 *   - El owner NO se incluye (filtro member_role='agent' lo excluye).
 *   - Transforma cada fila raw → Agent { id, full_name, profile_photo_url } tomando
 *     full_name/profile_photo_url de user_preferences[0] (null si array vacío).
 *   - Ordena por full_name client-side (locale, nulls al final).
 *   - Error de query → agents=[], error poblado, sin crash.
 *
 * Este stub NO implementa nada — lanza para que la fase RED falle por excepción
 * (no por import ausente). La fase GREEN reemplaza el cuerpo.
 */

import type { Agent } from '../types';

export interface UseAgencyAgentsState {
  agents: Agent[];
  loading: boolean;
  error: string | null;
}

export function useAgencyAgents(
  _agencyId: string | null,
  _enabled: boolean
): UseAgencyAgentsState {
  throw new Error('not_implemented');
}
