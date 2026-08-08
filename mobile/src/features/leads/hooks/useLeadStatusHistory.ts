/**
 * useLeadStatusHistory — timeline de solo lectura del embudo de un lead.
 *
 * Contrato (§19.8, subtarea 75.6):
 *   Query: from('lead_status_history').select('*').eq('lead_id', leadId)
 *     .order('changed_at', { ascending: false })
 *   - RLS (lead_status_history_select, migración 20260807000003) ya filtra
 *     por private.can_view_lead(lead_id) — sin filtro adicional de agente aquí.
 *   - Lista vacía (lead sin cambios de estado registrados aún) NO es error.
 *   - Error de la query → mensaje neutro en español (mismo patrón que
 *     useAgentLeads / useUpdateLeadStatus — nunca el texto crudo de
 *     Postgres).
 *   - Patrón useState/useEffect + flag `ignore`, idéntico a useAgentLeads.
 */

import { useState, useEffect, useCallback } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { LeadStatusHistoryEntry } from '../types';

export interface UseLeadStatusHistoryState {
  /** Filas del timeline, más reciente primero. Vacío mientras carga o si hay error. */
  history: LeadStatusHistoryEntry[];
  /** true mientras el fetch inicial (o re-fetch) está en curso. */
  loading: boolean;
  /** Mensaje en español si la query falló, null en caso de éxito. */
  error: string | null;
  /** Re-dispara el fetch. */
  refetch: () => void;
}

export function useLeadStatusHistory(leadId: string): UseLeadStatusHistoryState {
  const [history, set_history] = useState<LeadStatusHistoryEntry[]>([]);
  const [loading, set_loading] = useState(true); // inicia en true — H-5
  const [error, set_error] = useState<string | null>(null);
  // ponytail: tick counter como señal de refetch — mismo patrón que useAgentLeads.
  const [tick, set_tick] = useState(0);

  useEffect(() => {
    let ignore = false;

    async function fetch_history(): Promise<void> {
      set_loading(true);

      const { data, error: query_error } = await supabase
        .from('lead_status_history')
        .select('*')
        .eq('lead_id', leadId)
        .order('changed_at', { ascending: false });

      if (ignore) return;

      if (query_error) {
        // Mensaje neutro en español — nunca el texto crudo de Postgres/PostgREST.
        set_error('No se pudo cargar el historial del lead. Intenta de nuevo.');
        set_history([]);
        set_loading(false);
        return;
      }

      set_history((data as unknown as LeadStatusHistoryEntry[] | null) ?? []);
      set_error(null);
      set_loading(false);
    }

    void fetch_history();

    return () => {
      ignore = true;
    };
  }, [leadId, tick]);

  const refetch = useCallback(() => set_tick((t) => t + 1), []);

  return { history, loading, error, refetch };
}
