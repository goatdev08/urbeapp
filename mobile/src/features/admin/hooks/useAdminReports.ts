/**
 * useAdminReports — cola MEZCLADA de reportes (property_reports +
 * comment_reports, ambos con status='new'), AGRUPADA por su entidad
 * reportada, para el panel admin. Property: módulo 041-M2, tarea #220,
 * subtarea 220.4 — 14 edge cases en useAdminReports.test.tsx (NO tocado).
 * Comment: tarea #289, subtarea 289.6 — 15 edge cases en
 * useAdminReports.comments.test.tsx (extensión, archivo nuevo).
 *
 * Calca useAdminRevisions.ts (218.1) para la rama property: query ÚNICA
 * (sin RPC nueva — la policy RLS `reports_select` ya autoriza el SELECT al
 * admin vía `public.is_admin()`,
 * supabase/migrations/20260604000008_rls_helpers_and_policies.sql:357-359) +
 * todo-o-nada en error/data-null (SOLO dentro de esa fuente) + generación/
 * ignore contra carreras.
 *
 * 289.6 añade DOS queries más, en paralelo con la de property_reports:
 *   1) comment_reports (.eq('status','new') + embed anidado
 *      comments→properties) — SIEMPRE se dispara.
 *   2) agent_public_profiles (.in('user_id', [...])) — batcheada con los
 *      user_id DISTINTOS de los comentarios traídos; se SALTA si no hubo
 *      ningún comentario (evita `.in('user_id', [])`).
 *
 * FAIL-SOFT CRUZADO (lección 269.5, distinto del todo-o-nada de UNA sola
 * query): un error en cualquiera de las DOS fuentes top-level
 * (property_reports / comment_reports) setea `error_message`, pero la OTRA
 * fuente sigue aportando sus items — nunca se descarta el array completo
 * por el fallo de una sola fuente. Si ambas fallan, `reports` es `[]`
 * (nunca `null` — ese "null total" solo existía en el diseño de UNA fuente).
 *
 * MERGE: los items 'property' y 'comment' se intercalan por su fecha
 * representativa (`reports[0].created_at` para property, `created_at`
 * propio para comment) en un solo array `reports`, orden DESC.
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

export interface AdminPropertyReportQueueItem {
  kind: 'property';
  property_id: string;
  property: AdminReportPropertySnapshot;
  reports: AdminReportEntry[];
  report_count: number;
}

/** Alias retrocompatible (220.4) — el nombre histórico sigue señalando la forma 'property'. */
export type AdminReportQueueItem = AdminPropertyReportQueueItem;

export interface AdminCommentReportQueueItem {
  kind: 'comment';
  id: string;
  comment_id: string;
  body: string;
  status: string;
  author_display_name: string;
  property_id: string;
  property_title: string;
  reason: string;
  reason_text: string | null;
  created_at: string;
  report_count: number;
}

export type AdminReportsQueueEntry = AdminPropertyReportQueueItem | AdminCommentReportQueueItem;

export interface UseAdminReportsResult {
  reports: AdminReportsQueueEntry[] | null;
  is_loading: boolean;
  error_message: string | null;
  refetch: () => void;
}

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar los reportes pendientes. Intenta de nuevo.';

const FALLBACK_AUTHOR_NAME = 'Agente Urbea';

/**
 * Columnas propias de property_reports + embed de DISPLAY a properties (NO
 * el whitelist de edición de edit-property — esto no es un diff de edición).
 */
const PROPERTY_SELECT_COLUMNS = `
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

/** Columnas propias de comment_reports + embed anidado comments→properties. */
const COMMENT_SELECT_COLUMNS = `
  id,
  comment_id,
  reason,
  reason_text,
  created_at,
  comment:comments(
    id,
    body,
    status,
    user_id,
    property_id,
    property:properties(
      id,
      address
    )
  )
