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
import { getInfoAsync } from 'expo-file-system';

import { usePublishForm } from '../store/PublishFormContext';
import { validate_video_size } from '../validation';

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

      // Validación de tamaño pre-upload — evita OOM en Hermes con videos grandes
      // y da un error legible antes de intentar la subida.
      const file_info = await getInfoAsync(local_uri);
      if (!file_info.exists) {
        status_ref.current = 'error';
        error_ref.current = 'El archivo de video no existe';
        return;
      }
      const size_validation = validate_video_size(file_info.size);
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

      // Leer el archivo local como ArrayBuffer — mismo patrón probado que la
      // subida de foto de perfil (profileService): fetch() en RN/Expo entiende
      // los file:// URIs de expo-image-picker. Pasar el URI como string subía
      // 92 bytes (el texto del path), no el video. ponytail: para videos grandes,
      // migrar a createSignedUploadUrl + FileSystem.uploadAsync (streaming nativo).
      const file_body = await (await fetch(local_uri)).arrayBuffer();

      const { error: upload_error } = await supabase_client.storage
        .from('property-videos')
        .upload(storage_path, file_body, {
          contentType: 'video/mp4',
          upsert: false,
        });

      if (upload_error) {
        status_ref.current = 'error';
        error_ref.current = upload_error.message;
        // NO escribir al form en error (EC-9)
        return;
      }

      // Éxito — escribir al form (EC-2) y actualizar estado
      update({ video_id, storage_path });
      status_ref.current = 'success';
      progress_ref.current = 1;
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
