/**
 * usePublish — integración del wizard de publicación con la Edge Function publish-property
 * (create mode) o con UPDATE directo a Supabase (edit mode).
 *
 * Contrato:
 *   usePublish(deps?) → { status, error, property_id, publish }
 *
 *   CREATE mode (default — sin editMode):
 *     - publish(): arma payload con get_property_payload(state), invoca
 *       supabase.functions.invoke('publish-property', { body: payload }),
 *       en éxito expone property_id y llama reset(); en error expone mensaje sin reset.
 *
 *   EDIT mode (editMode=true, propertyId requerido):
 *     - publish(): actualiza directamente con supabase.from('properties').update({...}).eq('id', propertyId).
 *       NO invoca la Edge Function. Sin video nuevo → no incluye campos de video.
 *       En éxito: status='success'. En error: status='error' con mensaje.
 *
 * NOTA DE IMPLEMENTACIÓN — refs puro, sin useState:
 *   Mismo patrón que useVideoUpload: estado solo en refs con getters.
 *   EC-9 exige que status='submitting' sea visible en sync act() (antes del primer await).
 *   Los getters sobre refs garantizan que result.current.sut.status siempre sea fresco.
 *
 *   ponytail: sin useState — el re-render en la UI lo dispara PublishFormContext
 *   (reset() en éxito actualiza su estado) o el estado local de la pantalla.
 */

import { useRef, useCallback, useMemo } from 'react';

import { usePublishForm } from '../store/PublishFormContext';
import { get_property_payload } from '../validation';

// ponytail: import lazy — el cliente real solo se carga si no se inyecta uno externo.
// Los tests siempre inyectan su propio mock.
 
function get_default_supabase(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export type PublishStatus = 'idle' | 'submitting' | 'success' | 'error';

export interface UsePublishDeps {
   
  supabase?: any;
  /** true cuando el wizard opera sobre una propiedad existente (modo edición) */
  editMode?: boolean;
  /** UUID de la propiedad a editar — requerido cuando editMode=true */
  propertyId?: string | null;
}

export interface UsePublishResult {
  status: PublishStatus;
  error: string | null;
  property_id: string | null;
  publish: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePublish(deps?: UsePublishDeps): UsePublishResult {
  const supabase_client = deps?.supabase ?? get_default_supabase();
  const { state, reset } = usePublishForm();

  // Extraer primitivos de deps para el closure del useCallback
  const edit_mode = deps?.editMode === true;
  const property_id_edit = deps?.propertyId ?? null;

  // Estado SOLO en refs — sin useState. Ver nota de implementación arriba.
  const status_ref = useRef<PublishStatus>('idle');
  const error_ref = useRef<string | null>(null);
  const property_id_ref = useRef<string | null>(null);

  const publish = useCallback(async (): Promise<void> => {
    // ── EDIT MODE — UPDATE directo con RLS, sin Edge Function ────────────────
    if (edit_mode && property_id_edit) {
      // Marcar 'submitting' ANTES del primer await — visible en sync act().
      status_ref.current = 'submitting';
      error_ref.current = null;
      property_id_ref.current = null;

      // Payload con campos editables de la tabla 'properties'.
      // NO incluye: owner_user_id (inmutable), video_id/storage_path (en property_videos).
      // La tabla NO tiene columnas lat/lng: la ubicación vive en `location`
      // geography(Point,4326). PostgREST acepta EWKT como input — mismo punto
      // que construye ST_Point(lng, lat) en el RPC de creación (x=lng, y=lat).
      const edit_payload = {
        operation_type: state.operation_type,
        property_type: state.property_type,
        price: state.price,
        bedrooms: state.bedrooms,
        bathrooms: state.bathrooms,
        square_meters: state.square_meters,
        address: state.address,
        ...(state.lat !== null && state.lng !== null
          ? { location: `SRID=4326;POINT(${state.lng} ${state.lat})` }
          : {}),
        pet_friendly: state.pet_friendly,
        allows_no_guarantor: state.allows_no_guarantor,
        student_friendly: state.student_friendly,
        description: state.description,
      };

      try {
        const { error: update_error } = (await supabase_client
          .from('properties')
          .update(edit_payload)
          .eq('id', property_id_edit)) as {
          data: unknown;
          error: { message?: string } | null;
        };

        if (update_error) {
          status_ref.current = 'error';
          error_ref.current =
            update_error.message ?? 'Error al actualizar la propiedad';
          return;
        }

        // Éxito — marcar success. No hay nuevo property_id (ya existe).
        status_ref.current = 'success';
      } catch (e) {
        status_ref.current = 'error';
        error_ref.current =
          e instanceof Error ? e.message : 'Error de red al actualizar';
      }
      return;
    }

    // ── CREATE MODE — flujo original (invoca Edge Function) ──────────────────

    // Armar el payload — síncrono; lanza si el state está incompleto.
    let body;
    try {
      body = get_property_payload(state);
    } catch (e) {
      status_ref.current = 'error';
      error_ref.current =
        e instanceof Error ? e.message : 'Error al armar el formulario';
      return;
    }

    // Marcar 'submitting' ANTES del primer await — visible en sync act() (EC-9).
    status_ref.current = 'submitting';
    error_ref.current = null;
    property_id_ref.current = null;

    try {
      const { data, error } = (await supabase_client.functions.invoke(
        'publish-property',
        { body },
      )) as { data: Record<string, unknown> | null; error: { message?: string } | null };

      if (error) {
        status_ref.current = 'error';
        error_ref.current =
          error.message ?? 'Error al publicar la propiedad';
        // NO reset — el usuario puede reintentar con los mismos datos.
        return;
      }

      const pid = data?.property_id;
      if (!pid) {
        // data=null o data sin property_id → tratamos como error (EC-5, EC-6).
        status_ref.current = 'error';
        error_ref.current = 'La propiedad no fue creada correctamente';
        // NO reset.
        return;
      }

      // Éxito — exponer property_id, limpiar form, marcar success.
      property_id_ref.current = pid as string;
      reset();
      status_ref.current = 'success';
    } catch (e) {
      // Excepción de red u otro rechazo inesperado (EC-7).
      status_ref.current = 'error';
      error_ref.current =
        e instanceof Error ? e.message : 'Error de red al publicar';
      // NO reset.
    }
     
  }, [supabase_client, state, reset, edit_mode, property_id_edit]);

  // Objeto con getters sobre refs — estable mientras publish no cambie.
  // result.current en RNTL v14 apunta a este objeto; los getters siempre
  // devuelven el valor más reciente de los refs.
  return useMemo(
    () => ({
      publish,
      get status(): PublishStatus {
        return status_ref.current;
      },
      get error(): string | null {
        return error_ref.current;
      },
      get property_id(): string | null {
        return property_id_ref.current;
      },
    }),
     
    [publish],
  );
}
