/**
 * useDraftAutosave — autoguardado de borrador del wizard de publicación
 * (subtarea 73.3, PRD §14.1 — reescrito en #127: la versión original nunca
 * guardó nada en producción).
 *
 *   useDraftAutosave(state: PublishFormState, deps?: UseDraftAutosaveDeps): void
 *
 * Si el usuario sale del wizard antes de completar el paso 5, el sistema
 * guarda automáticamente como status='draft', SIN pedir confirmación.
 *   - Debounce de DRAFT_AUTOSAVE_DEBOUNCE_MS de inactividad desde el último
 *     cambio de `state` — no escribe en cada cambio.
 *   - #127(1): el payload incluye owner_user_id de la sesión — la columna es
 *     NOT NULL y la RLS properties_insert exige owner_user_id = auth.uid();
 *     sin él TODO INSERT era rechazado (y el fail-soft se lo tragaba: la
 *     feature §14.1 nunca funcionó). Sin sesión → no hay fila válida, no-op.
 *   - Solo escribe cuando existen los campos mínimos NOT NULL de `properties`
 *     (operation_type, property_type, price, address, location).
 *   - Primera escritura → INSERT (status='draft'); siguientes → UPDATE
 *     reusando el id. #127(2): un flag in-flight evita que dos disparos
 *     solapados hagan DOS INSERT (dos borradores). #127(6): el id vive a
 *     nivel de MÓDULO — sobrevive al desmontaje del wizard (salir y volver a
 *     entrar reusa el mismo draft, no crea otro) y usePublish lo lee para
 *     descartar el borrador al publicar (#127(5)).
 *   - #127(3): el `error` de supabase-js (que NO lanza) se lee y loguea en
 *     AMBAS ramas — un fallo de RLS ya no es indistinguible del éxito.
 *   - #127(4): al DESMONTAR con cambios pendientes, dispara un guardado
 *     inmediato con el último estado — salir del wizard antes de 1.5 s de
 *     silencio es exactamente el caso de uso que el contrato documenta.
 *   - NUNCA corre en edit_mode=true (editar una property existente no es un
 *     draft — flujo de usePublish/EF 73.6). edit_mode se lee de state (#53).
 *   - Fail-soft: si la escritura falla, el hook no lanza (pero SÍ loguea y
 *     deja el estado 'dirty' para reintentarlo en el siguiente disparo).
 *
 * ponytail: draft id a nivel de módulo = una sola instancia de wizard por
 * app (cierto hoy: el wizard es un flujo único). Techo conocido: un cambio
 * de sesión sin reiniciar la app conservaría un id ajeno — el UPDATE fallaría
 * por RLS y quedaría logueado, no silencioso.
 */
import { useEffect, useRef } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { PublishFormState } from '../store/types';

export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 1500;

export interface UseDraftAutosaveDeps {
  supabase?: SupabaseClient;
  /** user_id de la sesión — inyectable para tests. Default: supabase.auth.getUser(). */
  get_user_id?: () => Promise<string | null>;
}

// ── Draft id a nivel de módulo (#127(5)/(6)) ─────────────────────────────────

let current_draft_id: string | null = null;

/** Id del borrador vivo de esta sesión de wizard, o null. Lo lee usePublish al publicar. */
export function get_current_draft_id(): string | null {
  return current_draft_id;
}

/** Olvida el borrador (NO toca la DB). Llamar tras publicarlo/descartarlo. */
export function clear_current_draft(): void {
  current_draft_id = null;
}

/** Fija el id del borrador — para tests (el hook lo asigna solo al insertar). */
export function set_current_draft_id(id: string | null): void {
  current_draft_id = id;
}

