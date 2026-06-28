/**
 * useLoadProperty — carga una propiedad existente por property_id y la mapea
 * al shape de PublishFormState para pre-llenar el wizard en modo edición.
 *
 * Contrato:
 *   useLoadProperty(property_id, deps?) → { formState, loading, error }
 *   - Si property_id es null, no hace query; devuelve loading=false, formState=null, error=null.
 *   - Invoca supabase.from('properties').select('...').eq('id', property_id).single()
 *     con embed de property_videos.
 *   - Mapea la fila DB → Partial<PublishFormState>.
 *   - not-found (PGRST116) → error=mensaje, formState=null.
 *   - Error genérico → error=mensaje, formState=null.
 *
 * ponytail: useState mínimo — loading inicial true solo si hay un ID que cargar,
 *   evita flash de "no loading" antes del primer render con datos.
 */

import { useState, useEffect } from 'react';

import type { PublishFormState } from '../store/types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface UseLoadPropertyResult {
  /** Partial del form state mapeado desde DB — null si error/no-encontrado */
  formState: Partial<PublishFormState> | null;
  loading: boolean;
  error: string | null;
}

export interface UseLoadPropertyDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

// ponytail: lazy-load del cliente real solo en prod; tests inyectan su propio mock.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function get_default_supabase(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useLoadProperty(
  property_id: string | null,
  deps?: UseLoadPropertyDeps,
): UseLoadPropertyResult {
  const supabase_client = deps?.supabase ?? get_default_supabase();

  // loading=true inicial solo si hay un ID (evita flash en mount con ID)
  const [form_state, set_form_state] = useState<Partial<PublishFormState> | null>(null);
  const [loading, set_loading] = useState<boolean>(property_id !== null);
  const [error, set_error] = useState<string | null>(null);

  useEffect(() => {
    if (property_id === null) {
      // Sin ID: estado limpio, sin query
      set_loading(false);
      set_form_state(null);
      set_error(null);
      return;
    }

    let cancelled = false;
    set_loading(true);

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    (async () => {
      const { data, error: db_error } = (await supabase_client
        .from('properties')
        .select(
          `id,
           operation_type,
           property_type,
           price,
           address,
           lat,
           lng,
           bedrooms,
           bathrooms,
           square_meters,
           description,
           pet_friendly,
           allows_no_guarantor,
           student_friendly,
           property_videos ( id, storage_path, position, status, thumbnail_url )`,
        )
        .eq('id', property_id)
        .single()) as {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: Record<string, any> | null;
        error: { message: string; code?: string } | null;
      };

      if (cancelled) return;

      if (db_error) {
        set_error(db_error.message);
        set_form_state(null);
        set_loading(false);
        return;
      }

      if (!data) {
        set_error('Propiedad no encontrada');
        set_form_state(null);
        set_loading(false);
        return;
      }

      // Mapeo DB → PublishFormState — incluye el primer video si existe
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const videos: any[] = Array.isArray(data.property_videos) ? data.property_videos : [];
      const first_video = videos[0] ?? null;

      const mapped: Partial<PublishFormState> = {
        operation_type: data.operation_type,
        property_type: data.property_type,
        price: data.price,
        address: data.address,
        lat: data.lat,
        lng: data.lng,
        bedrooms: data.bedrooms,
        bathrooms: data.bathrooms,
        square_meters: data.square_meters,
        description: data.description,
        pet_friendly: data.pet_friendly,
        allows_no_guarantor: data.allows_no_guarantor,
        student_friendly: data.student_friendly,
        ...(first_video
          ? { video_id: first_video.id, storage_path: first_video.storage_path }
          : {}),
      };

      set_form_state(mapped);
      set_error(null);
      set_loading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [property_id, supabase_client]);

  return { formState: form_state, loading, error };
}
