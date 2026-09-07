/**
 * useCrmLeadsPage — página del pipeline del CRM (subtarea 266.7, GREEN).
 * Contrato completo (SEAMS, params exactos, decisiones D-XXX, edge cases) en
 * mobile/src/features/leads/__tests__/useCrmLeadsPage.test.ts — no se repite
 * aquí. RPC `crm_leads_page` (migración 20260906100003).
 *
 * Molde: paginación acumulativa con cursor de useFeedProperties.ts (data +
 * loadInitial/loadMore/refetch) + refetch por foco de useAgentProfile.ts
 * (useFocusEffect + useCallback — el primer foco coincide con el mount).
 *
 * `next_cursor`/`remaining` llegan REPETIDOS en cada fila de una misma
 * página (mismo valor); se leen UNA sola vez de la ÚLTIMA fila devuelta y no
 * se exponen por fila (CrmLeadRow no los declara).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { supabase } from '@/lib/supabase/client';
import type { CrmBand, CrmLeadRow, CrmLeadsPageCursor, ProjectedStatus } from '../types';

export interface UseCrmLeadsPageState {
  data: CrmLeadRow[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  remaining: number | null;
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;
  refetch: () => Promise<void>;
}

const ERROR_MESSAGE = 'No se pudo cargar el pipeline de leads. Intenta de nuevo.';

/** Fila cruda de public.crm_leads_page — next_cursor/remaining son metadata de PÁGINA. */
type RpcRow = CrmLeadRow & {
  next_cursor: CrmLeadsPageCursor | null;
  remaining: number | null;
};

function map_row(row: RpcRow): CrmLeadRow {
  return {
    lead_id: row.lead_id,
    user_id: row.user_id,
    full_name: row.full_name,
    avatar_url: row.avatar_url,
    temperature: row.temperature,
    delta: row.delta,
    band: row.band,
    signals: row.signals,
    sparkline: row.sparkline,
    last_activity_at: row.last_activity_at,
    origin_property: row.origin_property,
    status_projected: row.status_projected,
  };
}

