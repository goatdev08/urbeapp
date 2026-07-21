/**
 * useVideoUpload — lógica de upload de video al wizard de publicación.
 *
 * GREEN — subtarea 68.4 (Taskmaster). Contrato upload-first vía Cloudflare
 * Stream, POST simple ≤200MB, sin tus-js-client:
 *
 *   1. Valida local_uri no nulo → null implica status='error', SIN invocar
 *      mint-upload-url.
 *   2. status='uploading' (visible antes del primer await, sync act()).
 *   3. `new File(local_uri)` (expo-file-system v56, getters síncronos
 *      .exists/.size). !exists → status='error', SIN invocar mint-upload-url.
 *   4. Techo de tamaño del direct upload simple de Stream: MAX_STREAM_UPLOAD_BYTES
 *      (200 MB). Excede → status='error' con mensaje claro, SIN invocar
 *      mint-upload-url.
 *   5. `supabase.functions.invoke('mint-upload-url', ...)` → { data: { uploadUrl,
 *      uid }, error }. Mapea error_code (vía extract_error_code, mismo patrón
 *      que ContactAgentButton/edge-errors.ts): UNAUTHENTICATED → mensaje de
 *      sesión; UPLOAD_IN_PROGRESS → mensaje específico de "video en proceso";
 *      cualquier otro (STREAM_UPLOAD_FAILED/INTERNAL_ERROR/red) → mensaje
 *      neutro. En error: NO sube a Stream, NO escribe al form.
 *   6. `file.createUploadTask(uploadUrl, { onProgress, ... })` +
 *      `uploadAsync()` — streaming, sin cargar el archivo completo en RAM
 *      (mismo patrón que profileService/#69). onProgress → progress 0..0.99.
 *   7. Éxito (2xx): status='processing' (NO 'success' — el video queda
 *      transcodificando en Stream; 'ready' llega por webhook, subtarea 68.5).
 *      progress=1. `update({ video_id: uid, cloudflare_uid: uid })`.
 *   8. Fallo (no-2xx o excepción): status='error', mensaje neutro, NO escribe
 *      al form.
 *
 * NOTA DE IMPLEMENTACIÓN — refs puro, sin useState (heredado del hook
 * anterior, ver historial): RNTL v14 actualiza result.current vía useEffect
 * (lazy); estado en refs + getters evita "unresolved act work" en sync act().
 */

import { useCallback, useMemo, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { File, UploadType } from 'expo-file-system';

import { usePublishForm } from '../store/PublishFormContext';
import { extract_error_code } from '@/lib/supabase/edge-errors';

// ponytail: techo del direct upload simple de Cloudflare Stream (sin tus). Si
// algún día se exige >200MB o resume, migrar a tus-js-client (decisión #68.4).
export const MAX_STREAM_UPLOAD_BYTES = 200 * 1024 * 1024;

// Mensajes fijos — no exponen detalle técnico al owner (mismo criterio que
// ContactAgentButton/map_ef_error).
const SESSION_ERROR_MESSAGE = 'No hay sesión activa. Inicia sesión para publicar.';
const NEUTRAL_ERROR_MESSAGE = 'Error al subir el video. Verifica tu conexión e intenta de nuevo.';
const UPLOAD_IN_PROGRESS_MESSAGE = 'Ya tienes un video en proceso. Espera a que termine para subir otro.';
const SIZE_ERROR_MESSAGE = `El video supera el máximo permitido (200 MB). Intenta con un video más ligero.`;

// ponytail: import lazy — el cliente real solo se carga cuando no se inyecta
// uno externo (los tests siempre inyectan su propio mock).
function get_default_supabase(): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: SupabaseClient }).supabase;
}

/** Mapea el error_code de mint-upload-url a un mensaje en español. */
function map_mint_error_code(code: string | undefined): string {
  if (code === 'UPLOAD_IN_PROGRESS') return UPLOAD_IN_PROGRESS_MESSAGE;
  if (code === 'UNAUTHENTICATED') return SESSION_ERROR_MESSAGE;
  return NEUTRAL_ERROR_MESSAGE;
}

export type UploadStatus = 'idle' | 'uploading' | 'processing' | 'error';

export interface UseVideoUploadDeps {
  /** Cliente Supabase — inyectable para tests. Por defecto el singleton del módulo. */
  supabase?: SupabaseClient;
}

export interface UseVideoUploadResult {
  /** Inicia la subida del video indicado por su URI local. */
  upload: (local_uri: string | null) => Promise<void>;
  /** 'idle' | 'uploading' | 'processing' | 'error' */
  status: UploadStatus;
  /** Progreso de la subida 0..1 (0 cuando no hay subida activa, 1 al terminar el binario). */
  progress: number;
  /** Mensaje de error si status === 'error'; null en caso contrario. */
  error: string | null;
}

