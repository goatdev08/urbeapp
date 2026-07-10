/**
 * usePropertyActions — acciones de mutación sobre propiedades propias.
 *
 * Subtarea 17.7 — implementación GREEN.
 *
 * Contrato:
 *   changeStatus({property_id, new_status, closed_reason?})
 *     → invoca EF 'update-property-status'; devuelve {ok, error}.
 *   closeProperty({property_id, closed_reason})
 *     → guard en cliente: si !closed_reason, NO invoca la EF; devuelve {ok:false, error}.
 *   pauseProperty({property_id})  → changeStatus a 'paused'.
 *   unpauseProperty({property_id}) → changeStatus a 'active'.
 *   deleteProperty({property_id})
 *     → soft-delete: supabase.from('properties').update({deleted_at:<iso>}).eq('id', property_id)
 *     → RLS owner; trigger cascade_soft_delete_property_videos actúa en DB.
 *   isWorking: true durante cualquier operación, false en reposo.
 *   error: null en éxito; string en fallo.
 *
 * INYECCIÓN DE DEPS (para tests): usePropertyActions({ supabase: mock }).
 *
 * NOTA DE IMPLEMENTACIÓN — isWorking vía ref + getter:
 *   run_action() es una función SÍNCRONA que retorna una Promise. Esto garantiza
 *   que is_working_ref.current = true se ejecute antes del primer await, haciendo
 *   que EC-20 (isWorking=true durante la acción pendiente) pase sin race condition.
 *   El patrón espeja useEditProfile.ts (aprendizaje de #22).
 */

import { useRef, useReducer, useCallback, useMemo } from 'react';

import { useAuth } from '@/features/auth/context';
import { emitPropertyDeleted } from '@/lib/propertyEvents';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type ClosedReason = 'rented' | 'sold' | 'withdrawn' | 'expired';
export type PropertyStatusTarget = 'draft' | 'active' | 'paused' | 'closed';

export interface ActionResult {
  ok: boolean;
  error: string | null;
}

export interface UsePropertyActionsDeps {
  /** Cliente Supabase inyectado (en producción: supabase del singleton). */
  supabase?: unknown;
}

export interface UsePropertyActionsReturn {
  /** Invoca la EF update-property-status con el status y reason dados. */
  changeStatus(params: {
    property_id: string;
    new_status: PropertyStatusTarget;
    closed_reason?: ClosedReason | null;
  }): Promise<ActionResult>;

  /**
   * Cierra la propiedad.
   * INVARIANTE: closed_reason es OBLIGATORIO. Si falta (null/undefined en runtime),
   * el guard NO invoca la EF y devuelve {ok:false, error: '...'}.
   */
  closeProperty(params: {
    property_id: string;
     
    closed_reason: ClosedReason | null | undefined; // explícito para que el guard sea testeable
  }): Promise<ActionResult>;

  /** Pausa la propiedad (active → paused). */
  pauseProperty(params: { property_id: string }): Promise<ActionResult>;

  /** Reactiva la propiedad (paused → active). */
  unpauseProperty(params: { property_id: string }): Promise<ActionResult>;

  /**
   * Soft-delete: sets deleted_at = ISO timestamp.
   * RLS owner garantiza que solo el dueño puede hacerlo.
   * El trigger cascade_soft_delete_property_videos propaga el deleted_at a los videos.
   */
  deleteProperty(params: { property_id: string }): Promise<ActionResult>;

  /** true durante cualquier operación asíncrona, false en reposo. */
  isWorking: boolean;

