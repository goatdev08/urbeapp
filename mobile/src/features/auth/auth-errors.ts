/**
 * auth-errors.ts — mapeo de errores de Supabase Auth a mensajes en español.
 *
 * Reglas:
 * - Anti-enumeración: 'invalid_credentials' devuelve un mensaje ambiguo que
 *   no revela si falló el correo o la contraseña.
 * - Nunca expone internals crudos al usuario.
 * - Nunca devuelve string vacío.
 * - Nunca lanza.
 */

// ---------------------------------------------------------------------------
// Tipos auxiliares (no importamos AuthError de supabase para no acoplar)
// ---------------------------------------------------------------------------

/** Forma mínima que tienen los AuthError de Supabase v2 */
export interface SupabaseAuthErrorShape {
  message: string;
  code?: string | undefined;
  status?: number | undefined;
}

// ---------------------------------------------------------------------------
// Constantes de mensajes en español
// ---------------------------------------------------------------------------

const MSG_INVALID_CREDENTIALS = 'Correo o contraseña incorrectos.';
const MSG_EMAIL_NOT_CONFIRMED =
  'Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.';
const MSG_RATE_LIMIT =
  'Demasiados intentos. Espera un momento antes de intentarlo de nuevo.';
const MSG_NETWORK = 'Sin conexión. Verifica tu red e intenta de nuevo.';
const MSG_FALLBACK = 'Ocurrió un error inesperado. Inténtalo de nuevo.';
// #72.2 — teléfono duplicado. Es el desenlace más probable de la unicidad recién
// estrenada (§5.1) y llega como un 500 crudo de Postgres, no como un code de GoTrue,
// así que sin este caso el usuario veía el fallback genérico y no sabía qué corregir.
// Exportado: register_user (§5.1, 93.3) reusa el mismo mensaje cuando la EF
// `register` responde PHONE_TAKEN — no hay por qué duplicar el string.
export const MSG_PHONE_TAKEN =
  'Ese teléfono ya está registrado en otra cuenta. Usa uno distinto o inicia sesión.';

// ---------------------------------------------------------------------------
// Helpers de narrowing — acceso seguro a propiedades de un objeto desconocido
// ---------------------------------------------------------------------------

function get_string_prop(obj: object, key: string): string | undefined {
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : undefined;
}

function get_number_prop(obj: object, key: string): number | undefined {
  const value = (obj as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : undefined;
}

// ---------------------------------------------------------------------------
// Función pública
// ---------------------------------------------------------------------------

/**
 * Traduce un error desconocido proveniente de supabase.auth.signInWithPassword
 * a un mensaje en español apto para mostrar al usuario.
 *
 * Nunca lanza; siempre devuelve un string no vacío.
 */
export function map_auth_error(error: unknown): string {
  if (error === null || error === undefined) return MSG_FALLBACK;
  if (typeof error !== 'object') return MSG_FALLBACK;

  const code = get_string_prop(error, 'code');
  const message = get_string_prop(error, 'message') ?? '';
  const status = get_number_prop(error, 'status');

  // Teléfono duplicado (#72.2). GoTrue no lo traduce: el fallo del índice
  // users_phone_unique_active sube como error de base de datos, así que se detecta
  // por el nombre del índice en el message. Va ANTES del fallback por eso.
  // ⚠️ El message crudo de Postgres incluye el teléfono en conflicto — se busca la
  // firma pero NUNCA se devuelve el message al usuario (permitiría enumerar qué
  // teléfonos ya están registrados).
  if (message.includes('users_phone_unique_active')) return MSG_PHONE_TAKEN;

  // Credenciales inválidas — por code explícito
  if (code === 'invalid_credentials') return MSG_INVALID_CREDENTIALS;

  // Email sin confirmar
  if (code === 'email_not_confirmed') return MSG_EMAIL_NOT_CONFIRMED;

  // Rate limiting — por code explícito
  if (code === 'over_request_rate_limit') return MSG_RATE_LIMIT;

  // Rate limiting — por status HTTP 429 (sin code)
  if (status === 429) return MSG_RATE_LIMIT;

  // Credenciales inválidas — por message cuando no viene code (versiones antiguas)
  if (message.includes('Invalid login credentials')) return MSG_INVALID_CREDENTIALS;

  // Error de red — AuthRetryableFetchError o Error JS genérico
  if (message === 'Network request failed') return MSG_NETWORK;

  // Fallback — no expone el message crudo al usuario
  return MSG_FALLBACK;
}
