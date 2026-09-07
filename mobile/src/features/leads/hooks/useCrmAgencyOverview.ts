/**
 * useCrmAgencyOverview — vista de agencia del CRM (subtarea 269.5). Contrato
 * completo (SEAMS, decisiones D-XXX, edge cases) en
 * __tests__/useCrmAgencyOverview.test.tsx — no se repite aquí. RPC
 * `crm_agency_overview` (migración 20260906400001).
 *
 * Molde: useCrmFunnel.ts (refetch por foco: useFocusEffect + useCallback,
 * client.rpc con this intacto — gotcha supabase_js_metodo_desprendido).
 * AgencyAgentRow/UnmanagedLeadRow viven en types.ts (convención de tipos de
 * dominio del CRM) y se re-exportan aquí para el import del test.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import { LEAD_EF_NETWORK_FALLBACK } from '../lead_error_messages';
import type { AgencyAgentRow, UnmanagedLeadRow } from '../types';

export type { AgencyAgentRow, UnmanagedLeadRow };

export interface UseCrmAgencyOverviewState {
  agents: AgencyAgentRow[];
  unmanaged: UnmanagedLeadRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar la vista de agencia del CRM. Intenta de nuevo.';

// Shape crudo de la RPC (kind discrimina agent/unmanaged; campos del "otro"
// kind llegan NULL). Casteado localmente igual que useCrmFunnel — los tipos
// generados no reflejan la nulabilidad cruzada real de la fila.
interface RawOverviewRow {
  kind: string;
  agent_id: string | null;
  agent_name: string | null;
  lead_id: string | null;
  untouched_count: number | null;
  response_hours: number | null;
  avg_temperature: number | null;
  flag: string | null;
  temperature: number | null;
  first_contact_at: string | null;
  lead_display_name: string | null;
}

export function useCrmAgencyOverview(agency_id: string | null): UseCrmAgencyOverviewState {
  const [agents, set_agents] = useState<AgencyAgentRow[]>([]);
  const [unmanaged, set_unmanaged] = useState<UnmanagedLeadRow[]>([]);
  const [loading, set_loading] = useState(Boolean(agency_id));
  const [error, set_error] = useState<string | null>(null);

  const mounted_ref = useRef(true);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  const fetch_overview = useCallback(async (): Promise<void> => {
    if (!agency_id) {
      set_agents([]);
      set_unmanaged([]);
      set_loading(false);
      set_error(null);
      return;
    }

    set_loading(true);

    // D-NETWORK (EC-15, hallazgo del guardian): un rechazo de la promesa
    // (network/timeout) es distinto de {data:null,error} — sin este
    // try/catch dejaba loading colgado en true para siempre. Mismo mensaje
    // que useReassignLead para el mismo escenario.
    try {
      const rpc_result = (await supabase.rpc('crm_agency_overview', {
        p_agency_id: agency_id,
      })) as { data: RawOverviewRow[] | null; error: { message: string } | null };

      if (!mounted_ref.current) return;

      if (rpc_result.error) {
        set_error(ERROR_MESSAGE);
        set_agents([]);
        set_unmanaged([]);
        return;
      }

      // D-ORDER: la RPC ya llega ordenada (kind asc, agent_name asc /
      // temperature desc) — no se reordena en cliente.
      const next_agents: AgencyAgentRow[] = [];
      const next_unmanaged: UnmanagedLeadRow[] = [];
      for (const row of rpc_result.data ?? []) {
        if (row.kind === 'agent') {
          next_agents.push({
            agent_id: row.agent_id!,
            agent_name: row.agent_name,
            untouched_count: row.untouched_count ?? 0,
            response_hours: row.response_hours,
            avg_temperature: row.avg_temperature,
            flag: row.flag as AgencyAgentRow['flag'],
          });
        } else {
          next_unmanaged.push({
            lead_id: row.lead_id!,
            lead_display_name: row.lead_display_name,
            temperature: row.temperature ?? 0,
            first_contact_at: row.first_contact_at,
          });
        }
      }

      set_agents(next_agents);
      set_unmanaged(next_unmanaged);
      set_error(null);
    } catch {
      if (!mounted_ref.current) return;
      set_error(LEAD_EF_NETWORK_FALLBACK);
      set_agents([]);
      set_unmanaged([]);
    } finally {
      if (mounted_ref.current) set_loading(false);
    }
  }, [agency_id]);

  // D-FOCUS: el primer foco coincide con el mount; un refoco real o un
  // cambio de agency_id (recrea fetch_overview) redispara la RPC.
  useFocusEffect(
    useCallback(() => {
      void fetch_overview();
    }, [fetch_overview]),
  );

  const refetch = useCallback(() => fetch_overview(), [fetch_overview]);

  return { agents, unmanaged, loading, error, refetch };
}
