/**
 * useVideoUpload — stub mínimo (fase RED).
 *
 * Contrato (Opción C, decidido por el orquestador):
 *   - Recibe deps inyectables: supabase client + generador de uuid.
 *   - Obtiene user_id de la sesión activa (supabase.auth.getSession).
 *   - Genera video_id con el uuid inyectado ANTES de subir.
 *   - Sube a storage bucket 'property-videos' con path '{user_id}/{video_id}.mp4'.
 *   - Reporta progreso vía estado (idle → uploading → success | error).
 *   - Al éxito llama update({ video_id, storage_path }) del PublishFormContext.
 *   - En error: expone mensaje, NO escribe al form.
 *
 * STUB — devuelve la forma correcta pero sin implementación.
 * upload() lanza 'not_implemented' → los tests fallan por aserción / excepción,
 * no por 'Cannot read properties of undefined'.
 */

import { useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export interface UseVideoUploadDeps {
  /** Cliente Supabase — inyectable para tests. Por defecto el singleton del módulo. */
  supabase?: SupabaseClient;
  /** Generador de UUID — inyectable para tests deterministas. Por defecto crypto.randomUUID. */
  uuid?: () => string;
}

export interface UseVideoUploadResult {
  /** Inicia la subida del video indicado por su URI local. */
  upload: (local_uri: string | null) => Promise<void>;
  /** 'idle' | 'uploading' | 'success' | 'error' */
  status: UploadStatus;
  /** Progreso de la subida 0..1 (0 cuando no hay subida activa). */
  progress: number;
  /** Mensaje de error si status === 'error'; null en caso contrario. */
  error: string | null;
}

/**
 * Hook que encapsula la lógica de upload de video al wizard de publicación.
 * Debe usarse dentro de un PublishFormProvider.
 */
export function useVideoUpload(_deps?: UseVideoUploadDeps): UseVideoUploadResult {
  // ponytail: stub — estado inicial correcto pero upload no implementado.
  const [status] = useState<UploadStatus>('idle');
  const [progress] = useState(0);
  const [error] = useState<string | null>(null);

  // ponytail: stub — upload es no-op intencionalmente.
  // Los tests fallan por aserción sobre estado (status!='success', form.video_id=null, etc.)
  // Si upload lanzara, act() lo propagaría y result.current quedaría undefined.
  const upload = async (_local_uri: string | null): Promise<void> => {
    // not_implemented: lógica de upload pendiente (fase GREEN)
  };

  return { upload, status, progress, error };
}
