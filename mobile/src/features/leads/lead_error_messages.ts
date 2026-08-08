/**
 * lead_error_messages.ts — mapa código → mensaje en español para las EFs de
 * lead (update-lead-status, update-lead-note). Subtarea 75.6 (§19.7/§19.9,
 * defecto #1 del usuario: ninguna pantalla debe mostrar error.message crudo).
 *
 * Mismo patrón que ContactAgentButton.tsx (EF_ERROR_MESSAGES/map_ef_error),
 * compartido aquí porque update-lead-status y update-lead-note emiten
 * EXACTAMENTE los mismos 5 códigos (ver sus handler.ts/types.ts) — un solo
 * mapa evita duplicarlo en cada hook.
 *
 * Colabora con extract_error_code (mobile/src/lib/supabase/edge-errors.ts),
 * que ya reusan auth/registration/upgrade/agency/publish.
 */

export const LEAD_EF_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT:      'Datos incorrectos. Intenta de nuevo.',
  UNAUTHENTICATED:    'Debes iniciar sesión de nuevo para continuar.',
  UNAUTHORIZED_AGENT: 'No tienes permiso para modificar este lead.',
  LEAD_NOT_FOUND:     'Este lead ya no existe o fue eliminado.',
  DB_ERROR:            'Error interno. Intenta de nuevo.',
};

/**
 * code === undefined es lo que devuelve extract_error_code cuando el error
 * NO es un FunctionsHttpError con body {error:{code}} parseable — típicamente
 * un error de red/timeout (invoke rechazado). Un código presente pero fuera
 * del mapa (EF futura, versión desalineada) cae al fallback neutro genérico.
 */
export function map_lead_ef_error(code: string | undefined): string {
  if (code === undefined) {
    return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  }
  return LEAD_EF_ERROR_MESSAGES[code] ?? 'Ocurrió un error. Intenta de nuevo.';
}
