/**
 * useEditProfile — dual-write híbrido (Opción A).
 *
 * Subtarea 22.3 — Implement hybrid save logic.
 *
 * Contrato:
 *   save({ fullName, imageUri, bio, removePhoto? }) hace DOS escrituras INDEPENDIENTES:
 *     1. saveProfileFn({ fullName, imageUri, userId }) → foto+user_preferences (profileService)
 *     2. supabase.from('users').update({ bio }).eq('id', userId) → users.bio
 *
 * SEMÁNTICA DE ERROR: manejo independiente por operación.
 *   Si op A lanza, op B AÚN se intenta (sin short-circuit).
 *   Cualquier fallo se expone en `error` (no se traga).
 *
 * imageUri sigue la semántica de 3 estados de saveProfile (69.6):
 *   undefined=KEEP (foto sin cambios, no se pisa lo guardado), null=REMOVE,
 *   string=REPLACE. removePhoto=true → fuerza imageUri=null a saveProfileFn
 *   (borra profile_photo_url) independientemente del imageUri recibido.
 *
 * INYECCIÓN DE DEPS (para tests): useEditProfile({ supabase: mock, saveProfileFn: mock }).
 *
 * NOTA DE IMPLEMENTACIÓN — isSaving vía ref + getter:
 *   React 19 con RNTL v14 aplica los setState de forma asíncrona incluso para
 *   llamadas síncronas dentro de un act() no-awaited. EC-12 necesita leer
 *   isSaving=true ANTES de que ocurra el re-render. Usamos una ref para que la
 *   lectura sea inmediata; el getter en el objeto retornado expone el valor
 *   correcto en cualquier momento. force_update() sigue provocando el re-render
 *   al final para que los consumidores React que usen el hook en producción
 *   reciban la actualización vía el ciclo de vida normal.
 */

import { useRef, useReducer, useCallback, useMemo } from 'react';

import { saveProfile } from '@/lib/profileService';
import { useAuth } from '@/features/auth/context';
import type { SaveProfileParams, SaveProfileResult } from '@/lib/profileService';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface EditProfileSaveParams {
  fullName: string;
  /** string=REPLACE, null=REMOVE, undefined=KEEP (sin cambio de foto). */
  imageUri: string | null | undefined;
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
  /**
   * Persiste el perfil con dual-write híbrido (Opción A).
   * Devuelve { ok, error } para que el caller use el resultado DEVUELTO y no
   * la variable destructurada del render anterior (que sería un snapshot obsoleto).
   * Retrocompatible: `await save(params)` sin capturar el retorno sigue funcionando.
   */
  save: (params: EditProfileSaveParams) => Promise<{ ok: boolean; error: string | null }>;
  /** true durante el guardado, false al terminar (éxito o error). */
  isSaving: boolean;
  /** null en éxito; string con descripción del error en fallo. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEditProfile(deps?: UseEditProfileDeps): UseEditProfileReturn {
  const { user } = useAuth();

  // ponytail: refs para estado mutable síncrono; force_update provoca re-render
  // al final de save() para consumidores React. El getter en el objeto retornado
  // permite leer el valor sin esperar al re-render (necesario en EC-12).
  const is_saving_ref = useRef(false);
  const error_ref = useRef<string | null>(null);
  const [, force_update] = useReducer((n: number) => n + 1, 0);

  const save = useCallback(async ({
    fullName,
    imageUri,
    bio,
    removePhoto,
  }: EditProfileSaveParams): Promise<{ ok: boolean; error: string | null }> => {
    const user_id = user?.id ?? '';

    // removePhoto=true → forzar null independientemente de imageUri
    const effective_image_uri = removePhoto ? null : imageUri;

    // Resolución de deps: inyectados en tests, reales en producción.
    // Lazy require del cliente para que los mocks de jest.mock intercepten después
    // de que los jest.fn() estén asignados (mismo patrón que profileService.ts).
     
    const client = (deps?.supabase ??
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      (require('@/lib/supabase/client') as typeof import('@/lib/supabase/client')).supabase
    ) as any;
    const save_profile_fn = deps?.saveProfileFn ?? saveProfile;

    // Marcar inicio de guardado y provocar re-render inmediato (V1 fix).
    // force_update() aquí hace que los consumidores React reciban isSaving=true
    // antes de la primera suspensión asíncrona → el botón se deshabilita y muestra
    // "Guardando…". EC-12 sigue pasando porque lee la ref vía getter (no espera re-render).
    is_saving_ref.current = true;
    error_ref.current = null;
    force_update();

    const errors: string[] = [];

    // Operación A: profileService — foto a Storage + UPSERT user_preferences
    try {
      await save_profile_fn({ fullName, imageUri: effective_image_uri, userId: user_id });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }

    // Operación B: bio en tabla users — INDEPENDIENTE de A (siempre se intenta)
    const { error: bio_error } = await client.from('users').update({ bio }).eq('id', user_id);
    if (bio_error) {
      errors.push(bio_error.message as string);
    }

    is_saving_ref.current = false;
    error_ref.current = errors.length > 0 ? errors.join('; ') : null;
    // Re-render final: consumidores React ven isSaving=false + error actualizado
    force_update();

    // Devuelve el resultado directamente para que el caller (edit.tsx) reaccione
    // al valor REAL de este guardado, sin depender de la variable destructurada
    // del render anterior (que es un snapshot obsoleto cuando la closure se cerró).
    return { ok: errors.length === 0, error: error_ref.current };
   
  }, [user?.id, deps?.supabase, deps?.saveProfileFn]);

  // El objeto retornado usa getters para que isSaving y error sean siempre
  // el valor actual de la ref, incluso sin re-render previo.
  // ponytail: useMemo con [save] evita re-crear el objeto en cada render;
  // los getters siempre leen las refs en el momento de la lectura.
  return useMemo(() => {
    const result: UseEditProfileReturn = {
      save,
      get isSaving() { return is_saving_ref.current; },
      get error() { return error_ref.current; },
    };
    return result;
   
  }, [save]);
}
