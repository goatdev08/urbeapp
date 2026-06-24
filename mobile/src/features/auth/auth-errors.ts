/**
 * auth-errors.ts — mapeo de errores de Supabase Auth a mensajes en español.
 *
 * STUB MÍNIMO — subtarea 2.4 fase RED.
 * La implementación real va en la fase GREEN.
 * Este stub devuelve string vacío siempre para que los tests fallen por aserción.
 */

// ---------------------------------------------------------------------------
// Tipos auxiliares (no importamos AuthError de supabase para no acoplar el stub)
// ---------------------------------------------------------------------------

/** Forma mínima que tienen los AuthError de Supabase v2 */
export interface SupabaseAuthErrorShape {
  message: string;
  code?: string | undefined;
  status?: number | undefined;
}

// ---------------------------------------------------------------------------
// Función pura de mapeo — STUB: devuelve '' para que los tests fallen
// ---------------------------------------------------------------------------

/**
 * Traduce un error desconocido proveniente de supabase.auth.signInWithPassword
 * a un mensaje en español apto para mostrar al usuario.
 *
 * Nunca lanza; siempre devuelve un string.
 */
export function map_auth_error(_error: unknown): string {
  // STUB: devuelve string vacío — todos los tests fallarán por aserción
  return '';
}
