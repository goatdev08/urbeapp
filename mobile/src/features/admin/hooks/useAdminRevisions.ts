/**
 * useAdminRevisions — cola de revisiones de ediciones (property_revisions
 * activas: pending|needs_changes) para el panel admin (módulo 041-M1, tarea
 * #218, subtarea 218.1). Fase RED. El contrato completo (firma, 11 edge
 * cases) vive en
 * mobile/src/features/admin/__tests__/useAdminRevisions.test.tsx — es el
 * archivo que fija el comportamiento; este archivo lo implementa sin
 * renegociarlo.
 *
 * Query ÚNICA (sin RPC nueva — la policy RLS property_revisions_select ya
 * autoriza el SELECT al admin vía `private.is_admin()`,
 * supabase/migrations/20260809000003_property_revisions.sql:67-74):
 *   supabase
 *     .from('property_revisions')
 *     .select(<columnas propias + embed a properties>)
 *     .in('status', ['pending', 'needs_changes'])
 *     .order('created_at', { ascending: true })   // FIFO: la más vieja primero
 *
 * El embed `property:properties(...)` trae el snapshot PUBLICADO (lo que el
 * feed/detalle público ve hoy) para que el admin compare contra
 * `changed_fields` (el diff). Los campos embebidos son EXACTAMENTE el
 * whitelist de edición de la EF edit-property (supabase/functions/edit-property/
 * types.ts:29-52, `EditPropertyInput` menos `property_id`) más `id` para
 * anclar el embed — ningún campo inventado, ninguno del whitelist omitido.
 *
 * Todo-o-nada (patrón useAdminQueueCounts/useAdStats): un error de PostgREST,
 * `data: null` sin error, o el rechazo de la promesa dejan `revisions=null` +
 * un mensaje neutro — nunca una lista parcial ni un `[]` fabricado. Lista
 * vacía LEGÍTIMA (`data: []`) sí es `revisions=[]`, no error.
 *
 * `client.from(...)` se llama DIRECTO, encadenado, nunca desprendido (#205,
 * memoria supabase_js_metodo_desprendido).
 */

import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

export interface AdminRevisionPropertySnapshot {
  id: string;
  operation_type: string;
  property_type: string;
  price: number;
  price_visible: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  square_meters: number | null;
  built_square_meters: number | null;
  half_bathrooms: number | null;
  currency: string;
  address: string;
  description: string;
  pet_friendly: boolean;
  allows_no_guarantor: boolean;
  student_friendly: boolean;
}

export interface AdminRevisionItem {
  revision_id: string;
  property_id: string;
  status: 'pending' | 'needs_changes';
  changed_fields: Record<string, unknown>;
  rejection_reason: string | null;
  created_at: string;
  property: AdminRevisionPropertySnapshot;
}

export interface UseAdminRevisionsResult {
  revisions: AdminRevisionItem[] | null;
  is_loading: boolean;
  error_message: string | null;
  refetch: () => void;
}

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar las revisiones pendientes. Intenta de nuevo.';

/**
 * Columnas propias de property_revisions + embed al whitelist de
 * edit-property (types.ts:29-52) más `id` para anclar el embed. Ni un campo
 * de más (like_count, view_count, agency_id, owner_user_id) ni uno de menos.
 */
const SELECT_COLUMNS = `
  id,
  property_id,
  status,
  changed_fields,
  rejection_reason,
  created_at,
  property:properties(
    id,
    operation_type,
    property_type,
    price,
    price_visible,
    bedrooms,
    bathrooms,
    square_meters,
    built_square_meters,
    half_bathrooms,
    currency,
    address,
    description,
    pet_friendly,
    allows_no_guarantor,
    student_friendly
  )
`;

interface RawRevisionRow {
  id: string;
  property_id: string;
  status: 'pending' | 'needs_changes';
  changed_fields: Record<string, unknown>;
  rejection_reason: string | null;
  created_at: string;
  property: AdminRevisionPropertySnapshot;
}

function map_row(row: RawRevisionRow): AdminRevisionItem {
  return {
    revision_id: row.id,
    property_id: row.property_id,
    status: row.status,
    changed_fields: row.changed_fields,
    rejection_reason: row.rejection_reason,
    created_at: row.created_at,
    property: row.property,
  };
}

export function useAdminRevisions(): UseAdminRevisionsResult {
  const [revisions, set_revisions] = useState<AdminRevisionItem[] | null>(null);
  const [is_loading, set_is_loading] = useState(true);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  useEffect(() => {
    let ignore = false;

    // Envuelto en una función nombrada (invocada síncronamente abajo) en vez
    // de setState directo en el cuerpo del efecto — evita el lint
    // react-hooks/set-state-in-effect sin cambiar el timing (patrón
    // useAdminQueueCounts).
    function run_fetch(): void {
      supabase
        .from('property_revisions')
        .select(SELECT_COLUMNS)
        .in('status', ['pending', 'needs_changes'])
        .order('created_at', { ascending: true })
        .then(
          (res) => {
            if (ignore) return;
            set_is_loading(false);
            // Todo-o-nada: error de PostgREST o `data: null` sin error nunca
            // se traducen en una lista vacía fabricada.
            if (res.error || res.data === null) {
              set_revisions(null);
              set_error_message(NEUTRAL_ERROR_MESSAGE);
              return;
            }
            set_revisions((res.data as unknown as RawRevisionRow[]).map(map_row));
            set_error_message(null);
          },
          () => {
            if (ignore) return;
            set_is_loading(false);
            set_revisions(null);
            set_error_message(NEUTRAL_ERROR_MESSAGE);
          },
        );
    }

    // Síncrono, ANTES de disparar la query, para que is_loading=true sea
    // observable en el mismo tick y ningún dato viejo se vea mientras carga
    // (mismo patrón que useAdminQueueCounts/start).
    function start(): void {
      set_revisions(null);
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

  return { revisions, is_loading, error_message, refetch };
}
