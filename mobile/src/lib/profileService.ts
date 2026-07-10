/**
 * profileService.ts — lógica de perfil de agente.
 *
 * saveProfile({ fullName, imageUri, userId }):
 *   - Si imageUri: sube por streaming vía signed URL — createSignedUploadUrl +
 *     File(uri).createUploadTask(...).uploadAsync() — a profile-photos/{userId}/avatar.jpg
 *     y obtiene la URL pública. Ya NO lee el archivo completo con fetch/arrayBuffer
 *     (evita el pico de RAM, mismo patrón que useVideoUpload post-52.1).
 *   - UPSERT en user_preferences con user_id, full_name y profile_photo_url.
 *   - Lanza Error explícito en fallos de storage o upsert (sin swallow).
 *
 * Implementación GREEN — subtarea 6.5. Migrada a streaming — subtarea 52.4.
 *
 * NOTA DE DISEÑO: el cliente Supabase se carga con require() dentro de la función
 * (en lugar de import estático) para que los tests con jest.mock() puedan interceptar
 * la carga DESPUÉS de que los mocks de tipo `mock_*` estén inicializados.
 * En producción (Metro/Expo) el resultado es idéntico — require() devuelve el mismo
 * singleton ya cargado en el bundle.
 */

import { File, UploadType } from 'expo-file-system';

export interface SaveProfileParams {
  fullName: string;
  imageUri: string | null;
  userId: string;
}

export interface SaveProfileResult {
  profilePhotoUrl: string | null;
}

/**
 * Sube la foto de perfil a Storage (si hay imageUri) y hace UPSERT en user_preferences.
 */
export async function saveProfile({
  fullName,
  imageUri,
  userId,
}: SaveProfileParams): Promise<SaveProfileResult> {
  // Carga lazy del cliente Supabase para que los mocks de test se intercepten
  // en el momento de la llamada (después de que los jest.fn() estén asignados).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { supabase } = require('@/lib/supabase/client') as typeof import('@/lib/supabase/client');

  const avatar_path = `${userId}/avatar.jpg`;
  let profile_photo_url: string | null = null;

  if (imageUri) {
    // Streaming: signed upload URL + File.createUploadTask — sin cargar el
    // archivo completo en RAM (elimina el fetch().arrayBuffer() previo).
    const { data: signed_data, error: signed_error } = await supabase.storage
      .from('profile-photos')
      .createSignedUploadUrl(avatar_path, { upsert: true });

    if (signed_error || !signed_data?.signedUrl) {
      throw new Error(
        `storage/signed-url: no se pudo obtener la URL de subida — ${signed_error?.message ?? 'error desconocido'}`
      );
    }

    const file = new File(imageUri);
    const task = file.createUploadTask(signed_data.signedUrl, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });

    const { status } = await task.uploadAsync();

    if (status < 200 || status >= 300) {
      throw new Error(
        `storage/upload: no se pudo subir la foto de perfil — status ${status}`
      );
    }

    const { data: url_data } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(avatar_path);

    profile_photo_url = url_data.publicUrl;
  }

  // Columnas full_name y profile_photo_url añadidas por migración 0015.
  // Los tipos generados aún no incluyen esas columnas; el cast `as never`
  // evita el error de TypeScript sin debilitar la lógica.
  // Una vez regenerados los tipos con 0015 se puede quitar.
  const { error: upsert_error } = await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        full_name: fullName,
        profile_photo_url,
      } as never,
      { onConflict: 'user_id' }
    );

  if (upsert_error) {
    throw new Error(
      `upsert/preferences: no se pudo guardar el perfil en user_preferences — ${upsert_error.message}`
    );
  }

  return { profilePhotoUrl: profile_photo_url };
}
