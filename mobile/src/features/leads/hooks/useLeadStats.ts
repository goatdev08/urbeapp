/**
 * useLeadStats — estadísticas tangibles de actividad por lead (112.3/112.4).
 *
 * Llama supabase.rpc('get_lead_stats', { p_lead_ids: leadIds }) UNA SOLA VEZ
 * por cada cambio de `leadIds`, con TODOS los ids visibles en un solo batch —
 * nunca una llamada por tarjeta (evita N+1). El caller (CRMScreen) debe pasar
 * un array MEMOIZADO (useMemo sobre `leads`) — una referencia nueva en cada
 * render dispararía un refetch en cada render, mismo cuidado que cualquier
 * dependencia de useEffect basada en un array.
 *
 * El RPC (migración 20260808000002) solo devuelve fila para los leads cuyo
 * usuario ya dio like a la propiedad de ORIGEN de ese lead — un lead ausente
 * del resultado significa "sin señales todavía" (nunca dio like), NO un
 * error: se refleja como key AUSENTE en `statsByLeadId` (nunca como fila con
 * ceros/false). La UI (ActionStatsBar) trata esa ausencia como estado
 * explícito, no como fallo.
 *
 * leadIds vacío → no dispara la RPC (nada que consultar): statsByLeadId={},
 * loading=false de inmediato.
 *
 * Error de red/RPC (72.6, mismo criterio que useAgentLeads/useLeadStatusHistory):
 * mensaje NEUTRO en español, nunca el texto crudo de PostgREST/Postgres.
 * Degrada en silencio a "sin señales" por lead — las estadísticas son
 * información complementaria, su fallo no debe bloquear el CRM (contactar,
 * cambiar estado y notas siguen funcionando).
 *
 * La llamada va tipada contra el Database generado: `get_lead_stats` entró a
 * supabase/types/database.types.ts en el regen del 2026-08-08 (#112), así que
 * NO hace falta el escape hatch `client: any` de mapProperties.ts/
 * feedProperties.ts. El cast del resultado se queda solo para nombrar las
 * columnas de la fila en un tipo local legible.
 */

import { useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { LeadStats } from '../types';

export interface UseLeadStatsState {
  /** Estadísticas por lead_id. Un id ausente del mapa = sin like todavía (no error). */
  statsByLeadId: Record<string, LeadStats>;
  /** true mientras el fetch está en curso. false de inmediato si leadIds está vacío. */
  loading: boolean;
  /** Mensaje en español si la RPC falló, null en caso de éxito. */
  error: string | null;
}

type LeadStatsRpcRow = {
  lead_id: string;
  vio_completo: boolean;
  veces_visto: number;
  guardo: boolean;
  ultima_actividad: string;
};

export function useLeadStats(leadIds: string[]): UseLeadStatsState {
  const [stats, set_stats] = useState<Record<string, LeadStats>>({});
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  // Dependencia por CONTENIDO, no por referencia — un array literal (incluso
  // memoizado con cuidado por el caller) puede llegar con una referencia
  // nueva sin que los ids realmente hayan cambiado; con `[leadIds]` directo
  // eso re-dispara el efecto, que hace setState, que re-renderiza, que crea
  // OTRO array `[]`/`[...]` en el próximo render → loop infinito (visto en
  // los tests: "Maximum update depth exceeded" con leadIds=[] inline). Unir
  // en un string colapsa cualquier array con el mismo contenido a la MISMA
  // dependencia, sin importar la referencia.
  const lead_ids_key = leadIds.join(',');

  useEffect(() => {
    let ignore = false;

    async function fetch_stats(): Promise<void> {
      // Nada que consultar — evita una RPC vacía (lista de leads aún vacía/cargando).
      if (leadIds.length === 0) {
        set_stats({});
        set_error(null);
        set_loading(false);
        return;
      }

      set_loading(true);

      const rpc_result = (await supabase.rpc('get_lead_stats', {
        p_lead_ids: leadIds,
      })) as { data: LeadStatsRpcRow[] | null; error: { message: string } | null };

      if (ignore) return;

      if (rpc_result.error) {
        set_error('No se pudieron cargar las estadísticas de actividad. Intenta de nuevo.');
        set_stats({});
        set_loading(false);
        return;
      }

      const by_lead_id: Record<string, LeadStats> = {};
      for (const row of rpc_result.data ?? []) {
        by_lead_id[row.lead_id] = {
          vio_completo: row.vio_completo,
          veces_visto: row.veces_visto,
          guardo: row.guardo,
          ultima_actividad: row.ultima_actividad,
        };
      }

      set_stats(by_lead_id);
      set_error(null);
      set_loading(false);
    }

    void fetch_stats();

    return () => {
      ignore = true;
    };
    // leadIds se usa dentro (closure) pero la dependencia real es su
    // CONTENIDO (lead_ids_key) — ver comentario arriba de la declaración.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead_ids_key]);

  return { statsByLeadId: stats, loading, error };
}
