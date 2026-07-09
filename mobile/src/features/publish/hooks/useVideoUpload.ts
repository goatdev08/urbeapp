/**
 * useVideoUpload — lógica de upload de video al wizard de publicación.
 *
 * Contrato (Opción C):
 *   - Deps inyectables: supabase client + generador de uuid (para tests deterministas).
 *   - Obtiene user_id de la sesión activa (supabase.auth.getSession).
 *   - Genera video_id con el uuid inyectado ANTES de subir.
 *   - Sube a storage bucket 'property-videos' con path '{user_id}/{video_id}.mp4'.
 *   - Reporta estado: idle → uploading → success | error.
 *   - Al éxito llama update({ video_id, storage_path }) del PublishFormContext.
 *   - En error: expone mensaje, NO escribe al form.
 *
 * NOTA DE IMPLEMENTACIÓN — refs puro, sin useState:
 *   RNTL v14 actualiza result.current vía useEffect (lazy). El sync act() de
 *   EC-12 drena microtasks via React internals; si hay un useState/force_rerender
 *   pendiente, se registra como "unresolved act work" y contamina tests siguientes.
 *
 *   Solución: estado SOLO en useRef. El hook devuelve un objeto con getters que
 *   leen los refs directamente. result.current apunta al objeto de la primera
 *   render (estable), pero los getters siempre devuelven el valor más reciente.
 *
 *   Para la UI (step3.tsx): el re-render se dispara a través de PublishFormContext
 *   (update() en éxito) o del estado local de la pantalla que invoca el hook.
 *   ponytail: sin useState extra en el hook — el techo de estado reactivo lo
 *   maneja el llamador (screen) no el hook.
 */

import { useRef, useCallback, useMemo } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { File, UploadType } from 'expo-file-system';

import { usePublishForm } from '../store/PublishFormContext';
import { validate_video_size } from '../validation';

// Mensaje neutro fijo para cualquier falla de red/subida (no expone detalle técnico
// ni sugiere "archivo más pequeño" — el límite de tamaño ya se valida antes).
const UPLOAD_ERROR_MESSAGE = 'Error al subir el video. Verifica tu conexión e intenta de nuevo.';

// ponytail: import lazy — el cliente real solo se carga cuando no se inyecta
// uno externo (los tests siempre inyectan su propio mock).
function get_default_supabase(): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: SupabaseClient }).supabase;
}

// ponytail: UUID vía expo-crypto (no crypto.randomUUID — NO existe en Hermes).
// Lazy-require para que los tests, que siempre inyectan su propio generador, no
// carguen el módulo nativo.
function default_uuid(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('expo-crypto') as { randomUUID: () => string }).randomUUID();
}

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export interface UseVideoUploadDeps {
  /** Cliente Supabase — inyectable para tests. Por defecto el singleton del módulo. */
  supabase?: SupabaseClient;
  /**
   * Generador de UUID — inyectable para tests deterministas. Por defecto expo-crypto randomUUID.
   * ponytail: tipado como `() => any` para aceptar jest.Mock sin forzar downcast en tests.
   *   En prod siempre devuelve string; en tests el mock también devuelve string en runtime.
   */
   
  uuid?: (...args: any[]) => any;
}

export interface UseVideoUploadResult {
  /** Inicia la subida del video indicado por su URI local. */
  upload: (local_uri: string | null) => Promise<void>;
  /** 'idle' | 'uploading' | 'success' | 'error' */
  status: UploadStatus;
  /** Progreso de la subida 0..1 (0 cuando no hay subida activa, 1 en éxito). */
  progress: number;
  /** Mensaje de error si status === 'error'; null en caso contrario. */
  error: string | null;
}

/**
 * Hook que encapsula la lógica de upload de video al wizard de publicación.
 * Debe usarse dentro de un PublishFormProvider.
 */
