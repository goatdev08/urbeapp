/**
 * validation.ts — reglas de validación del onboarding (puras, testeables sin UI).
 *
 * Subtarea 6.6.
 */

/**
 * Valida el nombre completo del agente.
 *
 * Reglas:
 *   - No puede estar vacío ni ser solo espacios.
 *   - Debe tener al menos 2 caracteres tras el trim.
 *
 * @returns true si el nombre es válido; false en caso contrario.
 */
export function is_valid_full_name(name: string): boolean {
  return name.trim().length >= 2;
}

/**
 * Mensaje de ayuda inline que se muestra cuando el nombre no es válido.
 * Solo se muestra si el usuario ha tocado el campo (dirty).
 */
export const FULL_NAME_ERROR_MSG =
  'Ingresa tu nombre completo (mínimo 2 caracteres).';
