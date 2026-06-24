/**
 * profileService.ts — lógica de perfil de agente.
 *
 * saveProfile({ fullName, imageUri, userId }):
 *   - Si imageUri: lee el archivo como ArrayBuffer (fetch API de RN/Expo),
 *     sube a profile-photos/{userId}/avatar.jpg y obtiene la URL pública.
 *   - UPSERT en user_preferences con user_id, full_name y profile_photo_url.
 *   - Lanza Error explícito en fallos de storage o upsert (sin swallow).
 *
 * Implementación GREEN — subtarea 6.5.
 *
 * NOTA DE DISEÑO: el cliente Supabase se carga con require() dentro de la función
 * (en lugar de import estático) para que los tests con jest.mock() puedan interceptar
 * la carga DESPUÉS de que los mocks de tipo `mock_*` estén inicializados.
 * En producción (Metro/Expo) el resultado es idéntico — require() devuelve el mismo
 * singleton ya cargado en el bundle.
 */

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
    // Leer el archivo local como ArrayBuffer — compatible con supabase-js en Expo/RN.
    // En producción: fetch() en RN entiende file:// URIs producidos por expo-image-picker.
    // En tests: el mock de supabase.storage.from intercepta antes de que el body importe.
    const response = await fetch(imageUri);
    const file_body = await response.arrayBuffer();

    const { error: upload_error } = await supabase.storage
      .from('profile-photos')
      .upload(avatar_path, file_body, {
        upsert: true,
        contentType: 'image/jpeg',
      });

    if (upload_error) {
      throw new Error(
        `storage/upload: no se pudo subir la foto de perfil — ${upload_error.message}`
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
