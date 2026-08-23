/**
 * ad_moderation_error_messages.ts — mapa código → mensaje en español para la EF
 * `moderate-ad` (tarea #208, subtarea 208.2).
 *
 * Mismo patrón que lead_error_messages.ts (75.6) y ContactAgentButton.tsx.
 * Colabora con extract_error_code (mobile/src/lib/supabase/edge-errors.ts).
 *
 * 🔴 POR QUÉ EXISTE ESTE ARCHIVO (#200). `FunctionsHttpError.message` es SIEMPRE
 * el literal en inglés 'Edge Function returned a non-2xx status code'
 * (@supabase/functions-js/src/types.ts:91) — idéntico para los 9 códigos que la
 * EF puede emitir. Mostrarlo es enseñarle al admin inglés genérico en los 9
 * casos, incluido el único que puede accionar. El código real viaja en el
 * CUERPO de la respuesta.
 *
 * Los 9 códigos salen de supabase/functions/moderate-ad/{handler,types}.ts.
 */

export const AD_MODERATION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: 'Datos incorrectos. Intenta de nuevo.',
  REJECTION_REASON_REQUIRED: 'Para rechazar un anuncio hay que escribir el motivo.',
  METHOD_NOT_ALLOWED: 'Error interno. Intenta de nuevo.',
  UNAUTHENTICATED: 'Debes iniciar sesión de nuevo para continuar.',
  FORBIDDEN: 'Solo un administrador puede moderar anuncios.',
  AD_NOT_FOUND: 'Este anuncio ya no existe o fue eliminado.',
  // El único de los 9 que el admin puede resolver por su cuenta, y por eso el
  // único que dice qué hacer: casi siempre significa que otro admin ya lo
  // moderó mientras esta pantalla tenía la lista vieja en memoria.
  INVALID_AD_STATUS_TRANSITION:
    'Este anuncio ya no está en revisión; es probable que alguien más lo haya moderado. Actualiza la lista.',
  ORGANIZATION_SUSPENDED:
    'No se puede aprobar: la organización que lo publica está suspendida.',
  DB_ERROR: 'Error interno. Intenta de nuevo.',
};

/**
 * `code === undefined` es lo que devuelve extract_error_code cuando el error NO
 * es un FunctionsHttpError con body {error:{code}} parseable — típicamente red o
 * timeout (invoke rechazado). Un código presente pero fuera del mapa (EF más
 * nueva que el build instalado) cae al fallback neutro: nunca se muestra el
 * código crudo.
 */
export function map_ad_moderation_error(code: string | undefined): string {
  if (code === undefined) {
    return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  }
  return AD_MODERATION_ERROR_MESSAGES[code] ?? 'Ocurrió un error. Intenta de nuevo.';
}
