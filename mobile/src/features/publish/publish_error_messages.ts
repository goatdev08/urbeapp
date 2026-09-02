/**
 * publish_error_messages.ts — mapa código → mensaje en español para las EFs
 * de publicación (publish-property, create mode; edit-property, edit mode).
 * Tarea Taskmaster 200 (fix de 100.6): el cliente nunca leía el error_code
 * tipado que ya devuelven ambas EFs — un agente veía el string crudo de
 * supabase-js ("Edge Function returned a non-2xx status code") en vez de la
 * razón real (p.ej. membresía suspendida).
 *
 * Mismo patrón que mobile/src/features/leads/lead_error_messages.ts
 * (map_lead_ef_error): un Record<código, mensaje> + función con dos
 * fallbacks distintos — código ausente (red/timeout/body no-JSON) vs código
 * presente pero fuera del catálogo (EF futura, versión desalineada). Nunca
 * se expone el código crudo ni el texto de infraestructura en pantalla.
 *
 * DOS mapas, NO uno compartido: publish-property (creación) y edit-property
 * (edición) emiten catálogos de error_code DISTINTOS (verificado en
 * supabase/functions/publish-property/types.ts y
 * supabase/functions/edit-property/{handler,index}.ts). Hasta la tarea #200,
 * edit-property NO emitía ningún código de agencia — AGENCY_CANNOT_PUBLISH_PROPERTIES
 * sigue siendo propio del RPC de creación. Pero desde #202 (suspensión =
 * congela la ACTUACIÓN) edit-property SÍ emite AGENCY_MEMBERSHIP_SUSPENDED: un
 * dueño con membresía de agencia no activa deja de poder editar sus propias
 * publicaciones (edit-property/handler.ts, paso 7), y update-property-status
 * (pause/unpause/close) reusa el MISMO mensaje del mapa de edit — no hay un
 * tercer mapa para esa EF; `usePropertyActions.ts` importa
 * `map_publish_edit_ef_error` directamente para el caso suspendido. El
 * literal es NEUTRO respecto de la acción ("gestionar", no "editar") a
 * propósito: el mismo mensaje se ve al editar, pausar o cerrar.
 *
 * Colabora con extract_error_code (mobile/src/lib/supabase/edge-errors.ts).
 */

// ── create mode — publish-property ──────────────────────────────────────

export const PUBLISH_CREATE_EF_ERROR_MESSAGES: Record<string, string> = {
  METHOD_NOT_ALLOWED: 'Error interno. Intenta de nuevo.',
  INVALID_INPUT: 'Datos incorrectos. Revisa el formulario e intenta de nuevo.',
  UNAUTHENTICATED: 'Debes iniciar sesión de nuevo para continuar.',
  FORBIDDEN: 'No tienes permiso para publicar esta propiedad.',
  VIDEO_NOT_FOUND: 'No encontramos el video seleccionado. Intenta de nuevo.',
  VIDEO_NOT_READY: 'El video todavía se está procesando. Espera un momento e intenta de nuevo.',
  VIDEO_DURATION_INVALID: 'La duración del video no es válida.',
  DUPLICATE_PROPERTY: 'Ya existe una propiedad publicada con esta dirección.',
  AGENCY_MEMBERSHIP_SUSPENDED: 'Tu membresía en la agencia está suspendida. Contacta al administrador.',
  AGENCY_CANNOT_PUBLISH_PROPERTIES: 'Tu agencia no tiene permiso para publicar propiedades.',
  DB_ERROR: 'Error interno. Intenta de nuevo.',
};

/** Sin código legible: ¿el servidor llegó a contestar o nunca hubo respuesta? */
export const MENSAJE_SIN_CONEXION = 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
export const MENSAJE_SERVIDOR = 'El servidor respondió con un error. Intenta de nuevo en un momento.';

/**
 * code === undefined es lo que devuelve extract_error_code cuando el error NO
 * es un FunctionsHttpError con body {error:{code}} parseable. Eso agrupa DOS
 * situaciones opuestas, y por eso hace falta `had_http_response`:
 *
 *   · had_http_response=false → nunca hubo respuesta (FunctionsFetchError,
 *     red caída, timeout). El usuario debe revisar su conexión.
 *   · had_http_response=true  → el servidor SÍ contestó, pero con un body que
 *     no es el JSON del contrato (típico: 502 con HTML del gateway). Decirle
 *     "verifica tu conexión" lo manda a revisar su WiFi por un problema que
 *     no es suyo y no puede arreglar — diagnóstico opuesto al real.
 *     🔴 Hallazgo del guardián de la tarea #200 (obs. 2).
 *
 * Un código presente pero fuera del mapa cae al genérico; el código crudo
 * nunca se filtra a la pantalla.
 */
export function map_publish_create_ef_error(
  code: string | undefined,
  had_http_response = false,
): string {
  if (code === undefined) {
    return had_http_response ? MENSAJE_SERVIDOR : MENSAJE_SIN_CONEXION;
  }
  return PUBLISH_CREATE_EF_ERROR_MESSAGES[code] ?? 'Ocurrió un error al publicar. Intenta de nuevo.';
}

// ── edit mode — edit-property ───────────────────────────────────────────

export const PUBLISH_EDIT_EF_ERROR_MESSAGES: Record<string, string> = {
  METHOD_NOT_ALLOWED: 'Error interno. Intenta de nuevo.',
  INVALID_INPUT: 'Datos incorrectos. Revisa el formulario e intenta de nuevo.',
  UNAUTHENTICATED: 'Debes iniciar sesión de nuevo para continuar.',
  PROPERTY_NOT_FOUND: 'Esta propiedad ya no existe o fue eliminada.',
  UNAUTHORIZED_EDITOR: 'No tienes permiso para editar esta propiedad.',
  AGENCY_MEMBERSHIP_SUSPENDED:
    'Tu inmobiliaria pausó tu cuenta: no puedes gestionar publicaciones a su nombre. Habla con el administrador de tu inmobiliaria.',
  DB_ERROR: 'Error interno. Intenta de nuevo.',
};

/** Mismo contrato que map_publish_create_ef_error — ver su docblock. */
export function map_publish_edit_ef_error(
  code: string | undefined,
  had_http_response = false,
): string {
  if (code === undefined) {
    return had_http_response ? MENSAJE_SERVIDOR : MENSAJE_SIN_CONEXION;
  }
  return PUBLISH_EDIT_EF_ERROR_MESSAGES[code] ?? 'Ocurrió un error al actualizar la propiedad. Intenta de nuevo.';
}
