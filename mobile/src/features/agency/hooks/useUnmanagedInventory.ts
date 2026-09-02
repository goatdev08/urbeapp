/**
 * useUnmanagedInventory — cuenta cuántas publicaciones activas de la agencia
 * quedaron "sin gestor" por cada miembro dado (subtarea #203.2, contrato §2).
 *
 * Un agente suspendido (o dado de baja) sigue siendo `owner_user_id` de sus
 * propiedades — la suspensión es DEL AGENTE, no de su inventario (regla 3 de
 * #202/#203). Esta pantalla (members.tsx) necesita saber, por cada miembro
 * suspendido/removido, cuántas publicaciones suyas siguen vivas bajo la
 * agencia para ofrecer "Reasignar publicaciones".
 *
 * Query — UNA sola, agrupada en cliente (contrato §2, evita N+1):
 *   from('properties').select('owner_user_id')
 *     .eq('agency_id', agencyId)
 *     .in('owner_user_id', user_ids)
 *     .is('deleted_at', null)
 *   → counts[owner_user_id] = número de filas con ese owner_user_id.
 *
 * Guardas: agencyId===null o user_ids.length===0 → no ejecuta la query,
 * counts={} (evita un `.in([])` inútil).
 *
 * 🔴 Dependencia por CONTENIDO, no por referencia: `user_ids` se serializa
 * (`.join('|')`) para el arreglo de dependencias del efecto — un caller que
 * pase un literal `[a, b]` inline en cada render (patrón común, incluidos
 * los propios tests de este hook) NO debe disparar un loop de refetch por
 * simple cambio de identidad del arreglo.
 *
 * Para forzar un refresh real tras una reasignación exitosa (el conjunto de
 * ids no cambia, pero el conteo por owner sí) se expone `refetch()` —
 * mismo patrón que useAdminRequestsQueues/useMyAdvertisingRequest
 * (refetch_tick), no una comparación de dependencias más "inteligente".
 *
 * Patrón: useState/useEffect + flag `ignore`, mismo esqueleto que
 * useAgencyAgents.ts.
 */
import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface UseUnmanagedInventoryState {
  /** owner_user_id → número de propiedades activas (no borradas) de la agencia. */
  counts: Record<string, number>;
  loading: boolean;
  error: string | null;
  /** Fuerza un refetch (p.ej. tras una reasignación exitosa). */
  refetch: () => void;
}

type RawPropertyOwnerRow = {
  owner_user_id: string;
};

function group_counts_by_owner(rows: RawPropertyOwnerRow[]): Record<string, number> {
  const grouped: Record<string, number> = {};
  for (const row of rows) {
    grouped[row.owner_user_id] = (grouped[row.owner_user_id] ?? 0) + 1;
  }
  return grouped;
}

export function useUnmanagedInventory(
  agencyId: string | null,
  user_ids: string[]
): UseUnmanagedInventoryState {
  const [counts, set_counts] = useState<Record<string, number>>({});
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  // Clave por CONTENIDO — evita que un arreglo recreado inline en cada
  // render (misma identidad de valores, distinta referencia) dispare un
  // refetch espurio. Los ids son UUIDs (sin '|'), sin colisión posible.
  const ids_key = user_ids.join('|');

  useEffect(() => {
    let ignore = false;

    if (agencyId == null || user_ids.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard "sin agencia/sin ids" del efecto de carga; resetea estado, no deriva UI.
      set_counts({});
      set_error(null);
      set_loading(false);
      return;
    }

    const resolved_agency_id: string = agencyId;
    const resolved_user_ids: string[] = user_ids;

    async function fetch_counts(): Promise<void> {
      set_loading(true);

      const { data, error: query_error } = await supabase
        .from('properties')
        .select('owner_user_id')
        .eq('agency_id', resolved_agency_id)
        .in('owner_user_id', resolved_user_ids)
        .is('deleted_at', null);

      if (ignore) return;

      if (query_error) {
        set_error(query_error.message);
        set_counts({});
        set_loading(false);
        return;
      }

      const rows = (data as unknown as RawPropertyOwnerRow[] | null) ?? [];
      set_counts(group_counts_by_owner(rows));
      set_error(null);
      set_loading(false);
    }

    void fetch_counts();

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ids_key representa a user_ids (por contenido); refetch_tick es el disparador manual.
  }, [agencyId, ids_key, refetch_tick]);

  const refetch = useCallback(() => set_refetch_tick((n) => n + 1), []);

  return { counts, loading, error, refetch };
}
