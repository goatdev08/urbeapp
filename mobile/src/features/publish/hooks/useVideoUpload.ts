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
 *   8. Fallo (no-2xx o excepción) → paso 8b, NO error inmediato (#103).
 *
 * GREEN — subtarea 103.2: "verificar antes de fallar". `uploadAsync()` puede
 * lanzar (`Failed to read response`) o resolver no-2xx aunque el binario SÍ
 * haya llegado completo a Stream (falso negativo leyendo la respuesta HTTP).
 *   8b. status='verifying', progress=0.99. Se consulta `check_video_status`
 *       (inyectado o el default contra `property_videos`) hasta
 *       `verify_attempts` veces, esperando `verify_interval_ms` ENTRE
 *       intentos (nunca antes del primero):
 *         - 'ready' | 'processing' → mismo éxito que el 2xx feliz.
 *         - 'failed' → corta de inmediato (no agota intentos), mensaje
 *           propio de procesamiento fallido, NO escribe al form.
 *         - 'uploading' | 'missing' agotados los intentos → mensaje neutro.
 *         - el checker lanza → mensaje neutro, fail-closed (no reintenta).
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
const PROCESSING_FAILED_MESSAGE = 'El video no se pudo procesar. Intenta subir el video de nuevo.';

// Defaults del poll de verificación (#103.2) — acotado: ~10 intentos cada
// ~3s (~30s de techo) antes de rendirse con el mensaje neutro.
const DEFAULT_VERIFY_ATTEMPTS = 10;
const DEFAULT_VERIFY_INTERVAL_MS = 3000;

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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type UploadStatus = 'idle' | 'uploading' | 'verifying' | 'processing' | 'error';

/** Estado real del video en `public.property_videos`, según lo reporta el checker (#103.2). */
export type VideoCheckStatus = 'uploading' | 'processing' | 'ready' | 'failed' | 'missing';

export interface UseVideoUploadDeps {
  /** Cliente Supabase — inyectable para tests. Por defecto el singleton del módulo. */
  supabase?: SupabaseClient;
  /**
   * Consulta el estado real del video por su cloudflare_uid — colaborador
   * inyectable para tests. Por defecto consulta `property_videos` (#103.2).
   */
  check_video_status?: (cloudflare_uid: string) => Promise<VideoCheckStatus>;
  /** Intentos máximos de verificación cuando el upload falla. Default 10. */
  verify_attempts?: number;
  /** Espera entre intentos de verificación, en ms. Default 3000. */
  verify_interval_ms?: number;
  // Defecto O2 (guardian, tras 103.2): 'verifying' era una rama muerta —
  // step3.tsx solo leía hook.status DESPUÉS de `await upload()`, así que el
  // estado transitorio nunca se renderizaba. Este callback expone CADA
  // transición en vivo.
  /** Notificado en cada transición de status durante upload() (RNTL no puede observar refs a mitad de un await; ver EC22/EC23). */
  on_status_change?: (status: UploadStatus) => void;
  /**
   * Notificado EN VIVO con cada avance del progreso 0..1 (#150, EC24) — mismo
   * problema que on_status_change: el ref es invisible a mitad de un await,
   * y la barra de progreso de step5 necesita cada tick para animarse.
   */
  on_progress?: (progress: number) => void;
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
 * Checker por defecto (#103.2) — consulta `property_videos.status` por
 * cloudflare_uid. La RLS de `videos_select` ya deja al agente leer su propia
 * fila en vuelo (rama `agent_id = auth.uid()`, trabajo en paralelo sobre
 * `supabase/`). Sin fila → 'missing'. Error de la query → propaga (el
 * llamador lo trata fail-closed).
 */
export async function default_check_video_status(
  supabase_client: SupabaseClient,
  cloudflare_uid: string,
): Promise<VideoCheckStatus> {
  const { data, error } = await supabase_client
    .from('property_videos')
    .select('status')
    .eq('cloudflare_uid', cloudflare_uid)
    .maybeSingle();

  if (error) throw error;
  if (!data) return 'missing';
  return (data as { status: VideoCheckStatus }).status;
}

/**
 * Verifica el estado real del video antes de rendirse (#103, falso negativo
 * de `uploadAsync()`). Consulta primero, duerme ENTRE intentos (nunca antes
 * del primero) — así el estado 'verifying' es observable de inmediato tras
 * el fallo del binario, sin esperas artificiales.
 */
async function verify_before_failing(params: {
  cloudflare_uid: string;
  checker: (cloudflare_uid: string) => Promise<VideoCheckStatus>;
  attempts: number;
  interval_ms: number;
  /** Setter que actualiza status_ref Y notifica on_status_change (O2). */
  set_status: (status: UploadStatus) => void;
  /** Setter que actualiza progress_ref Y notifica on_progress (#150). */
  set_progress: (progress: number) => void;
  error_ref: { current: string | null };
  update: (patch: { video_id: string; cloudflare_uid: string }) => void;
}): Promise<void> {
  const { cloudflare_uid, checker, attempts, interval_ms, set_status, set_progress, error_ref, update } = params;

  set_status('verifying');
  set_progress(0.99);

  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(interval_ms);
      }
      const check_status = await checker(cloudflare_uid);

      if (check_status === 'ready' || check_status === 'processing') {
        update({ video_id: cloudflare_uid, cloudflare_uid });
        set_status('processing');
        set_progress(1);
        error_ref.current = null;
        return;
      }

      if (check_status === 'failed') {
        set_status('error');
        error_ref.current = PROCESSING_FAILED_MESSAGE;
        return;
      }

      // 'uploading' | 'missing' → el video sigue en curso, reintentar.
    }
  } catch (err) {
    console.warn('[useVideoUpload] check_video_status failed:', err);
    set_status('error');
    error_ref.current = NEUTRAL_ERROR_MESSAGE;
    return;
  }

  // Intentos agotados sin 'ready'/'processing'/'failed'.
  set_status('error');
  error_ref.current = NEUTRAL_ERROR_MESSAGE;
}

