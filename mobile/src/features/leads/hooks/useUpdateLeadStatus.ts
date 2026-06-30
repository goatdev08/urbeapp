/**
 * useUpdateLeadStatus — STUB fase RED (subtarea 15.4).
 *
 * Stub mínimo para que los tests de la fase RED fallen por aserción.
 * No contiene lógica de negocio:
 *   - update_status: NO invoca functions.invoke, NO llama onSuccess.
 *   - is_updating: siempre false (EC-9: is_updating=true durante acción → falla).
 *   - error: null estático.
 *   - update_status retorna {ok:false, error:'not_implemented'} (EC-1, EC-3 → fallan).
 *
 * La implementación GREEN seguirá el patrón de usePropertyActions.ts:
 *   - is_working_ref + force_update (síncrono antes del primer await)
 *   - get_client() lazy (require('@/lib/supabase/client'))
 *   - invoke_status() que llama functions.invoke y mapea {data,error}
 *   - onSuccess llamado solo en éxito
 */

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
// Hook — STUB, fase RED
// ---------------------------------------------------------------------------

export function useUpdateLeadStatus(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deps?: UseUpdateLeadStatusDeps,
): UseUpdateLeadStatusReturn {
  // STUB: retorna valores incorrectos para que los tests fallen por aserción.
  // - update_status: ok:false fuerza fallo en EC-1, EC-3.
  //   No llama functions.invoke → EC-4..EC-8, EC-10..EC-13 fallan.
  //   No llama onSuccess → EC-2, EC-11 fallan.
  // - is_updating: false → EC-9 (is_updating=true durante acción) falla.
  // - error: null (compatible con estado inicial correcto).
  return {
    update_status: async (
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _lead_id: string,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _new_status: LeadStatus,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _note?: string,
    ): Promise<ActionResult> => {
      // ponytail: stub — sin lógica. ok:false fuerza fallo en EC-1 y EC-3.
      return { ok: false, error: 'not_implemented' };
    },
    is_updating: false,
    error: null,
  };
}