  /** null tras éxito; string con descripción en fallo. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePropertyActions(deps?: UsePropertyActionsDeps): UsePropertyActionsReturn {
  // useAuth — disponible para contexto de usuario en extensiones futuras.
  // ponytail: no usamos user.id aquí (el guard lo hace la EF via RLS) pero el
  // hook debe llamar a useAuth para respetar el orden de hooks entre renders.
  useAuth();

  // ponytail: refs para estado mutable síncrono; force_update provoca re-render
  // al final de cada acción para consumidores React. El getter en el objeto
  // retornado permite leer el valor sin esperar al re-render (necesario en EC-20).
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
   * suspensión extra. Esto garantiza que EC-20 lea is_working=true en el mismo
   * tick síncrono en que la acción arranca.
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
   * invoke_status: invoca la EF update-property-status y mapea el resultado
   * al formato {ok, error}. Función pura de I/O — no gestiona isWorking.
   */
  const invoke_status = (body: Record<string, unknown>): Promise<ActionResult> => {
    const client = get_client();
    return (
      client.functions.invoke('update-property-status', { body }) as Promise<{
        data: unknown;
        error: { message?: string } | null;
      }>
    ).then(({ error }) => {
      if (error) {
        return { ok: false as const, error: error.message ?? 'Error al actualizar el estado' };
      }
      return { ok: true as const, error: null };
    });
  };

  // ── Acciones públicas ────────────────────────────────────────────────────

  const changeStatus = useCallback(
    (params: {
      property_id: string;
      new_status: PropertyStatusTarget;
      closed_reason?: ClosedReason | null;
    }): Promise<ActionResult> => {
      const body: Record<string, unknown> = {
        property_id: params.property_id,
        new_status: params.new_status,
      };
      // Incluir closed_reason en el body solo si se proporciona explícitamente.
      // Undefined omitido → body limpio para pause/unpause/draft.
      if (params.closed_reason !== undefined) {
        body.closed_reason = params.closed_reason;
      }
      return run_action(() => invoke_status(body));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase],
  );

  const closeProperty = useCallback(
    (params: {
      property_id: string;
       
      closed_reason: ClosedReason | null | undefined;
    }): Promise<ActionResult> => {
      // Guard en cliente — INVARIANTE PRD: closed_reason es OBLIGATORIO.
      // Si falta (null / undefined), NO invocamos la EF y devolvemos error.
      if (!params.closed_reason) {
        return Promise.resolve({
          ok: false,
          error: 'Se requiere un motivo de cierre (closed_reason) para cerrar la publicación.',
        });
      }
      return run_action(() =>
        invoke_status({
          property_id: params.property_id,
          new_status: 'closed',
          closed_reason: params.closed_reason,
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase],
  );

  const pauseProperty = useCallback(
    (params: { property_id: string }): Promise<ActionResult> => {
      // closed_reason: null explícito → body lo incluye como null (EC-11 acepta null)
      return run_action(() =>
        invoke_status({
          property_id: params.property_id,
          new_status: 'paused',
          closed_reason: null,
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase],
  );

  const unpauseProperty = useCallback(
    (params: { property_id: string }): Promise<ActionResult> => {
      // Sin closed_reason — reactivación limpia.
      return run_action(() =>
        invoke_status({
          property_id: params.property_id,
          new_status: 'active',
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase],
  );

  const deleteProperty = useCallback(
    (params: { property_id: string }): Promise<ActionResult> => {
      return run_action(() => {
        const client = get_client();
        return (
          client
            .from('properties')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', params.property_id) as Promise<{
            error: { message?: string } | null;
          }>
        ).then(({ error }) => {
          if (error) {
            return { ok: false as const, error: error.message ?? 'Error al eliminar la propiedad' };
          }
          emitPropertyDeleted(params.property_id);
          return { ok: true as const, error: null };
        });
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deps?.supabase],
  );

  // El objeto retornado usa getters para que isWorking y error sean siempre
  // el valor actual de la ref, incluso sin re-render previo (EC-20).
  return useMemo(() => {
    const r: UsePropertyActionsReturn = {
      changeStatus,
      closeProperty,
      pauseProperty,
      unpauseProperty,
      deleteProperty,
      get isWorking() {
        return is_working_ref.current;
      },
      get error() {
        return error_ref.current;
      },
    };
    return r;
     
  }, [changeStatus, closeProperty, pauseProperty, unpauseProperty, deleteProperty]);
}
