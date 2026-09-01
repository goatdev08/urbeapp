/**
 * useMyAdvertisingRequest — última solicitud de cuenta comercial del owner
 * (tabla NUEVA `advertising_requests`, subtarea 221.3). Contrato completo y
 * edge cases en __tests__/useMyAdvertisingRequest.test.ts.
 *
 * 🔴 CONTRATO PINNEADO (backend en paralelo, tarea 221.1 — otra rama):
 *   advertising_requests: {id, agency_id, requested_by_user_id,
 *     proposed_category, status: 'pending'|'approved'|'rejected',
 *     rejection_reason, created_at, resolved_at}
 * La tabla NO está en supabase/types/database.types.ts todavía (worktree
 * aislado, backend no mergeado) — de ahí el cast `as any` LOCALIZADO al
 * `.from('advertising_requests')`. Se retira en cuanto los tipos se
 * regeneren tras el merge (mismo criterio que useCanAdvertise documentó
 * durante el rollout de 168-172).
 *
 * Recibe `agency_id` ya resuelto por el caller (la pantalla ya lo tiene vía
 * useAgencyRole para su propio guard de owner) — evita una query de
 * membresía duplicada. `agency_id === null` (aún cargando o sin membresía)
 * → estado seguro sin disparar query.
 *
 * Filtra EXPLÍCITO por `agency_id` aunque RLS ya lo haría (mismo criterio
 * que useSavedProperties/#155: nunca confiar solo en la policy).
 *
 * `client.from(...)` se llama DIRECTO, encadenado, nunca desprendido (#205).
 */
import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { AdvertiserCategory } from '@/features/admin/components/advertiser-category-select';

export type AdvertisingRequestStatus = 'pending' | 'approved' | 'rejected';

export interface MyAdvertisingRequest {
  id: string;
  proposed_category: AdvertiserCategory;
  status: AdvertisingRequestStatus;
  rejection_reason: string | null;
  created_at: string;
}

export interface UseMyAdvertisingRequestResult {
  loading: boolean;
  request: MyAdvertisingRequest | null;
  error_message: string | null;
  refetch: () => void;
}

const NEUTRAL_ERROR_MESSAGE =
  'No se pudo cargar el estado de tu solicitud. Intenta de nuevo.';

export function useMyAdvertisingRequest(
  agency_id: string | null,
): UseMyAdvertisingRequestResult {
  const [loading, set_loading] = useState(true);
  const [request, set_request] = useState<MyAdvertisingRequest | null>(null);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  useEffect(() => {
    let ignore = false;

    function start(): void {
      set_request(null);
      set_error_message(null);
      set_loading(true);

      if (agency_id === null) {
        set_loading(false);
        return;
      }

      // ponytail: cast local — advertising_requests aún no está en los tipos
      // generados en este worktree (ver docblock de módulo).
      (supabase as any)
        .from('advertising_requests')
        .select('id, proposed_category, status, rejection_reason, created_at')
        .eq('agency_id', agency_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(
          (res: { data: MyAdvertisingRequest | null; error: unknown }) => {
            if (ignore) return;
            set_loading(false);
            if (res.error) {
              set_request(null);
              set_error_message(NEUTRAL_ERROR_MESSAGE);
              return;
            }
            set_request(res.data ?? null);
            set_error_message(null);
          },
          () => {
            if (ignore) return;
            set_loading(false);
            set_request(null);
            set_error_message(NEUTRAL_ERROR_MESSAGE);
          },
        );
    }

    start();

    return () => {
      ignore = true;
    };
  }, [agency_id, refetch_tick]);

  const refetch = useCallback(() => {
    set_refetch_tick((n) => n + 1);
  }, []);

  return { loading, request, error_message, refetch };
}
