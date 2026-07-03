/**
 * useUpdateLeadNote — hook de mutación de internal_notes de lead. Fase GREEN (29.5).
 *
 * Contrato:
 *   update_note(lead_id, note)
 *     → invoca EF 'update-lead-note' con { lead_id, note }; note="" es válido
 *       (limpia la nota en DB, lo maneja el backend).
 *   is_updating: true de forma SÍNCRONA al disparar (patrón ref+force_update EC-9).
 *   error: null en éxito; string en fallo (EF o red).
 *   onSuccess: llamado solo en caso de éxito (EC-2, EC-6).
 *
 * Patrón de implementación: espejo exacto de useUpdateLeadStatus.ts (is_working_ref +
 * force_update síncrono ANTES del primer await, DI del cliente, run_action).
 */

import { useCallback, useMemo, useReducer, useRef } from 'react';

import { useAuth } from '@/features/auth/context';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface UseUpdateLeadNoteDeps {
  /** Cliente Supabase inyectado (en producción: supabase del singleton). */
  supabase?: unknown;
  /** Callback invocado tras éxito (p.ej. refetch de la lista CRM). */
  onSuccess?: () => void;
}

export interface UseUpdateLeadNoteReturn {
  /**
   * Invoca la EF update-lead-note con lead_id y note.
   * note="" es válido (limpia la nota). Llama onSuccess si la operación
   * es exitosa.
   */
  update_note(lead_id: string, note: string): Promise<void>;
  /** true mientras la invocación está en vuelo, false en reposo. */
  is_updating: boolean;
  /** null tras éxito; string con descripción en fallo. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Tipo interno de resultado (no expuesto — update_note retorna Promise<void>)
// ---------------------------------------------------------------------------

interface ActionResult {
  ok: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useUpdateLeadNote(deps?: UseUpdateLeadNoteDeps): UseUpdateLeadNoteReturn {
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
   * tick síncrono en que la acción arranca (patrón de useUpdateLeadStatus).
   *
   * EC-10 (doble-submit): si ya hay una acción en curso, retorna un resultado
   * "bloqueado" sin invocar action() de nuevo.
   */
  const run_action = (action: () => Promise<ActionResult>): Promise<ActionResult> => {
    if (is_working_ref.current) {
      return Promise.resolve({ ok: false, error: null });
    }

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
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : 'Error inesperado';
        is_working_ref.current = false;
        error_ref.current = msg;
        force_update();
        return { ok: false as const, error: msg };
      },
    );
  };

  /**
   * invoke_lead_note: invoca la EF update-lead-note y mapea el resultado
   * al formato {ok, error}. Función pura de I/O — no gestiona is_updating.
   */
  const invoke_lead_note = (body: Record<string, unknown>): Promise<ActionResult> => {
    const client = get_client();
    return (
      client.functions.invoke('update-lead-note', { body }) as Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>
    ).then(({ error }) => {
      if (error) {
        return { ok: false as const, error: error.message ?? 'Error al actualizar la nota' };
      }
      return { ok: true as const, error: null };
    });
  };

  // ── Acción pública ────────────────────────────────────────────────────────

  const update_note = useCallback(
    (lead_id: string, note: string): Promise<void> => {
      const body: Record<string, unknown> = { lead_id, note };

      return run_action(() => invoke_lead_note(body)).then((result) => {
        // EC-2: onSuccess solo en éxito. EC-6: no llamado si error.
        if (result.ok && deps?.onSuccess) {
          deps.onSuccess();
        }
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase, deps?.onSuccess],
  );

  // El objeto retornado usa getters para que is_updating y error sean siempre
  // el valor actual de la ref, incluso sin re-render previo (EC-9).
  return useMemo(() => {
    const r: UseUpdateLeadNoteReturn = {
      update_note,
      get is_updating() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;

  }, [update_note]);
}