/**
 * Hook que encapsula la lógica de upload de video al wizard de publicación
 * (Cloudflare Stream, upload-first). Debe usarse dentro de un PublishFormProvider.
 */
export function useVideoUpload(deps?: UseVideoUploadDeps): UseVideoUploadResult {
  const supabase_client = deps?.supabase ?? get_default_supabase();
  const { update } = usePublishForm();

  // Desestructurados de `deps` para el arreglo de dependencias de `upload`
  // (O2, guardian): depender del objeto `deps` completo recrearía `upload`
  // en cada render si el llamador pasa un literal inline (como step3.tsx
  // pasará `{ on_status_change: set_ui_status }`) — los campos primitivos/
  // funciones son estables aunque el objeto contenedor no lo sea.
  const check_video_status = deps?.check_video_status;
  const verify_attempts = deps?.verify_attempts ?? DEFAULT_VERIFY_ATTEMPTS;
  const verify_interval_ms = deps?.verify_interval_ms ?? DEFAULT_VERIFY_INTERVAL_MS;
  const on_status_change = deps?.on_status_change;
  const on_progress = deps?.on_progress;

  const status_ref = useRef<UploadStatus>('idle');
  const progress_ref = useRef<number>(0);
  const error_ref = useRef<string | null>(null);

  const upload = useCallback(
    async (local_uri: string | null): Promise<void> => {
      // O2 (guardian): status_ref por sí solo es invisible a mitad de un
      // await (RNTL solo repinta result.current en su propio ciclo) — cada
      // transición pasa por aquí para que el llamador (step3.tsx) pueda
      // espejarla en estado de React EN VIVO, no solo tras el await final.
      const set_status = (next: UploadStatus): void => {
        status_ref.current = next;
        on_status_change?.(next);
      };
      // #150: gemelo de set_status para el progreso — la barra de step5 se
      // anima con cada tick notificado en vivo.
      const set_progress = (next: number): void => {
        progress_ref.current = next;
        on_progress?.(next);
      };

      // Guard: no URI seleccionado
      if (!local_uri) {
        set_status('error');
        error_ref.current = 'No se seleccionó ningún video';
        set_progress(0);
        return;
      }

      // Marcar como uploading ANTES del primer await — sincrónico en la
      // ejecución del async function, visible vía getter en sync act().
      set_status('uploading');
      error_ref.current = null;
      set_progress(0);

      // Validación local: existencia + techo de tamaño — SÍNCRONA vía la API
      // nueva de File (v56): .exists / .size son getters síncronos, sin I/O
      // extra. Se valida ANTES de invocar mint-upload-url (EC10).
      const file = new File(local_uri);
      if (!file.exists) {
        set_status('error');
        error_ref.current = 'El archivo de video no existe';
        return;
      }
      if (file.size > MAX_STREAM_UPLOAD_BYTES) {
        set_status('error');
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
          set_status('error');
          error_ref.current = map_mint_error_code(code);
          return;
        }
        upload_url = data.uploadUrl;
        stream_uid = data.uid;
      } catch {
        set_status('error');
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
      const task = file.createUploadTask(upload_url, {
        httpMethod: 'POST',
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        onProgress: ({ bytesSent, totalBytes }) => {
          set_progress(totalBytes > 0 ? Math.min(bytesSent / totalBytes, 0.99) : 0);
        },
      });

      // #103: uploadAsync() puede lanzar o devolver no-2xx aunque el binario
      // SÍ haya llegado completo a Stream (falso negativo leyendo la
      // respuesta HTTP). No marcar error todavía en ese caso — verificar.
      let stream_upload_ok: boolean;
      try {
        const { status } = await task.uploadAsync();
        stream_upload_ok = status >= 200 && status < 300;
      } catch (err) {
        console.warn('[useVideoUpload] uploadAsync failed, verificando estado real:', err);
        stream_upload_ok = false;
      }

      if (stream_upload_ok) {
        // Éxito — 'processing': el video queda transcodificando en Stream;
        // 'ready' llega por webhook (68.5). NO storage_path (flujo legado).
        update({ video_id: stream_uid, cloudflare_uid: stream_uid });
        set_status('processing');
        set_progress(1);
        return;
      }

      await verify_before_failing({
        cloudflare_uid: stream_uid,
        checker: check_video_status ?? ((uid) => default_check_video_status(supabase_client, uid)),
        attempts: verify_attempts,
        interval_ms: verify_interval_ms,
        set_status,
        set_progress,
        error_ref,
        update,
      });
    },

    [supabase_client, update, check_video_status, verify_attempts, verify_interval_ms, on_status_change, on_progress],
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