export function useVideoUpload(deps?: UseVideoUploadDeps): UseVideoUploadResult {
  const supabase_client = deps?.supabase ?? get_default_supabase();
  // ponytail: default uuid vía expo-crypto (crypto.randomUUID no existe en Hermes)
  const uuid_fn = deps?.uuid ?? default_uuid;

  const { update } = usePublishForm();

  // Estado SOLO en refs — sin useState. Ver nota de implementación arriba.
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
      // ejecución del async function, visible vía getter en sync act() (EC-12).
      status_ref.current = 'uploading';
      error_ref.current = null;
      progress_ref.current = 0;

      // Validación de tamaño pre-upload — SÍNCRONA vía la API nueva de File (v56):
      // .exists / .size son getters síncronos, sin I/O extra. Evita OOM y da un
      // error legible antes de intentar la subida.
      const file = new File(local_uri);
      if (!file.exists) {
        status_ref.current = 'error';
        error_ref.current = 'El archivo de video no existe';
        return;
      }
      const size_validation = validate_video_size(file.size);
      if (!size_validation.valid) {
        status_ref.current = 'error';
        error_ref.current = size_validation.error;
        return;
      }

      // Obtener sesión — user_id es el primer segmento del path (invariante RLS)
      const {
        data: { session },
      } = await supabase_client.auth.getSession();

      if (!session?.user?.id) {
        status_ref.current = 'error';
        error_ref.current = 'No hay sesión activa. Inicia sesión para publicar.';
        return;
      }

      const user_id = session.user.id;
      const video_id = uuid_fn();
      const storage_path = `${user_id}/${video_id}.mp4`;

      // Paso 1 — signed upload URL. Error devuelto (no throw) → mensaje del
      // error (o fallback neutro); excepción (red caída) → mensaje neutro fijo.
      let signed_url: string;
      try {
        const { data: signed_data, error: signed_error } = await supabase_client.storage
          .from('property-videos')
          .createSignedUploadUrl(storage_path);

        if (signed_error || !signed_data?.signedUrl) {
          status_ref.current = 'error';
          error_ref.current = signed_error?.message ?? UPLOAD_ERROR_MESSAGE;
          return;
        }
        signed_url = signed_data.signedUrl;
      } catch (err) {
        console.warn('[useVideoUpload] createSignedUploadUrl failed:', err);
        status_ref.current = 'error';
        error_ref.current = UPLOAD_ERROR_MESSAGE;
        return;
      }

      // Paso 2/3 — subida por streaming (sin cargar el archivo completo en RAM).
      try {
        const task = file.createUploadTask(signed_url, {
          httpMethod: 'PUT',
          uploadType: UploadType.BINARY_CONTENT,
          headers: { 'Content-Type': 'video/mp4' },
          onProgress: ({ bytesSent, totalBytes }) => {
            progress_ref.current = totalBytes > 0 ? Math.min(bytesSent / totalBytes, 0.99) : 0;
          },
        });

        const { status } = await task.uploadAsync();

        if (status < 200 || status >= 300) {
          status_ref.current = 'error';
          error_ref.current = UPLOAD_ERROR_MESSAGE;
          // NO escribir al form en error (EC-9)
          return;
        }

        // Éxito — escribir al form (EC-2) y actualizar estado
        update({ video_id, storage_path });
        status_ref.current = 'success';
        progress_ref.current = 1;
      } catch (err) {
        // Captura errores de red o cualquier fallo no manejado del upload task.
        // Mensaje amigable fijo: no exponemos el error técnico al owner.
        console.warn('[useVideoUpload] upload failed:', err);
        status_ref.current = 'error';
        error_ref.current = UPLOAD_ERROR_MESSAGE;
      }
    },
     
    [supabase_client, uuid_fn, update],
  );

  // Objeto con getters que leen directamente de los refs.
  // Estable por useMemo([upload]): si upload no cambia, es el MISMO objeto.
  // Si upload cambia (deps cambiaron), nuevo objeto, pero mismos refs → mismos getters.
  // RNTL v14: result.current apunta a este objeto (vía useEffect de HookContainer).
  // Aunque result.current quede obsoleto (pre-useEffect), los getters siempre
  // devuelven el ref.current más reciente.
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
