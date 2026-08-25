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

export function useAdminRevisions(): UseAdminRevisionsResult {
  // Referenciados para que TS no marque el import de React/supabase como
  // no usado en este stub — el GREEN los usa de verdad.
  void useState;
  void useEffect;
  void useCallback;
  void supabase;
  throw new Error('not_implemented');
}
