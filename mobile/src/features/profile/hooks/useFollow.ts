/**
 * useFollow — STUB fase RED (subtarea 78.3, tarea #78 «follow de cuentas F1»).
 *
 * Contrato objetivo (fase GREEN, ver useFollow.test.tsx para el detalle EC-n):
 *   useFollow({ followed_user_id, supabase? })
 *     → { is_following: boolean, loading: boolean, toggle_follow: () => Promise<void>, is_own: boolean }
 *
 * Este archivo es SOLO un stub — no implementa negocio. Existe para que
 * useFollow.test.tsx falle por ASERCIÓN (no por "module not found").
 */

// ponytail: stub deliberado — sin lógica, la implementación real llega en GREEN (78.3/78.4).
export interface UseFollowOpts {
  followed_user_id: string;

  supabase?: any;
}

export interface UseFollowReturn {
  is_following: boolean;
  loading: boolean;
  toggle_follow: () => Promise<void>;
  is_own: boolean;
}

export function useFollow(_opts: UseFollowOpts): UseFollowReturn {
  return {
    is_following: false,
    loading: false,
    is_own: false,
    toggle_follow: async () => {},
  };
}
