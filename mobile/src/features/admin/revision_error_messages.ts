/**
 * revision_error_messages.ts — mapa código → mensaje en español para la EF
 * `moderate-property` (tarea #218, subtarea 218.1, acciones approve|needs_changes|reject
 * sobre la cola de revisiones de ediciones).
 *
 * Mismo patrón que org_advertising_error_messages.ts (209.3) /
 * agency_status_error_messages.ts (211.2): `FunctionsHttpError.message` es SIEMPRE
 * el literal en inglés 'Edge Function returned a non-2xx status code'
 * (@supabase/functions-js/src/types.ts:91), idéntico para los 7 códigos que la EF
 * puede emitir. El código real viaja en el CUERPO de la respuesta y lo saca
 * `extract_error_code` (mobile/src/lib/supabase/edge-errors.ts).
 *
 * Los 7 códigos salen de supabase/functions/moderate-property/handler.ts:
 * INVALID_INPUT (400) | UNAUTHENTICATED (401) | FORBIDDEN (403) |
 * PROPERTY_NOT_FOUND (404) | INVALID_TRANSITION (400) | NOTHING_TO_MODERATE (400) |
 * DB_ERROR (500).
 *
 * FASE RED (218.1): stub — declara los códigos válidos pero `map_revision_error`
 * lanza `not_implemented`. El texto real en español (GREEN) lo fija quien
 * implemente; el test (useModerateProperty.test.tsx) NO pinea literales exactos —
 * exige distinguibilidad y ausencia del literal crudo de supabase-js, mismo criterio
 * que useSetOrgAdvertising/useSuspendAgency.
 */

export const REVISION_ERROR_CODES = [
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PROPERTY_NOT_FOUND',
  'INVALID_TRANSITION',
  'NOTHING_TO_MODERATE',
  'DB_ERROR',
] as const;

export type RevisionErrorCode = (typeof REVISION_ERROR_CODES)[number];

const REVISION_ERROR_MESSAGES: Record<string, string> = {
  INVALID_INPUT: 'Datos incorrectos. Intenta de nuevo.',
  UNAUTHENTICATED: 'Debes iniciar sesión de nuevo para continuar.',
  FORBIDDEN: 'Solo un administrador puede moderar propiedades.',
  PROPERTY_NOT_FOUND: 'La propiedad no existe o fue eliminada.',
  INVALID_TRANSITION: 'Esta propiedad no puede moderarse en su estado actual.',
  NOTHING_TO_MODERATE: 'No hay ninguna revisión ni publicación pendiente que moderar.',
  DB_ERROR: 'No pudimos guardar la moderación. Intenta de nuevo.',
};

/**
 * `code === undefined` es lo que devuelve extract_error_code cuando el error NO
 * es un FunctionsHttpError con body {error:{code}} parseable — típicamente red o
 * timeout (invoke rechazado). Un código presente pero fuera del mapa (EF más
 * nueva que el build instalado) debe caer a un fallback neutro, nunca mostrar el
 * código crudo.
 */
export function map_revision_error(code: string | undefined): string {
  if (code === undefined) {
    return 'No se pudo conectar. Verifica tu conexión e intenta de nuevo.';
  }
  return REVISION_ERROR_MESSAGES[code] ?? 'Ocurrió un error. Intenta de nuevo.';
}
