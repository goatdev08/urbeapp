/**
 * useDraftAutosave — autoguardado de borrador del wizard de publicación
 * (subtarea Taskmaster 73.3, PRD §14.1).
 *
 *   useDraftAutosave(state: PublishFormState, deps?: UseDraftAutosaveDeps): void
 *
 * Si el usuario sale del wizard antes de completar el paso 5, el sistema
 * guarda automáticamente como status='draft', SIN pedir confirmación.
 *   - Debounce de DRAFT_AUTOSAVE_DEBOUNCE_MS de inactividad desde el último
 *     cambio de `state` — no escribe en cada cambio.
 *   - Solo escribe cuando existen los campos mínimos que la tabla `properties`
 *     exige NOT NULL (operation_type, property_type, price, address,
 *     location): sin ellos no hay fila válida que crear (no-op silencioso).
 *   - Primera escritura → INSERT (status='draft'); escrituras siguientes →
 *     UPDATE reusando el id del draft ya creado (no duplica filas).
 *   - NUNCA corre en edit_mode=true (editar una property existente no es un
 *     draft nuevo — eso es flujo de usePublish, 73.6).
 *   - edit_mode se lee de state.edit_mode (PublishFormState/contexto), JAMÁS
 *     de useLocalSearchParams (bug #53 del vault: el modo edición se perdía
 *     en la navegación entre pasos por viajar como URL param) — por eso este
 *     archivo NO importa nada de 'expo-router'.
 *   - Fail-soft: si la escritura falla (sin conexión), el hook no lanza.
 *   - Al desmontar (o al cambiar `state` antes de que dispare el timer), el
 *     cleanup del useEffect limpia el timer pendiente — no escribe tarde.
 *
 * ponytail: un solo useEffect con cleanup implementa el debounce — sin
 * dependencias externas (lodash.debounce, etc.).
 */
import { useEffect, useRef } from 'react';

import type { PublishFormState } from '../store/types';

export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 1500;

export interface UseDraftAutosaveDeps {
  supabase?: unknown;
}

// ponytail: import lazy — el cliente real solo se carga si no se inyecta uno
// externo (mismo patrón que usePublish.ts / useVideoUpload.ts).

function get_default_supabase(): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
}

/** Gate = NOT NULL quintet de la tabla properties (operation_type, property_type, price, address, location). */
function has_minimum_draft_fields(state: PublishFormState): boolean {
  return (
    state.operation_type !== null &&
    state.property_type !== null &&
    state.price !== null &&
    state.price > 0 &&
    state.address.trim() !== '' &&
    state.lat !== null &&
    state.lng !== null
  );
}

/** Payload de borrador — solo campos de `properties` disponibles en pasos 1-4 (sin video). */
function build_draft_payload(state: PublishFormState): Record<string, unknown> {
  return {
    status: 'draft',
    operation_type: state.operation_type,
    property_type: state.property_type,
    price: state.price,
    bedrooms: state.bedrooms,
    bathrooms: state.bathrooms,
    square_meters: state.square_meters,
    address: state.address,
    // La tabla no tiene columnas lat/lng: la ubicación vive en `location`
    // geography(Point,4326) — PostgREST acepta EWKT (mismo patrón que
    // usePublish.ts edit mode; x=lng, y=lat).
    location: `SRID=4326;POINT(${state.lng} ${state.lat})`,
    price_visible: state.price_visible,
    pet_friendly: state.pet_friendly,
    allows_no_guarantor: state.allows_no_guarantor,
    student_friendly: state.student_friendly,
    description: state.description,
  };
}

export function useDraftAutosave(
  state: PublishFormState,
  deps?: UseDraftAutosaveDeps,
): void {
  const supabase_client = deps?.supabase ?? get_default_supabase();
  // Id del draft ya creado — sobrevive entre renders para decidir INSERT vs UPDATE.
  const draft_id_ref = useRef<string | null>(null);

  useEffect(() => {
    if (state.edit_mode) return;
    if (!has_minimum_draft_fields(state)) return;

    const timer = setTimeout(() => {
      void (async () => {
        const payload = build_draft_payload(state);
        try {
          if (draft_id_ref.current === null) {
            const { data, error } = await supabase_client
              .from('properties')
              .insert(payload)
              .select('id')
              .single();
            const created_id = (data as { id?: string } | null)?.id;
            if (!error && created_id) {
              draft_id_ref.current = created_id;
            }
          } else {
            await supabase_client
              .from('properties')
              .update(payload)
              .eq('id', draft_id_ref.current);
          }
        } catch {
          // Fail-soft (§14.1): sin conexión el autoguardado no debe crashear el wizard.
        }
      })();
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);

    // Cleanup: cambios de `state` dentro de la ventana de debounce cancelan
    // este timer (React lo corre antes de re-ejecutar el efecto) — así
    // colapsan varias ediciones rápidas en una sola escritura con el último
    // valor. También limpia al desmontar.
    return () => clearTimeout(timer);
  }, [state, supabase_client]);
}
