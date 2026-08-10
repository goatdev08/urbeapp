/**
 * usePublish — integración del wizard de publicación con la Edge Function publish-property
 * (create mode) o con la Edge Function edit-property (edit mode, 73.6).
 *
 * Contrato:
 *   usePublish(deps?) → { status, error, property_id, editResultMode, revisionId, publish }
 *
 *   CREATE mode (default — sin editMode):
 *     - publish(): arma payload con get_property_payload(state), invoca
 *       supabase.functions.invoke('publish-property', { body: payload }),
 *       en éxito expone property_id y llama reset(); en error expone mensaje sin reset.
 *
 *   EDIT mode (editMode=true, propertyId requerido) — 73.6, PRD §15.5/§15.6:
 *     - publish(): invoca supabase.functions.invoke('edit-property',
 *       { body: {...edit_payload, property_id} }). YA NO usa
 *       from('properties').update() (contrato pre-73.6) — la EF decide server-side
 *       si el cambio se aplica directo o dispara una re-revisión. Sin video nuevo →
 *       no incluye campos de video.
 *       En éxito: status='success', editResultMode = 'direct' | 'revision' según
 *       la respuesta de la EF; revisionId poblado solo en modo 'revision'.
 *       En error: status='error' con mensaje, editResultMode=null.
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
import { clear_current_draft, get_current_draft_id } from './useDraftAutosave';

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

/** Resultado de la EF edit-property (73.6, PRD §15.5/§15.6) — null fuera de edit mode. */
export type EditResultMode = 'direct' | 'revision' | null;

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
  /** Solo poblado en edit mode tras un invoke exitoso a edit-property. */
  editResultMode: EditResultMode;
  /** id de la property_revision creada — solo cuando editResultMode='revision'. */
  revisionId: string | null;
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
  const edit_result_mode_ref = useRef<EditResultMode>(null);
  const revision_id_ref = useRef<string | null>(null);

  const publish = useCallback(async (): Promise<void> => {
    // ── EDIT MODE — invoca la EF edit-property (73.6, PRD §15.5/§15.6) ───────
    if (edit_mode && property_id_edit) {
      // Marcar 'submitting' ANTES del primer await — visible en sync act().
      status_ref.current = 'submitting';
      error_ref.current = null;
      property_id_ref.current = null;
      edit_result_mode_ref.current = null;
      revision_id_ref.current = null;

      // Payload con campos editables de la tabla 'properties'.
      // NO incluye: owner_user_id (inmutable), video_id/storage_path (en property_videos).
      // La tabla NO tiene columnas lat/lng: la ubicación vive en `location`
      // geography(Point,4326). La EF acepta EWKT como input — mismo punto
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
        price_visible: state.price_visible,
        pet_friendly: state.pet_friendly,
        allows_no_guarantor: state.allows_no_guarantor,
        student_friendly: state.student_friendly,
        description: state.description,
      };

      try {
        const { data, error: invoke_error } = (await supabase_client.functions.invoke(
          'edit-property',
          { body: { ...edit_payload, property_id: property_id_edit } },
        )) as {
          data: { ok?: boolean; mode?: 'direct' | 'revision'; revision_id?: string } | null;
          error: { message?: string } | null;
        };

        if (invoke_error) {
          status_ref.current = 'error';
          error_ref.current =
            invoke_error.message ?? 'Error al actualizar la propiedad';
          return;
        }

        // Éxito — la EF decidió 'direct' (aplicado ya) o 'revision' (pendiente
        // de aprobación admin, la propiedad publicada actual no cambió).
        edit_result_mode_ref.current = data?.mode ?? null;
        revision_id_ref.current = data?.revision_id ?? null;
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

      // #127(5): descartar el borrador del autosave — publicar creó una fila
      // NUEVA vía la RPC; sin esto el draft quedaba huérfano para siempre (y
      // de paso bloqueaba la propia dirección vía el checker de duplicados,
      // ver #135). Soft-delete fail-soft: si falla solo se loguea.
      const draft_id = get_current_draft_id();
      if (draft_id) {
        clear_current_draft();
        try {
          const { error: discard_error } = await supabase_client
            .from('properties')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', draft_id);
          if (discard_error) {
            console.warn('[usePublish] no se pudo descartar el borrador:', discard_error.message);
          }
        } catch (discard_err) {
          console.warn('[usePublish] no se pudo descartar el borrador:', discard_err);
        }
      }

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
      get editResultMode(): EditResultMode {
        return edit_result_mode_ref.current;
      },
      get revisionId(): string | null {
        return revision_id_ref.current;
      },
    }),
     
    [publish],
  );
}