export function useCrmLeadsPage(
  agentId: string | null | undefined,
  band: CrmBand | null,
  query: string | null,
  // D-STATUSNULL/D-STATUSEMPTY (contrato en __tests__/useCrmLeadsPage.test.ts,
  // EC-22..EC-29): `undefined` (arg omitido, llamador viejo) => la clave
  // p_status/p_follow_up se OMITE del objeto de args; `null` explícito => la
  // clave viaja con valor null; `[]` explícito => se manda tal cual, sin
  // normalizar a null.
  status?: ProjectedStatus[] | null,
  followUp?: boolean | null,
): UseCrmLeadsPageState {
  // Clave por CONTENIDO (molde useUnmanagedInventory.ts) — status es un
  // ARRAY; si entrara por referencia en las deps de fetch_page, un array
  // recreado inline en el padre en cada render dispararía refetch en bucle
  // (memoria hook_array_prop_reference_loop, heap OOM en Jest — EC-28).
  const status_key = status == null ? String(status) : status.join('|');
  const [data, set_data] = useState<CrmLeadRow[]>([]);
  const [loading, set_loading] = useState(Boolean(agentId));
  const [error, set_error] = useState<string | null>(null);
  const [hasMore, set_has_more] = useState(false);
  const [remaining, set_remaining] = useState<number | null>(null);

  // Cancelación en unmount: flag simple (molde useAgentProfile), evita
  // aplicar estado tras desmontar (warning "act" de React).
  const mounted_ref = useRef(true);
  // D-SEQ (guardian 267.6/269.5, molde useCrmLeadDetail.ts): token de
  // petición — una respuesta tardía de un agentId/band/query ANTERIOR (o de
  // un loadMore superado por un refetch/refoco) no pisa la lista vigente.
  const seq_ref = useRef(0);
  useEffect(() => {
    mounted_ref.current = true;
    return () => {
      mounted_ref.current = false;
    };
  }, []);

  // Cursor de la página siguiente — leído de la última fila de la respuesta
  // anterior; loadMore lo consume, loadInitial/refetch/cambio de banda-query
  // arrancan siempre desde null (D-APPEND).
  const next_cursor_ref = useRef<CrmLeadsPageCursor | null>(null);

  const fetch_page = useCallback(
    async (cursor: CrmLeadsPageCursor | null, append: boolean): Promise<void> => {
      if (!agentId) {
        // D-SEQ: bump ANTES de los resets — invalida cualquier petición en
        // vuelo del agentId anterior (EC-21), no solo el mecanismo de
        // cancelación por unmount.
        ++seq_ref.current;
        set_data([]);
        set_loading(false);
        set_error(null);
        set_has_more(false);
        set_remaining(null);
        next_cursor_ref.current = null;
        return;
      }

      set_loading(true);
      const seq = ++seq_ref.current;

      // ponytail: `as any` en los args — el Args generado tipa p_band/p_query
      // como `string` opcional SIN null, aunque el SQL los declara
      // `default null` y los acepta explícitos (mismo gotcha de tipos
      // generados que useAdMetrics.ts). p_cursor es Json — sí admite null
      // sin cast.
      // D-STATUSNULL: `undefined` omite la clave (retrocompat con llamadores
      // sin hoja de filtros); `null`/`[]` explícitos SÍ viajan.
      const args: Record<string, unknown> = {
        p_agent_id: agentId,
        p_band: band,
        p_cursor: cursor,
        p_limit: 20,
        p_query: query,
      };
      if (status !== undefined) args.p_status = status;
      if (followUp !== undefined) args.p_follow_up = followUp;

      let rpc_result: { data: RpcRow[] | null; error: { message: string } | null };
      try {
        rpc_result = (await supabase.rpc('crm_leads_page', args as any)) as typeof rpc_result;
      } catch {
        // Rechazo real de red (offline): sin esto la promesa queda sin
        // manejar y `loading` no vuelve a bajar (bug confirmado por el
        // guardian en 269.5).
        rpc_result = { data: null, error: { message: 'network' } };
      }

      // Corta ANTES de tocar next_cursor_ref y ANTES de set_data: una
      // respuesta obsoleta (búsqueda/banda vieja, loadMore superado por un
      // refetch/refoco) no debe pisar el cursor de paginación ni
      // concatenarse/reemplazar el array vigente (EC-15/EC-18/EC-19).
      if (!mounted_ref.current || seq !== seq_ref.current) return;

      if (rpc_result.error) {
        set_error(ERROR_MESSAGE);
        set_data([]);
        set_loading(false);
        set_has_more(false);
        set_remaining(null);
        return;
      }

      const rows = rpc_result.data ?? [];
      const last = rows[rows.length - 1];
      next_cursor_ref.current = last?.next_cursor ?? null;

      const mapped = rows.map(map_row);
      set_data((prev) => (append ? [...prev, ...mapped] : mapped));
      set_has_more(Boolean(last?.next_cursor));
      set_remaining(last ? last.remaining : null);
      set_error(null);
      set_loading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- status_key representa a status (por contenido); status/followUp entran en el body por closure, no en las deps (evita refetch por referencia, EC-28).
    [agentId, band, query, status_key, followUp],
  );

  // D-FOCUS: el primer foco coincide con el mount; un refoco real (o un
  // cambio real de agentId/band/query, que recrea fetch_page) redispara la
  // carga desde cursor null.
  useFocusEffect(
    useCallback(() => {
      void fetch_page(null, false);
    }, [fetch_page]),
  );

  const load_initial = useCallback(() => fetch_page(null, false), [fetch_page]);
  const load_more = useCallback(() => fetch_page(next_cursor_ref.current, true), [fetch_page]);

  return {
    data,
    loading,
    error,
    hasMore,
    remaining,
    loadInitial: load_initial,
    loadMore: load_more,
    refetch: load_initial,
  };
}