// ponytail: import lazy — el cliente real solo se carga si no se inyecta uno
// externo (mismo patrón que usePublish.ts / useVideoUpload.ts).
function get_default_supabase(): SupabaseClient {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('@/lib/supabase/client') as { supabase: SupabaseClient }).supabase;
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
function build_draft_payload(
  state: PublishFormState,
  owner_user_id: string,
): Record<string, unknown> {
  return {
    status: 'draft',
    // #127(1): NOT NULL + exigido por el WITH CHECK de properties_insert.
    owner_user_id,
    operation_type: state.operation_type,
    property_type: state.property_type,
    price: state.price,
    bedrooms: state.bedrooms,
    bathrooms: state.bathrooms,
    square_meters: state.square_meters,
    address: state.address,
    // La tabla no tiene columnas lat/lng: la ubicación vive en `location`
    // geography(Point,4326) — PostgREST acepta EWKT (x=lng, y=lat).
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
  const injected_get_user_id = deps?.get_user_id;

  // Último estado — leído por el guardado (debounced o de desmontaje) para
  // escribir siempre el valor más reciente sin re-armar efectos extra (#127(4)).
  const state_ref = useRef(state);

  // #127(2): guardado en curso — un disparo nuevo mientras hay uno volando se
  // salta (queda dirty y lo recoge el siguiente disparo o el flush de unmount).
  const in_flight_ref = useRef(false);
  // Cambios sin persistir (se arma con cada debounce; se limpia al guardar).
  const dirty_ref = useRef(false);

  // save estable vía ref — el efecto de desmontaje (deps []) lo necesita.
  // La asignación de ambas refs vive en un efecto sin deps (corre en cada
  // render, después de pintar) — escribir refs durante el render viola
  // react-hooks/refs.
  const save_ref = useRef<() => Promise<void>>(async () => {});
  const save_impl = async () => {
    if (in_flight_ref.current) return;
    const s = state_ref.current;
    if (s.edit_mode || !has_minimum_draft_fields(s)) return;

    in_flight_ref.current = true;
    dirty_ref.current = false;
    try {
      const get_user_id = injected_get_user_id ??
        (async () => {
          const { data } = await supabase_client.auth.getUser();
          return data.user?.id ?? null;
        });
      const user_id = await get_user_id();
      if (!user_id) {
        // Sin sesión no hay fila válida que crear (RLS la rechazaría igual).
        dirty_ref.current = true;
        return;
      }

      const payload = build_draft_payload(s, user_id);
      if (current_draft_id === null) {
        const { data, error } = await supabase_client
          .from('properties')
          .insert(payload)
          .select('id')
          .single();
        if (error) {
          // #127(3): el error de supabase-js NO lanza — leerlo o perderlo.
          console.warn('[useDraftAutosave] INSERT del borrador falló:', error.message);
          dirty_ref.current = true;
          return;
        }
        const created_id = (data as { id?: string } | null)?.id;
        if (created_id) {
          current_draft_id = created_id;
        }
      } else {
        const { error } = await supabase_client
          .from('properties')
          .update(payload)
          .eq('id', current_draft_id);
        if (error) {
          console.warn('[useDraftAutosave] UPDATE del borrador falló:', error.message);
          dirty_ref.current = true;
        }
      }
    } catch (err) {
      // Fail-soft (§14.1): sin conexión el autoguardado no debe crashear el wizard.
      console.warn('[useDraftAutosave] guardado del borrador falló:', err);
      dirty_ref.current = true;
    } finally {
      in_flight_ref.current = false;
    }
  };

  // Refs frescas en cada render (sin deps a propósito — ver comentario arriba).
  useEffect(() => {
    state_ref.current = state;
    save_ref.current = save_impl;
  });

  // Debounce: cada cambio de `state` re-arma la ventana (cleanup cancela el
  // timer previo) — varias ediciones rápidas colapsan en una escritura.
  useEffect(() => {
    if (state.edit_mode) return;
    if (!has_minimum_draft_fields(state)) return;

    dirty_ref.current = true;
    const timer = setTimeout(() => {
      void save_ref.current();
    }, DRAFT_AUTOSAVE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [state]);

  // #127(4): flush al desmontar — si quedaron cambios sin persistir (salió del
  // wizard dentro de la ventana de debounce), guardar YA con el último estado.
  useEffect(() => {
    return () => {
      if (dirty_ref.current) {
        void save_ref.current();
      }
    };
    // deps vacías a propósito: SOLO al desmontar. save_ref/dirty_ref son refs.
  }, []);
}
