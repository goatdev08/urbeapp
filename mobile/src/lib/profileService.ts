/**
 * profileService.ts — lógica de perfil de agente.
 *
 * saveProfile({ fullName, imageUri, userId }):
 *   - Si imageUri: mintea una URL presigned PUT vía la Edge Function
 *     `mint-r2-url` (`{kind:'avatar', op:'put'}` — SIN key, el handler lo
 *     deriva del uid del JWT), sube por streaming — File(uri).createUploadTask
 *     (...).uploadAsync() — sin cargar el archivo completo en RAM (mismo
 *     patrón que useVideoUpload/52.4) — y guarda el **key** devuelto (NO una
 *     URL pública — bucket privado) en user_preferences.profile_photo_url.
 *   - UPSERT en user_preferences con user_id, full_name y profile_photo_url.
 *   - Lanza Error explícito en fallos de mint/upload/upsert (sin swallow).
 *
 * Implementación GREEN — subtarea 6.5. Migrada a streaming — subtarea 52.4.
 * Migrada de Supabase Storage a Cloudflare R2 presigned — subtarea 69.3.
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
  /** R2 key del avatar (NO url pública) — null si no hay foto. */
  profilePhotoUrl: string | null;
}

/** Forma de la respuesta de mint-r2-url para op:put. */
interface MintPutResponse {
  url: string;
  key: string;
  expires: number;
}

/**
 * Sube el avatar a R2 (si hay imageUri) vía presigned PUT y hace UPSERT en
 * user_preferences con el key resultante.
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

  let profile_photo_url: string | null = null;

  if (imageUri) {
    // El body NUNCA incluye `key` — el handler de mint-r2-url lo deriva del
    // uid del JWT (avatars/<uid>/<uuid>): el cliente jamás decide el key de
    // su propio avatar.
    const { data: mint_data, error: mint_error } = await supabase.functions.invoke(
      'mint-r2-url',
      { body: { kind: 'avatar', op: 'put' } },
    );

    const mint_result = mint_data as MintPutResponse | null;

    if (mint_error || !mint_result?.url || !mint_result?.key) {
      throw new Error(
        `mint-r2-url: no se pudo obtener la URL de subida del avatar — ${mint_error?.message ?? 'respuesta inválida'}`,
      );
    }

    // Streaming: File.createUploadTask — sin cargar el archivo completo en RAM.
    const file = new File(imageUri);
    const task = file.createUploadTask(mint_result.url, {
      httpMethod: 'PUT',
      uploadType: UploadType.BINARY_CONTENT,
      headers: { 'Content-Type': 'image/jpeg' },
    });

    const { status } = await task.uploadAsync();

    if (status < 200 || status >= 300) {
      throw new Error(`r2/upload: no se pudo subir la foto de perfil — status ${status}`);
    }

    // Se guarda el KEY (no la url presigned) — bucket privado, la lectura
    // resuelve el key a URL en el momento de mostrarlo (r2Resolver).
    profile_photo_url = mint_result.key;
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
      { onConflict: 'user_id' },
    );

  if (upsert_error) {
    throw new Error(
      `upsert/preferences: no se pudo guardar el perfil en user_preferences — ${upsert_error.message}`,
    );
  }

  return { profilePhotoUrl: profile_photo_url };
}
