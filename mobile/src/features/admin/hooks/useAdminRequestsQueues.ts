/**
 * useAdminRequestsQueues — las TRES listas de /admin/requests (módulo 041-M4,
 * subtarea 221.4): solicitudes de agente (`agent_applications` status
 * 'pending'), inmobiliarias por aprobar (`agencies` status
 * 'pending_approval') y solicitudes de cuenta comercial (`advertising_requests`
 * status 'pending'). Contrato completo en
 * __tests__/useAdminRequestsQueues.test.ts.
 *
 * Tres hooks INDEPENDIENTES (no un todo-o-nada conjunto): cada sección de la
 * pantalla carga/falla/reintenta por su cuenta — mismo criterio que
 * PendingQueueSection/ActiveAdsSection en admin/ads/index.tsx (208.3/210.3),
 * no el todo-o-nada de useAdminQueueCounts (ese es un resumen agregado, esto
 * son listas independientes con su propia acción).
 *
 * 🔴 `useAdminAdvertisingRequests` usa un cast LOCAL `as any` en `.from(...)`:
 * `advertising_requests` es una tabla NUEVA (backend en paralelo, tarea
 * 221.1, otra rama) que todavía no está en
 * supabase/types/database.types.ts en este worktree — se retira en cuanto
 * los tipos se regeneren tras el merge (mismo criterio que
 * useMyAdvertisingRequest.ts).
 *
 * `client.from(...)` se llama DIRECTO, encadenado, nunca desprendido (#205).
 */
import { useCallback, useEffect, useState } from 'react';

import { supabase } from '@/lib/supabase/client';
import type { AdvertiserCategory } from '../components/advertiser-category-select';

const NEUTRAL_ERROR_MESSAGE = 'No se pudieron cargar las solicitudes. Intenta de nuevo.';

// ---------------------------------------------------------------------------
// Helper genérico: query única + ignore/refetch (mismo esqueleto que
// useAdminReports.ts, parametrizado por la promesa de la query).
// ---------------------------------------------------------------------------

function useSingleQueryList<T>(
  run_query: () => PromiseLike<{ data: T[] | null; error: unknown }>,
): { items: T[] | null; is_loading: boolean; error_message: string | null; refetch: () => void } {
  const [items, set_items] = useState<T[] | null>(null);
  const [is_loading, set_is_loading] = useState(true);
  const [error_message, set_error_message] = useState<string | null>(null);
  const [refetch_tick, set_refetch_tick] = useState(0);

  useEffect(() => {
    let ignore = false;

    function start(): void {
      set_items(null);
      set_error_message(null);
      set_is_loading(true);

      run_query().then(
        (res) => {
          if (ignore) return;
          set_is_loading(false);
          if (res.error || res.data === null) {
            set_items(null);
            set_error_message(NEUTRAL_ERROR_MESSAGE);
            return;
          }
          set_items(res.data);
          set_error_message(null);
        },
        () => {
          if (ignore) return;
          set_is_loading(false);
          set_items(null);
          set_error_message(NEUTRAL_ERROR_MESSAGE);
        },
      );
    }

    start();

    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refetch_tick]);

  const refetch = useCallback(() => set_refetch_tick((n) => n + 1), []);

  return { items, is_loading, error_message, refetch };
}

// ---------------------------------------------------------------------------
// 1) Solicitudes de agente — agent_applications status='pending'
// ---------------------------------------------------------------------------

export interface AdminAgentApplication {
  id: string;
  user_id: string;
  application_type: 'independent' | 'under_agency';
  agency_id: string | null;
  reason: string | null;
  created_at: string;
  applicant: { first_name: string | null; last_name: string | null; email: string } | null;
  agency: { id: string; name: string } | null;
}

const AGENT_APPLICATION_SELECT = `
  id,
  user_id,
  application_type,
  agency_id,
  reason,
  created_at,
  applicant:users!agent_applications_user_id_fkey(first_name, last_name, email),
  agency:agencies(id, name)
`;

export function useAdminAgentApplications() {
  return useSingleQueryList<AdminAgentApplication>(() =>
    supabase
      .from('agent_applications')
      .select(AGENT_APPLICATION_SELECT)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }) as unknown as PromiseLike<{
      data: AdminAgentApplication[] | null;
      error: unknown;
    }>,
  );
}

// ---------------------------------------------------------------------------
// 2) Inmobiliarias por aprobar — agencies status='pending_approval'.
// SOLO lectura: la fila LINKEA al detalle existente /admin/agencies/[id].tsx
// (211.1/71.5 ya aprueban/rechazan ahí) — no se duplica esa acción aquí.
// ---------------------------------------------------------------------------

export interface AdminPendingAgency {
  id: string;
  name: string;
  slug: string;
  contact_name: string | null;
  contact_email: string | null;
  created_at: string;
}

export function useAdminPendingAgencies() {
  return useSingleQueryList<AdminPendingAgency>(() =>
    supabase
      .from('agencies')
      .select('id, name, slug, contact_name, contact_email, created_at')
      .eq('status', 'pending_approval')
      .order('created_at', { ascending: false }),
  );
}

// ---------------------------------------------------------------------------
// 3) Solicitudes de cuenta comercial — advertising_requests status='pending'
// (tabla nueva, contrato pinneado de 221.1 — ver docblock de módulo).
// ---------------------------------------------------------------------------

export interface AdminAdvertisingRequest {
  id: string;
  agency_id: string;
  requested_by_user_id: string;
  proposed_category: AdvertiserCategory;
  created_at: string;
  agency: { id: string; name: string } | null;
}

const ADVERTISING_REQUEST_SELECT = `
  id,
  agency_id,
  requested_by_user_id,
  proposed_category,
  created_at,
  agency:agencies(id, name)
`;

export function useAdminAdvertisingRequests() {
  return useSingleQueryList<AdminAdvertisingRequest>(() =>
    // ponytail: cast local — advertising_requests aún no está en los tipos
    // generados en este worktree (ver docblock de módulo).
    (supabase as any)
      .from('advertising_requests')
      .select(ADVERTISING_REQUEST_SELECT)
      .eq('status', 'pending')
      .order('created_at', { ascending: false }),
  );
}
