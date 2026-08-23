/**
 * org_advertising_error_messages.ts — mapa código → mensaje en español para la
 * EF `set-org-advertising` (tarea #209, subtarea 209.3).
 *
 * Mismo patrón que ad_moderation_error_messages.ts (208.2): `FunctionsHttpError.
 * message` es SIEMPRE el literal en inglés 'Edge Function returned a non-2xx
 * status code' (@supabase/functions-js/src/types.ts:91), idéntico para los 7
 * códigos que la EF puede emitir. El código real viaja en el CUERPO de la
 * respuesta y lo saca `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts).
 *
 * Los 7 códigos salen de supabase/functions/set-org-advertising/handler.ts:
 * INVALID_INPUT (400) | METHOD_NOT_ALLOWED (405) | UNAUTHENTICATED (401) |
 * FORBIDDEN (403) | AGENCY_NOT_FOUND (404) | ADVERTISER_CATEGORY_REQUIRED (422) |
 * DB_ERROR (500).
 */

export const ORG_ADVERTISING_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: 'Datos incorrectos. Intenta de nuevo.',
  METHOD_NOT_ALLOWED: 'Error interno. Intenta de nuevo.',
  UNAUTHENTICATED: 'Debes iniciar sesión de nuevo para continuar.',
  FORBIDDEN: 'Solo un administrador puede cambiar el modo comercial.',
  AGENCY_NOT_FOUND: 'La organización no existe o fue eliminada.',
  // El único de los 7 que el admin puede resolver sin recargar nada: falta
  // elegir la categoría antes de encender el modo comercial.
  ADVERTISER_CATEGORY_REQUIRED:
    'Para activar el modo comercial hay que elegir una categoría de anunciante.',
  DB_ERROR: 'No pudimos actualizar el modo comercial. Intenta de nuevo.',
};

/**
 * `code === undefined` es lo que devuelve extract_error_code cuando el error NO
 * es un FunctionsHttpError con body {error:{code}} parseable — típicamente red o
 * timeout (invoke rechazado). Un código presente pero fuera del mapa (EF más
 * nueva que el build instalado) cae al fallback neutro: nunca se muestra el
 * código crudo.
 */
export function map_org_advertising_error(code: string | undefined): string {
  if (code === undefined) {
    return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  }
  return ORG_ADVERTISING_ERROR_MESSAGES[code] ?? 'Ocurrió un error. Intenta de nuevo.';
}