/**
 * Hook que encapsula la lógica de upload de video al wizard de publicación
 * (Cloudflare Stream, upload-first). Debe usarse dentro de un PublishFormProvider.
 */
export function useVideoUpload(deps?: UseVideoUploadDeps): UseVideoUploadResult {
  const supabase_client = deps?.supabase ?? get_default_supabase();
  const { update } = usePublishForm();

  const status_ref = useRef<UploadStatus>('idle');
  const progress_ref = useRef<number>(0);
  const error_ref = useRef<string | null>(null);

  const upload = useCallback(
    async (local_uri: string | null): Promise<void> => {
      // Guard: no URI seleccionado
      if (!local_uri) {
        status_ref.current = 'error';
        error_ref.current = 'No se seleccionó ningún video';
        progress_ref.current = 0;
        return;
      }

      // Marcar como uploading ANTES del primer await — sincrónico en la
      // ejecución del async function, visible vía getter en sync act().
      status_ref.current = 'uploading';
      error_ref.current = null;
      progress_ref.current = 0;

      // Validación local: existencia + techo de tamaño — SÍNCRONA vía la API
      // nueva de File (v56): .exists / .size son getters síncronos, sin I/O
      // extra. Se valida ANTES de invocar mint-upload-url (EC10).
      const file = new File(local_uri);
      if (!file.exists) {
        status_ref.current = 'error';
        error_ref.current = 'El archivo de video no existe';
        return;
      }
      if (file.size > MAX_STREAM_UPLOAD_BYTES) {
        status_ref.current = 'error';
        error_ref.current = SIZE_ERROR_MESSAGE;
        return;
      }

      // Paso 1 — mint-upload-url: crea el upload slot en Cloudflare Stream
      // (upload-first) y devuelve { uploadUrl, uid }. El uid del agente sale
      // del JWT dentro de la EF, no se envía en el body.
      let upload_url: string;
      let stream_uid: string;
      try {
        const { data, error: mint_error } = await supabase_client.functions.invoke<{
          uploadUrl: string;
          uid: string;
        }>('mint-upload-url', { body: {} });

        if (mint_error || !data?.uploadUrl || !data?.uid) {
          const code = await extract_error_code(mint_error);
          status_ref.current = 'error';
          error_ref.current = map_mint_error_code(code);
          return;
        }
        upload_url = data.uploadUrl;
        stream_uid = data.uid;
      } catch {
        status_ref.current = 'error';
        error_ref.current = NEUTRAL_ERROR_MESSAGE;
        return;
      }

      // Paso 2 — subida por streaming al Direct Creator Upload de Cloudflare
      // Stream. ponytail: Stream espera POST multipart/form-data con el campo
      // 'file' (NO un PUT binario, a diferencia del path legado de Supabase
      // Storage / R2) — confirmado vía WebFetch a
      // developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
      // ("basic POST uploads ... multipart/form-data ... field named file ...
      // 200 en éxito, 4xx si excede 200MB"). E2E real contra Stream sigue
      // pendiente (gateway remoto en 402 al momento de escribir esto).
      try {
        const task = file.createUploadTask(upload_url, {
          httpMethod: 'POST',
          uploadType: UploadType.MULTIPART,
          fieldName: 'file',
          onProgress: ({ bytesSent, totalBytes }) => {
            progress_ref.current = totalBytes > 0 ? Math.min(bytesSent / totalBytes, 0.99) : 0;
          },
        });

        const { status } = await task.uploadAsync();

        if (status < 200 || status >= 300) {
          status_ref.current = 'error';
          error_ref.current = NEUTRAL_ERROR_MESSAGE;
          // NO escribir al form en error.
          return;
        }

        // Éxito — 'processing': el video queda transcodificando en Stream;
        // 'ready' llega por webhook (68.5). NO storage_path (flujo legado).
        update({ video_id: stream_uid, cloudflare_uid: stream_uid });
        status_ref.current = 'processing';
        progress_ref.current = 1;
      } catch (err) {
        console.warn('[useVideoUpload] upload failed:', err);
        status_ref.current = 'error';
        error_ref.current = NEUTRAL_ERROR_MESSAGE;
      }
    },

    [supabase_client, update],
  );

  return useMemo(
    () => ({
      upload,
      get status(): UploadStatus {
        return status_ref.current;
      },
      get progress(): number {
        return progress_ref.current;
      },
      get error(): string | null {
        return error_ref.current;
      },
    }),

    [upload],
  );
}
