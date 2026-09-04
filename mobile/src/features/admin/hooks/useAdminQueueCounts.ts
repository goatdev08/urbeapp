/**
 * useAdminQueueCounts — counts vivos por cola para el home del panel admin
 * (tarea #217, subtarea 217.2; 6ª cola advertising_requests por #246). Fase GREEN. El contrato completo (firma, 10
 * edge cases) vive en
 * mobile/src/features/admin/__tests__/useAdminQueueCounts.test.tsx — es el
 * archivo que fija el comportamiento; este archivo lo implementa sin
 * renegociarlo.
 *
 * 6 queries EN PARALELO (sin RPC nueva — las policies RLS con
 * `private.is_admin()` ya autorizan el SELECT al admin), cada una
 * `supabase.from(<tabla>).select('*', { count: 'exact', head: true }).eq('status', <valor>)`:
 *   - ads                .eq('status', 'pending_review')
 *   - property_revisions .eq('status', 'pending')
 *   - property_reports   .eq('status', 'new')
 *   - agent_applications .eq('status', 'pending')
 *   - agencies           .eq('status', 'pending_approval')
 *   - advertising_requests .eq('status', 'pending')
 *
 * #246: la 6ª cola (canal «Quiero anunciar», #221.1) entra al MISMO
 * todo-o-nada, no como un contador aparte. 221.4 la había dejado fuera porque
 * su tabla podía no estar desplegada en aquel worktree y una query contra una
 * tabla inexistente habría tumbado las otras 5 — hoy advertising_requests ya
 * está en producción (20260902100001), así que esa razón se acabó.
 *
 * Todo-o-nada (patrón useAdStats/#200): la PRIMERA de las 6 en fallar (error,
 * `count: null` sin error, o rechazo de la promesa) invalida las 6 —
 * `counts=null` + un único mensaje neutro — nunca un objeto con 5 números
 * reales y una mentira. `is_loading` no baja hasta que las 6 se asienten,
 * aunque solo falte una.
 *
 * `client.from(...)` se llama DIRECTO, encadenado, nunca desprendido (#205,
 * memoria supabase_js_metodo_desprendido).
 */

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface AdminQueueCounts {
  ads_pending: number;
  revisions_pending: number;
  reports_new: number;
  agent_applications_pending: number;
  agencies_pending: number;
  advertising_requests_pending: number;
}

export interface UseAdminQueueCountsResult {
  counts: AdminQueueCounts | null;
  is_loading: boolean;
  error_message: string | null;
  refetch: () => void;
}

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar los contadores del panel. Intenta de nuevo.';

const TOTAL_QUEUES = 6;

export function useAdminQueueCounts(): UseAdminQueueCountsResult {
  const [counts, set_counts] = useState<AdminQueueCounts | null>(null);
  const [is_loading, set_is_loading] = useState(true);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  useEffect(() => {
    let ignore = false;

    // Envuelto en una función nombrada (invocada síncronamente abajo) en vez
    // de setState directo en el cuerpo del efecto — evita el lint
    // react-hooks/set-state-in-effect sin cambiar el timing (patrón useAdStats).
    function run_fetch(): void {
      let errored = false;
      let settled_count = 0;
      const partial: Partial<AdminQueueCounts> = {};

      function mark_settled(): void {
        settled_count += 1;
        if (ignore) return;
        if (settled_count >= TOTAL_QUEUES) {
          set_is_loading(false);
          // Todo-o-nada: solo se publica `counts` si las 5 asentaron sin error.
          if (!errored) set_counts(partial as AdminQueueCounts);
        }
      }

      function handle_error(): void {
        if (ignore) return;
        if (!errored) {
          errored = true;
          set_counts(null);
          set_error_message(NEUTRAL_ERROR_MESSAGE);
        }
        mark_settled();
      }

      function handle_result(
        key: keyof AdminQueueCounts,
        count: number | null,
        err: { message: string } | null
      ): void {
        if (ignore) return;
        // `count: null` sin `error` es una respuesta rara de PostgREST — se
        // trata como error, nunca como 0 fabricado (EC-8).
        if (err || count === null) {
          handle_error();
          return;
        }
        if (!errored) partial[key] = count;
        mark_settled();
      }

      supabase
        .from('ads')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_review')
        .then((res) => handle_result('ads_pending', res.count, res.error), handle_error);

      supabase
        .from('property_revisions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then((res) => handle_result('revisions_pending', res.count, res.error), handle_error);

      supabase
        .from('property_reports')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new')
        .then((res) => handle_result('reports_new', res.count, res.error), handle_error);

      supabase
        .from('agent_applications')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(
          (res) => handle_result('agent_applications_pending', res.count, res.error),
          handle_error
        );

      supabase
        .from('agencies')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending_approval')
        .then((res) => handle_result('agencies_pending', res.count, res.error), handle_error);

      // ponytail: cast local — advertising_requests todavía no está en
      // supabase/types/database.types.ts (los tipos generados se quedaron
      // atrás de 20260902100001). Mismo patrón, mismo motivo y misma salida
      // que useAdminRequestsQueues.ts:177: se retira cuando los tipos se
      // regeneren. Techo conocido: `count` y `error` de la respuesta quedan
      // sin tipar en esta rama — por eso handle_result sigue validando ambos
      // en tiempo de ejecución (EC-8/EC-12), no por el tipo.
      (supabase as any)
        .from('advertising_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(
          (res: { count: number | null; error: { message: string } | null }) =>
            handle_result('advertising_requests_pending', res.count, res.error),
          handle_error
        );
    }

    // Síncrono, ANTES de disparar ninguna query, para que is_loading=true sea
    // observable en el mismo tick y ningún dato viejo se vea mientras carga
    // (mismo patrón que useAdStats/start).
    function start(): void {
      set_counts(null);
      set_error_message(null);
      set_is_loading(true);
      run_fetch();
    }

    start();

    return () => {
      ignore = true;
    };
  }, [refetch_tick]);

  const refetch = useCallback(() => {
    set_refetch_tick((n) => n + 1);
  }, []);

  return { counts, is_loading, error_message, refetch };
}
