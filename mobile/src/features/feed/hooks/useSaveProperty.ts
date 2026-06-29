/**
 * useSaveProperty — stub mínimo para fase RED.
 *
 * Subtarea Taskmaster: 9.7 — persistencia save (parte crítica)
 *
 * API fijada por los tests:
 *   useSaveProperty({ property_id, initialSaved?, supabase? })
 *     → { isSaved: boolean, toggleSave: () => Promise<void> }
 *
 * Reglas de negocio (verificadas contra migración 0006):
 *   - toggleSave: no-saved → INSERT en saves {user_id (del auth), property_id} (SIN property_video_id)
 *                 saved → DELETE por (user_id, property_id)
 *   - Optimista + rollback: el estado cambia ANTES; error → revierte al estado previo
 *   - Unique conflict (23505) → tratar como "ya saved" (no revertir)
 *   - user_id SIEMPRE del hook useAuth(), nunca de parámetros externos
 *
 * INYECCIÓN DE DEPS (para tests): useSaveProperty({ ..., supabase: mock })
 */

// ponytail: stub que lanza — el agente GREEN implementará la lógica real

export interface UseSavePropertyOpts {
  property_id: string;
  initialSaved?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

export interface UseSavePropertyReturn {
  isSaved: boolean;
  toggleSave: () => Promise<void>;
}

export function useSaveProperty(_opts: UseSavePropertyOpts): UseSavePropertyReturn {
  throw new Error('not_implemented: useSaveProperty');
}
