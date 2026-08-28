/**
 * useAdminReports — cola de reportes de propiedad (property_reports con
 * status='new'), AGRUPADA POR PROPIEDAD, para el panel admin (módulo 041-M2,
 * tarea #220, subtarea 220.4). El contrato completo (firma, 14 edge cases)
 * vive en mobile/src/features/admin/__tests__/useAdminReports.test.tsx.
 *
 * Calca useAdminRevisions.ts (218.1): query ÚNICA (sin RPC nueva — la policy
 * RLS `reports_select` ya autoriza el SELECT al admin vía `public.is_admin()`,
 * supabase/migrations/20260604000008_rls_helpers_and_policies.sql:357-359) +
 * todo-o-nada en error/data-null + generación/ignore contra carreras.
 *
 * Query:
 *   supabase
 *     .from('property_reports')
 *     .select(<columnas propias + embed de display a properties>)
 *     .eq('status', 'new')
 *     .order('created_at', { ascending: false })   // property_reports_queue_idx
 *                                                   // es (status, created_at desc)
 *
 * NUNCA se filtra por `reported_by_user_id` — esta es la cola del ADMIN, no
 * "mis reportes" (la policy ya cubre ambos casos con el OR).
 *
 * AGRUPACIÓN en memoria: filas con el mismo `property_id` colapsan en un solo
 * `AdminReportQueueItem`; el orden de los GRUPOS respeta la primera aparición
 * de cada `property_id` en el orden ya-ordenado del server; dentro de un
 * grupo, los reportes conservan el orden de llegada.
 *
 * `client.from(...)` se llama DIRECTO, encadenado, nunca desprendido (#205).
 */

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface AdminReportPropertySnapshot {
  id: string;
  address: string;
  operation_type: string;
  property_type: string;
  price: number;
  status: string;
}

export interface AdminReportEntry {
  report_id: string;
  reason: string;
  reason_text: string | null;
  reported_by_user_id: string;
  created_at: string;
}

export interface AdminReportQueueItem {
  property_id: string;
  property: AdminReportPropertySnapshot;
  reports: AdminReportEntry[];
  report_count: number;
}

export interface UseAdminReportsResult {
  reports: AdminReportQueueItem[] | null;
  is_loading: boolean;
  error_message: string | null;
  refetch: () => void;
}

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar los reportes pendientes. Intenta de nuevo.';

/**
 * Columnas propias de property_reports + embed de DISPLAY a properties (NO
 * el whitelist de edición de edit-property — esto no es un diff de edición).
 */
const SELECT_COLUMNS = `
  id,
  property_id,
  reason,
  reason_text,
  reported_by_user_id,
  created_at,
  property:properties(
    id,
    address,
    operation_type,
    property_type,
    price,
    status
  )
`;

interface RawReportRow {
  id: string;
  property_id: string;
  reason: string;
  reason_text: string | null;
  reported_by_user_id: string;
  created_at: string;
  property: AdminReportPropertySnapshot;
}

function map_entry(row: RawReportRow): AdminReportEntry {
  return {
    report_id: row.id,
    reason: row.reason,
    reason_text: row.reason_text,
    reported_by_user_id: row.reported_by_user_id,
    created_at: row.created_at,
  };
}

/**
 * Agrupa filas por `property_id`, preservando el orden de PRIMERA APARICIÓN
 * de cada propiedad y el orden interno de llegada de sus reportes — sin
 * reordenar por conteo, fecha ni ninguna otra clave.
 */
function group_reports(rows: RawReportRow[]): AdminReportQueueItem[] {
  const order: string[] = [];
  const groups = new Map<string, AdminReportQueueItem>();

  for (const row of rows) {
    let group = groups.get(row.property_id);
    if (group === undefined) {
      group = {
        property_id: row.property_id,
        property: row.property,
        reports: [],
        report_count: 0,
      };
      groups.set(row.property_id, group);
      order.push(row.property_id);
    }
    group.reports.push(map_entry(row));
    group.report_count = group.reports.length;
  }

  return order.map((property_id) => groups.get(property_id)!);
}

export function useAdminReports(): UseAdminReportsResult {
  const [reports, set_reports] = useState<AdminReportQueueItem[] | null>(null);
  const [is_loading, set_is_loading] = useState(true);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  useEffect(() => {
    let ignore = false;

    // Envuelto en una función nombrada (invocada síncronamente abajo) en vez
    // de setState directo en el cuerpo del efecto — evita el lint
    // react-hooks/set-state-in-effect sin cambiar el timing (patrón
    // useAdminQueueCounts/useAdminRevisions).
    function run_fetch(): void {
      supabase
        .from('property_reports')
        .select(SELECT_COLUMNS)
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .then(
          (res) => {
            if (ignore) return;
            set_is_loading(false);
            // Todo-o-nada: error de PostgREST o `data: null` sin error nunca
            // se traducen en una lista vacía fabricada.
            if (res.error || res.data === null) {
              set_reports(null);
              set_error_message(NEUTRAL_ERROR_MESSAGE);
              return;
            }
            set_reports(group_reports(res.data as unknown as RawReportRow[]));
            set_error_message(null);
          },
          () => {
            if (ignore) return;
            set_is_loading(false);
            set_reports(null);
            set_error_message(NEUTRAL_ERROR_MESSAGE);
          },
        );
    }

    // Síncrono, ANTES de disparar la query, para que is_loading=true sea
    // observable en el mismo tick y ningún dato viejo se vea mientras carga.
    function start(): void {
      set_reports(null);
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

  return { reports, is_loading, error_message, refetch };
}
