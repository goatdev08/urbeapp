/**
 * useAgentLeads — STUB fase RED (subtarea 15.2).
 *
 * El hook carga los leads del agente autenticado con info del usuario interesado
 * (phone de users, full_name/profile_photo_url de user_preferences) y la
 * propiedad de origen (lead_origin_properties → properties → property_videos).
 *
 * Contrato:
 *   - Filtra: deleted_at IS NULL. RLS (migración 0008) filtra agent_id = auth.uid().
 *   - Ordena: updated_at DESC.
 *   - Devuelve: { leads: AgentLead[], loading: boolean, error: string | null, refetch: () => void }
 *
 * STUB: retorna estado vacío fijo para que los tests de la fase RED fallen
 * por aserción (no por import/parse). No contiene lógica de negocio.
 * La implementación real va en la fase GREEN.
 */

import type { AgentLead } from '../types';

// ---------------------------------------------------------------------------
// Tipo de retorno público
// ---------------------------------------------------------------------------

export interface UseAgentLeadsState {
  /** Lista de leads del agente. Vacía mientras carga o si hay error. */
  leads: AgentLead[];
  /** true mientras el fetch inicial está en curso. */
  loading: boolean;
  /** Mensaje de error si la query falló, null en caso de éxito. */
  error: string | null;
  /** Re-dispara el fetch (p.ej. tras un cambio de estado del lead). */
  refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook — STUB
// ---------------------------------------------------------------------------

/**
 * STUB: devuelve estado fijo vacío para hacer fallar los tests de RED por
 * aserción y no por import. La GREEN implementará la query real a Supabase.
 *
 * La implementación real:
 *   1. Llama useAuth() para verificar que hay sesión activa.
 *   2. Consulta supabase.from('leads').select(<embeds>).is('deleted_at', null)
 *      .order('updated_at', { ascending: false }).
 *   3. Mapea cada fila raw a AgentLead (extrae phone, full_name, profile_photo_url,
 *      origin_property_id, origin_property_address, origin_property_thumbnail_url).
 *   4. Expone refetch() vía tick (patrón useMyProperties).
 */
export function useAgentLeads(): UseAgentLeadsState {
  // ponytail: stub que retorna estado vacío — ningún test pasa en fase RED.
  return {
    leads: [],
    loading: false, // RED: EC-8 espera true en el primer render
    error: null, // RED: EC-10 espera error != null cuando query falla
    refetch: () => {},
  };
}
