/**
 * useCrmRadarAnon — radar anónimo de interesados (subtarea 266.7, GREEN).
 * Contrato completo (SEAMS, params exactos, decisiones D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmRadarAnon.test.ts — no se repite
 * aquí. RPC `crm_radar_anon` (migración 20260906100005).
 *
 * Molde useLeadStats.ts: una sola llamada supabase.rpc, error neutro en
 * español, deps por contenido. Sin refetch por foco (PLAN 266.7).
 *
 * 🔒 D-SIN-IDENTIDAD (75.3/§7.5): el mapeo construye cada fila explícita con
 * EXACTAMENTE las 7 claves de CrmRadarRow — nunca un spread — para que una
 * columna de identidad que la RPC llegara a agregar por error jamás se cuele
 * al cliente.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { CrmRadarRow } from '../types';

export interface UseCrmRadarAnonState {
  data: CrmRadarRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar el radar de interesados. Intenta de nuevo.';
const DEFAULT_LIMIT = 20;

export function useCrmRadarAnon(
  agentId: string | null | undefined,
  limit?: number | null,
): UseCrmRadarAnonState {
  const [data, set_data] = useState<CrmRadarRow[]>([]);
  const [loading, set_loading] = useState(Boolean(agentId));
  const [error, set_error] = useState<string | null>(null);

  const mounted_ref = useRef(true);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  // D-LIMIT-EXPLICIT: p_limit SIEMPRE explícito — ausente/null usa el
  // default 20 ANTES de llamar la RPC (precedente 266.5).
  const resolved_limit = limit ?? DEFAULT_LIMIT;

  const fetch_radar = useCallback(async (): Promise<void> => {
    if (!agentId) {
      set_data([]);
      set_loading(false);
      set_error(null);
      return;
    }

    set_loading(true);

    const rpc_result = (await supabase.rpc('crm_radar_anon', {
      p_agent_id: agentId,
      p_limit: resolved_limit,
    })) as { data: CrmRadarRow[] | null; error: { message: string } | null };

    if (!mounted_ref.current) return;

    if (rpc_result.error) {
      set_error(ERROR_MESSAGE);
      set_data([]);
      set_loading(false);
      return;
    }

    const mapped: CrmRadarRow[] = (rpc_result.data ?? []).map((row) => ({
      row_n: row.row_n,
      property_label: row.property_label,
      temperature: row.temperature,
      delta: row.delta,
      sparkline: row.sparkline,
      signals: row.signals,
      last_activity_at: row.last_activity_at,
    }));

    set_data(mapped);
    set_error(null);
    set_loading(false);
  }, [agentId, resolved_limit]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch_radar hace setState tras el await de la RPC (o sincrónico solo en el guard sin agentId); molde useMyProperties.ts.
    void fetch_radar();
  }, [fetch_radar]);

  const refetch = useCallback(() => fetch_radar(), [fetch_radar]);

  return { data, loading, error, refetch };
}
