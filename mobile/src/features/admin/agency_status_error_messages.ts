/**
 * agency_status_error_messages.ts — mapa código → mensaje en español para la
 * EF `suspend-agency` (tarea #211, subtarea 211.2).
 *
 * Mismo patrón que org_advertising_error_messages.ts (209.3) /
 * ad_moderation_error_messages.ts (208.2): `FunctionsHttpError.message` es
 * SIEMPRE el literal en inglés 'Edge Function returned a non-2xx status code'
 * (@supabase/functions-js/src/types.ts:91), idéntico para los 7 códigos que la
 * EF puede emitir. El código real viaja en el CUERPO de la respuesta y lo saca
 * `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts).
 *
 * Los 7 códigos salen de supabase/functions/suspend-agency/handler.ts:
 * INVALID_INPUT (400) | METHOD_NOT_ALLOWED (405) | UNAUTHENTICATED (401) |
 * FORBIDDEN (403) | AGENCY_NOT_FOUND (404) | INVALID_STATUS_TRANSITION (409) |
 * DB_ERROR (500).
 *
 * INVALID_STATUS_TRANSITION es el único de los 7 que el admin puede resolver
 * sin ayuda de soporte: la pantalla quedó desactualizada (otro admin ya
 * cambió el estado, o la organización aún no fue aprobada) — el mensaje lo
 * dice explícitamente en vez de caer al genérico de DB_ERROR.
 */

export const AGENCY_STATUS_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: 'Datos incorrectos. Intenta de nuevo.',
  METHOD_NOT_ALLOWED: 'Error interno. Intenta de nuevo.',
  UNAUTHENTICATED: 'Debes iniciar sesión de nuevo para continuar.',
  FORBIDDEN: 'Solo un administrador puede suspender o reactivar organizaciones.',
  AGENCY_NOT_FOUND: 'La organización no existe o fue eliminada.',
  INVALID_STATUS_TRANSITION:
    'La organización no está en un estado que permita esta acción. Actualiza la pantalla e intenta de nuevo.',
  DB_ERROR: 'No pudimos completar la operación. Intenta de nuevo.',
};

/**
 * `code === undefined` es lo que devuelve extract_error_code cuando el error NO
 * es un FunctionsHttpError con body {error:{code}} parseable — típicamente red o
 * timeout (invoke rechazado). Un código presente pero fuera del mapa (EF más
 * nueva que el build instalado) cae al fallback neutro: nunca se muestra el
 * código crudo.
 */
export function map_agency_status_error(code: string | undefined): string {
  if (code === undefined) {
    return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  }
  return AGENCY_STATUS_ERROR_MESSAGES[code] ?? 'Ocurrió un error. Intenta de nuevo.';
}
