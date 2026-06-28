/**
 * useEditProfile — stub mínimo para la fase RED de tests.
 *
 * IMPORTANTE: Este archivo es un STUB. No implementa lógica de negocio.
 * Las funciones tienen la firma correcta pero no hacen nada.
 * Los tests fallan por aserción (las mocks nunca se llaman, el error nunca se expone).
 *
 * La implementación real (tarea 22.3) hará:
 *   1. saveProfileFn({ fullName, imageUri, userId }) — foto a Storage + UPSERT user_preferences
 *   2. supabase.from('users').update({ bio }).eq('id', userId) — escribe users.bio
 *   Manejo independiente por operación (no short-circuit en error).
 *   removePhoto=true → imageUri=null a saveProfileFn (borra profile_photo_url).
 */

import { useState } from 'react';

import type { SaveProfileParams, SaveProfileResult } from '@/lib/profileService';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface EditProfileSaveParams {
  fullName: string;
  imageUri: string | null;
  bio: string;
  removePhoto?: boolean;
}

export interface UseEditProfileDeps {
  /** Cliente Supabase inyectado (en producción: supabase del singleton). */
  supabase?: unknown;
  /** Función saveProfile de profileService inyectada (en producción: import directo). */
  saveProfileFn?: (params: SaveProfileParams) => Promise<SaveProfileResult>;
}

export interface UseEditProfileReturn {
  /** Persiste el perfil con dual-write híbrido (Opción A). */
  save: (params: EditProfileSaveParams) => Promise<void>;
  /** true durante el guardado, false al terminar (éxito o error). */
  isSaving: boolean;
  /** null en éxito; string con descripción del error en fallo. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook — STUB: compile-safe, sin lógica de negocio
// ---------------------------------------------------------------------------

export function useEditProfile(_deps?: UseEditProfileDeps): UseEditProfileReturn {
  // ponytail: stub mínimo — solo la firma; no implementa el dual-write
  const [isSaving] = useState(false);
  const [error] = useState<string | null>(null);

  const save = async (_params: EditProfileSaveParams): Promise<void> => {
    // not_implemented — la implementación real:
    // 1. setIsSaving(true)
    // 2. Obtiene userId de useAuth().user.id
    // 3. Calcula effectiveImageUri = removePhoto ? null : imageUri
    // 4. Ejecuta ambas ops de forma independiente:
    //    a) saveProfileFn / profileService.saveProfile({ fullName, imageUri: effectiveImageUri, userId })
    //    b) supabase.from('users').update({ bio }).eq('id', userId)
    // 5. Recopila errores de ambas ops (sin short-circuit)
    // 6. setError(erroresAcumulados) o setError(null) en éxito
    // 7. setIsSaving(false)
  };

  return { save, isSaving, error };
}
