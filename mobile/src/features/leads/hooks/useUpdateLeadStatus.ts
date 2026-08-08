/**
 * useUpdateLeadStatus — hook de mutación de estado de lead. Fase GREEN (15.4).
 *
 * Contrato:
 *   update_status(lead_id, new_status, note?)
 *     → invoca EF 'update-lead-status'; devuelve {ok, error}.
 *     → note omitido del body cuando no se pasa (EC-8).
 *   is_updating: true de forma SÍNCRONA al disparar (patrón ref+force_update EC-9).
 *   error: null en éxito; string en fallo.
 *   onSuccess: llamado solo en caso de éxito (EC-2, EC-11).
 *
 * Patrón de implementación: replica usePropertyActions (is_working_ref +
 * force_update síncrono ANTES del primer await, DI del cliente, run_action).
 *
 * Errores (75.6, defecto #1 del usuario): el mensaje SIEMPRE es español y
 * NUNCA el texto crudo de supabase-js/Postgres — extract_error_code
 * (mobile/src/lib/supabase/edge-errors.ts, reusado de auth/registration/
 * agency/publish) + map_lead_ef_error (lead_error_messages.ts, compartido
 * con useUpdateLeadNote — misma EF, mismos 5 códigos).
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { useAuth } from '@/features/auth/context';
import { extract_error_code } from '@/lib/supabase/edge-errors';

import { map_lead_ef_error } from '../lead_error_messages';
import type { LeadStatus } from '../types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface ActionResult {
  ok: boolean;
  error: string | null;
}

export interface UseUpdateLeadStatusDeps {
  /** Cliente Supabase inyectado (en producción: supabase del singleton). */
  supabase?: unknown;
  /** Callback invocado tras éxito (p.ej. refetch de la lista CRM). */
  onSuccess?: () => void;
}

export interface UseUpdateLeadStatusReturn {
  /**
   * Invoca la EF update-lead-status con lead_id, new_status y note opcional.
   * Retorna {ok, error}; llama onSuccess si la operación es exitosa.
   */
  update_status(lead_id: string, new_status: LeadStatus, note?: string): Promise<ActionResult>;
  /** true mientras la invocación está en vuelo, false en reposo. */
  is_updating: boolean;
  /** null tras éxito; string con descripción en fallo. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUpdateLeadStatus(deps?: UseUpdateLeadStatusDeps): UseUpdateLeadStatusReturn {
  // useAuth — disponible para contexto de usuario; preserva orden de hooks entre renders.
  useAuth();

  // ponytail: refs para estado mutable síncrono; force_update provoca re-render
  // al final de cada acción. El getter en el objeto retornado permite leer el
  // valor actual de la ref sin esperar al re-render (necesario en EC-9).
  const is_working_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  // Resolución del cliente Supabase — lazy para que jest.mock intercepte.
   
  const get_client = (): any => {
    if (deps?.supabase) return deps.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  /**
   * run_action: wrapper SÍNCRONO que fija is_working=true antes del primer await.
   * No es async — retorna la Promise de action() directamente, sin añadir una
   * suspensión extra. Garantiza que EC-9 lea is_updating=true en el mismo
   * tick síncrono en que la acción arranca (patrón de usePropertyActions).
   */
  const run_action = (action: () => Promise<ActionResult>): Promise<ActionResult> => {
    is_working_ref.current = true;
    error_ref.current = null;
    force_update();

    return action().then(
      (result) => {
        is_working_ref.current = false;
        error_ref.current = result.error;
        force_update();
        return result;
      },
      // 75.6: error de red/timeout (invoke rechazado) — SIEMPRE el mensaje
      // neutro en español, nunca err.message crudo (map_lead_ef_error(undefined)
      // es exactamente ese mensaje — mismo camino que un código no parseable).
      (err: unknown) => {
        void err;
        const msg = map_lead_ef_error(undefined);
        is_working_ref.current = false;
        error_ref.current = msg;
        force_update();
        return { ok: false as const, error: msg };
      },
    );
  };

  /**
   * invoke_lead_status: invoca la EF update-lead-status y mapea el resultado
   * al formato {ok, error}. Función pura de I/O — no gestiona is_updating.
   */
  const invoke_lead_status = (body: Record<string, unknown>): Promise<ActionResult> => {
    const client = get_client();
    return (
      client.functions.invoke('update-lead-status', { body }) as Promise<{
        data: unknown;
        error: unknown | null;
      }>
    ).then(async ({ error }) => {
      if (error) {
        const code = await extract_error_code(error);
        return { ok: false as const, error: map_lead_ef_error(code) };
      }
      return { ok: true as const, error: null };
    });
  };

  // ── Acción pública ────────────────────────────────────────────────────────

  const update_status = useCallback(
    (lead_id: string, new_status: LeadStatus, note?: string): Promise<ActionResult> => {
      // EC-8: note omitido del body cuando no se pasa (spread condicional).
      const body: Record<string, unknown> = {
        lead_id,
        new_status,
        ...(note !== undefined ? { note } : {}),
      };

      return run_action(() => invoke_lead_status(body)).then((result) => {
        // EC-2: onSuccess solo en éxito. EC-11: no llamado si error.
        if (result.ok && deps?.onSuccess) {
          deps.onSuccess();
        }
        return result;
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  // El objeto retornado usa getters para que is_updating y error sean siempre
  // el valor actual de la ref, incluso sin re-render previo (EC-9).
  return useMemo(() => {
    const r: UseUpdateLeadStatusReturn = {
      update_status,
      get is_updating() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;
     
  }, [update_status]);
}
