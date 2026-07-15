/**
 * profileService.ts — lógica de perfil de agente.
 *
 * STUB RED — subtarea 69.3 (migración avatar Supabase Storage → R2 presigned).
 *
 * Contrato NUEVO objetivo (ver mobile/src/lib/__tests__/profileService.test.ts):
 *   saveProfile({ fullName, imageUri, userId }):
 *     - Si imageUri: pide una URL presigned PUT a la Edge Function `mint-r2-url`
 *       (`{ kind: 'avatar', op: 'put' }` — SIN `key`, el handler lo deriva del
 *       uid del JWT), sube el binario por streaming con
 *       `File(uri).createUploadTask(...).uploadAsync()` (mismo patrón que
 *       useVideoUpload — sin cargar el archivo completo en RAM), y guarda el
 *       **key** devuelto (NO una URL pública — bucket privado) en
 *       `user_preferences.profile_photo_url`.
 *     - Si NO imageUri: no toca R2, upsert con profile_photo_url: null.
 *     - Errores explícitos (sin swallow): fallo al mintear, fallo de subida
 *       (status no 2xx), fallo de upsert.
 *
 * Implementación GREEN pendiente — subtarea 69.3. Este stub SOLO lanza para
 * que la fase RED falle por excepción/aserción, nunca por import roto.
 */

export interface SaveProfileParams {
  fullName: string;
  imageUri: string | null;
  userId: string;
}

export interface SaveProfileResult {
  /** R2 key del avatar (NO url pública) — null si no hay foto. */
  profilePhotoUrl: string | null;
}

/**
 * Sube el avatar a R2 (si hay imageUri) vía presigned PUT y hace UPSERT en
 * user_preferences con el key resultante. STUB — lanza siempre (RED, 69.3).
 */
export async function saveProfile(_params: SaveProfileParams): Promise<SaveProfileResult> {
  throw new Error('not_implemented: saveProfile (migración R2 pendiente — subtarea 69.3)');
}
