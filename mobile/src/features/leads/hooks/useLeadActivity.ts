/**
 * useLeadActivity — timeline de actividad de un lead (subtarea 266.7, GREEN).
 * Contrato completo (SEAMS, params exactos, decisiones D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useLeadActivity.test.ts — no se repite
 * aquí. RPC `lead_activity` (migración 20260906100004).
 *
 * A diferencia de useCrmLeadsPage, esta RPC NO expone next_cursor/remaining:
 * el cursor de la página siguiente es el `occurred_at` de la ÚLTIMA fila
 * devuelta (client-side), y hasMore=false SOLO cuando una página resuelve
 * con 0 filas (lead_activity no da un total). Sin refetch por foco (PLAN
 * 266.7: solo useCrmLeadsPage/useCrmFunnel se suscriben a foco).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { LeadActivityEntry } from '../types';

export interface UseLeadActivityState {
  data: LeadActivityEntry[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar la actividad del lead. Intenta de nuevo.';

export function useLeadActivity(leadId: string | null | undefined): UseLeadActivityState {
  const [data, set_data] = useState<LeadActivityEntry[]>([]);
  const [loading, set_loading] = useState(Boolean(leadId));
  const [error, set_error] = useState<string | null>(null);
  const [hasMore, set_has_more] = useState(false);

  const mounted_ref = useRef(true);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  // Cursor de la siguiente página: occurred_at de la última fila devuelta
  // (la RPC no expone un campo de cursor propio).
  const next_cursor_ref = useRef<string | null>(null);

  const fetch_page = useCallback(
    async (cursor: string | null, append: boolean): Promise<void> => {
      if (!leadId) {
        set_data([]);
        set_loading(false);
        set_error(null);
        set_has_more(false);
        next_cursor_ref.current = null;
        return;
      }

      set_loading(true);

      // ponytail: `as any` — Args generado tipa p_cursor como `string`
      // opcional SIN null, aunque el SQL lo declara `default null` (mismo
      // gotcha que useCrmLeadsPage.ts).
      const rpc_result = (await supabase.rpc('lead_activity', {
        p_lead_id: leadId,
        p_limit: 20,
        p_cursor: cursor,
      } as any)) as { data: LeadActivityEntry[] | null; error: { message: string } | null };

      if (!mounted_ref.current) return;

      if (rpc_result.error) {
        set_error(ERROR_MESSAGE);
        set_data([]);
        set_loading(false);
        set_has_more(false);
        return;
      }

      // D-NOTRUNC: la RPC puede devolver MÁS filas que p_limit (expansión de
      // empate de frontera) — se conservan TODAS, nunca se recorta.
      const rows = rpc_result.data ?? [];
      next_cursor_ref.current = rows.length > 0 ? rows[rows.length - 1]!.occurred_at : null;

      set_data((prev) => (append ? [...prev, ...rows] : rows));
      set_has_more(rows.length > 0);
      set_error(null);
      set_loading(false);
    },
    [leadId],
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch_page hace setState tras el await de la RPC (o sincrónico solo en el guard sin leadId); molde useMyProperties.ts.
    void fetch_page(null, false);
  }, [fetch_page]);

  const load_initial = useCallback(() => fetch_page(null, false), [fetch_page]);
  const load_more = useCallback(() => fetch_page(next_cursor_ref.current, true), [fetch_page]);

  return {
    data,
    loading,
    error,
    hasMore,
    loadInitial: load_initial,
    loadMore: load_more,
    refetch: load_initial,
  };
}
