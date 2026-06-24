/**
 * profileService.ts — STUB mínimo (fase RED, subtarea 6.5).
 *
 * La implementación real llega en la fase GREEN.
 * Este archivo existe solo para que los imports del test no fallen.
 * Todas las funciones lanzan 'not_implemented'.
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
 * STUB — lanza en todos los casos hasta que se implemente en GREEN.
 */
export async function saveProfile(_params: SaveProfileParams): Promise<SaveProfileResult> {
  throw new Error('not_implemented: saveProfile');
}
