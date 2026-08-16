/**
 * useAdUpload — STUB, fase RED (subtarea 169.7 de Taskmaster). NO implementa
 * lógica de negocio: solo fija la firma pública que el test-author fijó y que
 * el GREEN debe satisfacer. Lanza siempre — el propio acto de invocar el hook
 * debe fallar hasta que exista una implementación real.
 *
 * Contrato completo (ver el header de
 * mobile/src/features/ads/__tests__/useAdUpload.test.tsx para el detalle caso
 * por caso): ciclo mint-ad-upload-url → subida del binario a Cloudflare
 * Stream (reusando el patrón de
 * mobile/src/features/publish/hooks/useVideoUpload.ts) → poll del estado del
 * creativo (`ad_creatives.status`, vía un checker inyectable) hasta
 * 'ready' | 'failed'. La duración (169.6, validate_ad_duration_ms) se valida
 * ANTES de tocar el archivo o la red.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Estado observable del hook. 'polling' cubre el tramo entre el 2xx del binario y el desenlace del creativo. */
export type AdUploadStatus = 'idle' | 'uploading' | 'polling' | 'ready' | 'failed';

/** Estado real del creativo en `ad_creatives.status`, según lo reporta el checker inyectado. */
export type AdCreativeCheckStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'missing';

export interface UseAdUploadDeps {
  /** Cliente Supabase — inyectable para tests. Por defecto el singleton del módulo. */
  supabase?: SupabaseClient;
  /** Consulta el estado real del creativo por su cloudflare_uid — colaborador inyectable para tests. */
  check_ad_creative_status?: (cloudflare_uid: string) => Promise<AdCreativeCheckStatus>;
  /** Intentos máximos de poll antes de rendirse con un mensaje neutro. */
  poll_attempts?: number;
  /** Espera entre intentos de poll, en ms (nunca antes del primer intento). */
  poll_interval_ms?: number;
  /** Notificado en cada transición de status durante upload() — ver gotcha O2 del hermano. */
  on_status_change?: (status: AdUploadStatus) => void;
  /** Notificado con cada avance de progreso 0..1. */
  on_progress?: (progress: number) => void;
}

export interface UseAdUploadParams {
  /** URI local del video elegido (expo-image-picker). null = nada elegido. */
  local_uri: string | null;
  /** Duración del video en milisegundos, tal como la reporta el picker. Fail-closed si falta. */
  duration_ms: number | null;
}

export interface UseAdUploadResult {
  /** Inicia la subida del creativo. Si hay otra en vuelo, la reemplaza (supersede). */
  upload: (params: UseAdUploadParams) => Promise<void>;
  /** Cancela la subida/poll en vuelo (si la hay): aborta y vuelve a 'idle' sin error. */
  cancel: () => void;
  status: AdUploadStatus;
  /** Progreso 0..1. Se mantiene en 0.99 durante el poll — solo llega a 1 cuando status='ready'. */
  progress: number;
  /** Mensaje de error si status==='failed'; null en caso contrario. */
  error: string | null;
  /** uid de Cloudflare Stream del creativo, solo una vez status==='ready'; null en cualquier otro caso. */
  cloudflare_uid: string | null;
}

export function useAdUpload(_deps?: UseAdUploadDeps): UseAdUploadResult {
  throw new Error('not_implemented');
}