`;

interface RawPropertyReportRow {
  id: string;
  property_id: string;
  reason: string;
  reason_text: string | null;
  reported_by_user_id: string;
  created_at: string;
  property: AdminReportPropertySnapshot;
}

interface RawCommentReportRow {
  id: string;
  comment_id: string;
  reason: string;
  reason_text: string | null;
  created_at: string;
  comment: {
    id: string;
    body: string;
    status: string;
    user_id: string;
    property_id: string;
    property: { id: string; address: string };
  };
}

function map_property_entry(row: RawPropertyReportRow): AdminReportEntry {
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
function group_property_reports(rows: RawPropertyReportRow[]): AdminPropertyReportQueueItem[] {
  const order: string[] = [];
  const groups = new Map<string, AdminPropertyReportQueueItem>();

  for (const row of rows) {
    let group = groups.get(row.property_id);
    if (group === undefined) {
      group = {
        kind: 'property',
        property_id: row.property_id,
        property: row.property,
        reports: [],
        report_count: 0,
      };
      groups.set(row.property_id, group);
      order.push(row.property_id);
    }
    group.reports.push(map_property_entry(row));
    group.report_count = group.reports.length;
  }

  return order.map((property_id) => groups.get(property_id)!);
}

/** Acumulador intermedio de un grupo de comment_reports, antes de resolver identidad. */
interface CommentGroupAccumulator {
  id: string;
  comment_id: string;
  body: string;
  status: string;
  user_id: string;
  property_id: string;
  property_title: string;
  reason: string;
  reason_text: string | null;
  created_at: string;
  report_count: number;
}

/**
 * Agrupa filas por `comment_id` — idéntico criterio que property: orden de
 * PRIMERA APARICIÓN (server ya viene ordenado created_at desc, así que la
 * primera fila de un grupo es su reporte MÁS RECIENTE) fija id/reason/
 * reason_text/created_at del grupo; nunca se sobreescriben con duplicados.
 */
function group_comment_reports(rows: RawCommentReportRow[]): CommentGroupAccumulator[] {
  const order: string[] = [];
  const groups = new Map<string, CommentGroupAccumulator>();

  for (const row of rows) {
    let group = groups.get(row.comment_id);
    if (group === undefined) {
      group = {
        id: row.id,
        comment_id: row.comment_id,
        body: row.comment.body,
        status: row.comment.status,
        user_id: row.comment.user_id,
        property_id: row.comment.property_id,
        property_title: row.comment.property.address,
        reason: row.reason,
        reason_text: row.reason_text,
        created_at: row.created_at,
        report_count: 0,
      };
      groups.set(row.comment_id, group);
      order.push(row.comment_id);
    }
    group.report_count += 1;
  }

  return order.map((comment_id) => groups.get(comment_id)!);
}

/** Resultado de una fuente: sus items ya listos + si esa fuente falló. */
interface SourceResult<T> {
  items: T[];
  failed: boolean;
}

async function fetch_property_items(): Promise<SourceResult<AdminPropertyReportQueueItem>> {
  try {
    const res = await supabase
      .from('property_reports')
      .select(PROPERTY_SELECT_COLUMNS)
      .eq('status', 'new')
      .order('created_at', { ascending: false });
    if (res.error || res.data === null) {
      return { items: [], failed: true };
    }
    return {
      items: group_property_reports(res.data as unknown as RawPropertyReportRow[]),
      failed: false,
    };
  } catch {
    return { items: [], failed: true };
  }
}

async function fetch_comment_items(): Promise<SourceResult<AdminCommentReportQueueItem>> {
  try {
    const res = await supabase
      .from('comment_reports')
      .select(COMMENT_SELECT_COLUMNS)
      .eq('status', 'new')
      .order('created_at', { ascending: false });
    if (res.error || res.data === null) {
      return { items: [], failed: true };
    }

    const groups = group_comment_reports(res.data as unknown as RawCommentReportRow[]);
    if (groups.length === 0) {
      // Sin comentarios reportados: la query a agent_public_profiles NUNCA
      // se dispara (evita `.in('user_id', [])`).
      return { items: [], failed: false };
    }

    const distinct_user_ids = Array.from(new Set(groups.map((g) => g.user_id)));
    const profile_names = new Map<string, string | null>();
    try {
      const profiles_res = await supabase
        .from('agent_public_profiles')
        .select('user_id, full_name')
        .in('user_id', distinct_user_ids);
      const profile_rows =
        (profiles_res.data as { user_id: string; full_name: string | null }[] | null) ?? [];
      for (const row of profile_rows) {
        profile_names.set(row.user_id, row.full_name);
      }
    } catch {
      // Identidad fail-soft: sin nombre resuelto, cae al fallback más abajo
      // — no tumba los items de comentario ya agrupados.
    }

    const items: AdminCommentReportQueueItem[] = groups.map((g) => ({
      kind: 'comment' as const,
      id: g.id,
      comment_id: g.comment_id,
      body: g.body,
      status: g.status,
      author_display_name: profile_names.get(g.user_id) ?? FALLBACK_AUTHOR_NAME,
      property_id: g.property_id,
      property_title: g.property_title,
      reason: g.reason,
      reason_text: g.reason_text,
      created_at: g.created_at,
      report_count: g.report_count,
    }));
    return { items, failed: false };
  } catch {
    return { items: [], failed: true };
  }
}

/** Fecha representativa de un item para el merge por created_at desc. */
function sort_key(item: AdminReportsQueueEntry): string {
  return item.kind === 'property' ? (item.reports[0]?.created_at ?? '') : item.created_at;
}

function merge_by_date(items: AdminReportsQueueEntry[]): AdminReportsQueueEntry[] {
  return [...items].sort((a, b) => {
    const ka = sort_key(a);
    const kb = sort_key(b);
    if (ka === kb) return 0;
    return ka > kb ? -1 : 1;
  });
}

export function useAdminReports(): UseAdminReportsResult {
  const [reports, set_reports] = useState<AdminReportsQueueEntry[] | null>(null);
  const [is_loading, set_is_loading] = useState(true);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  useEffect(() => {
    let ignore = false;

    // Envuelto en una función nombrada (invocada síncronamente abajo) en vez
    // de setState directo en el cuerpo del efecto — evita el lint
    // react-hooks/set-state-in-effect sin cambiar el timing (patrón
    // useAdminQueueCounts/useAdminRevisions).
    async function run_fetch(): Promise<void> {
      const [property_result, comment_result] = await Promise.all([
        fetch_property_items(),
        fetch_comment_items(),
      ]);
      if (ignore) return;

      set_is_loading(false);
      const combined = merge_by_date([...property_result.items, ...comment_result.items]);
      set_reports(combined);
      set_error_message(
        property_result.failed || comment_result.failed ? NEUTRAL_ERROR_MESSAGE : null,
      );
    }

    // Síncrono, ANTES de disparar la query, para que is_loading=true sea
    // observable en el mismo tick y ningún dato viejo se vea mientras carga.
    function start(): void {
      set_reports(null);
      set_error_message(null);
      set_is_loading(true);
      void run_fetch();
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
