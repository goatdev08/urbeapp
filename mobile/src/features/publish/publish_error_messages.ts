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
 * supabase/functions/edit-property/{handler,index}.ts) — edit-property NO
 * emite los códigos de agencia (AGENCY_MEMBERSHIP_SUSPENDED,
 * AGENCY_CANNOT_PUBLISH_PROPERTIES), esos son propios del RPC de creación.
 * Meterlos también en el mapa de edit sería una defensa contra un código que
 * esa EF nunca produce.
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

/**
 * code === undefined es lo que devuelve extract_error_code cuando el error
 * NO es un FunctionsHttpError con body {error:{code}} parseable — red/timeout
 * o un body no-JSON (context.json() rechazó). Un código presente pero fuera
 * del mapa cae al fallback neutro genérico; nunca se filtra el código crudo.
 */
export function map_publish_create_ef_error(code: string | undefined): string {
  if (code === undefined) {
    return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
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
  DB_ERROR: 'Error interno. Intenta de nuevo.',
};

export function map_publish_edit_ef_error(code: string | undefined): string {
  if (code === undefined) {
    return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  }
  return PUBLISH_EDIT_EF_ERROR_MESSAGES[code] ?? 'Ocurrió un error al actualizar la propiedad. Intenta de nuevo.';
}
