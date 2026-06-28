/**
 * usePropertyActions — acciones de mutación sobre propiedades propias.
 *
 * Subtarea 17.7 — stub mínimo RED (no_implemented).
 *
 * Contrato (a implementar en GREEN):
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
 */

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
    // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
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
// Hook — stub mínimo RED: lanza not_implemented en cada acción
// ---------------------------------------------------------------------------

export function usePropertyActions(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _deps?: UsePropertyActionsDeps,
): UsePropertyActionsReturn {
  // ponytail: stub que lanza — las acciones deben fallar por excepción en RED.
  // isWorking/error retornan valores triviales para que el hook sea renderable
  // (renderHook no explota); las acciones lanzan para que los tests fallen.
  const not_implemented = async (): Promise<ActionResult> => {
    throw new Error('not_implemented: usePropertyActions');
  };

  return {
    changeStatus: not_implemented,
    closeProperty: not_implemented,
    pauseProperty: not_implemented,
    unpauseProperty: not_implemented,
    deleteProperty: not_implemented,
    get isWorking() {
      return false;
    },
    get error() {
      return null;
    },
  };
}
