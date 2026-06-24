/**
 * registration-errors.ts — mapeo de los error_code de las Edge Functions
 * (validate-invitation / redeem-invitation) a mensajes en español para el usuario.
 *
 * Reglas:
 * - Nunca expone detalle crudo del backend.
 * - Nunca devuelve string vacío.
 * - Nunca lanza.
 */

const MESSAGES: Record<string, string> = {
  // Validación del token (validate-invitation / redeem-invitation)
  TOKEN_NOT_FOUND: 'El código de invitación no existe. Verifícalo e intenta de nuevo.',
  TOKEN_REVOKED: 'Este código de invitación fue revocado por la inmobiliaria.',
  TOKEN_EXPIRED: 'El código de invitación ha expirado.',
  TOKEN_MAX_USES_REACHED: 'El código de invitación ya no está disponible.',
  AGENCY_INACTIVE: 'La inmobiliaria asociada a este código no está activa.',
  // Creación de cuenta (redeem-invitation)
  EMAIL_ALREADY_EXISTS: 'Ya existe una cuenta con este correo. Inicia sesión.',
  ALREADY_ACTIVE_MEMBER: 'Esta cuenta ya pertenece a una inmobiliaria.',
  // Entrada inválida
  INVALID_INPUT: 'Revisa los datos del formulario e intenta de nuevo.',
};

const MSG_NETWORK = 'Sin conexión. Verifica tu red e intenta de nuevo.';
const MSG_FALLBACK = 'Ocurrió un error inesperado. Inténtalo de nuevo.';

/** Mensaje legible (ES) a partir de un error_code del backend. */
export function map_registration_error_code(code: string | undefined): string {
  if (code === undefined || code.length === 0) return MSG_FALLBACK;
  return MESSAGES[code] ?? MSG_FALLBACK;
}

/** Mensaje para errores de red / desconocidos (sin code del backend). */
export function map_network_error(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.includes('Network')) {
      return MSG_NETWORK;
    }
  }
  return MSG_FALLBACK;
}
