/**
 * useLikeProperty — stub mínimo para fase RED.
 *
 * Subtarea Taskmaster: 9.7 — persistencia like (parte crítica)
 *
 * API fijada por los tests:
 *   useLikeProperty({ property_video_id, property_id, initialLiked?, supabase? })
 *     → { isLiked: boolean, toggleLike: () => Promise<void>, likeOnly: () => Promise<void> }
 *
 * Reglas de negocio (verificadas contra migración 0006):
 *   - likeOnly: si NO liked → INSERT en likes {user_id (del auth), property_video_id, property_id}
 *               si YA liked → NO-OP (no inserta, no quita) — estilo TikTok doble-tap
 *   - toggleLike: liked → DELETE por (user_id, property_video_id)
 *                 no-liked → INSERT
 *   - Optimista + rollback: el estado cambia ANTES; si el op devuelve error → revierte
 *   - Unique conflict (23505) → tratar como "ya liked" (no revertir, no error visible)
 *   - user_id SIEMPRE del hook useAuth(), nunca de parámetros externos
 *
 * INYECCIÓN DE DEPS (para tests): useLikeProperty({ ..., supabase: mock })
 */

// ponytail: stub que lanza — el agente GREEN implementará la lógica real

export interface UseLikePropertyOpts {
  property_video_id: string;
  property_id: string;
  initialLiked?: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

export interface UseLikePropertyReturn {
  isLiked: boolean;
  toggleLike: () => Promise<void>;
  likeOnly: () => Promise<void>;
}

export function useLikeProperty(_opts: UseLikePropertyOpts): UseLikePropertyReturn {
  throw new Error('not_implemented: useLikeProperty');
}
