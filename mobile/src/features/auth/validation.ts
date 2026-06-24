/**
 * Validaciones de formulario de login — solo UX, el backend es la fuente de verdad.
 * Ver lineamientos-desarrollo.md §5.11
 *
 * Funciones puras y testeables; sin side-effects.
 */

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 6;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export interface FieldError {
  message: string;
}

export interface LoginFormErrors {
  email?: FieldError;
  password?: FieldError;
}

export interface LoginFormValues {
  email: string;
  password: string;
}

// ---------------------------------------------------------------------------
// Validadores individuales
// ---------------------------------------------------------------------------

export function validate_email(email: string): FieldError | undefined {
  const trimmed = email.trim();
  if (trimmed.length === 0) {
    return { message: 'El correo electrónico es requerido' };
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    return { message: 'Ingresa un correo electrónico válido' };
  }
  return undefined;
}

export function validate_password(password: string): FieldError | undefined {
  if (password.length === 0) {
    return { message: 'La contraseña es requerida' };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return {
      message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres`,
    };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Validador del formulario completo
// ---------------------------------------------------------------------------

export function validate_login_form(values: LoginFormValues): LoginFormErrors {
  const errors: LoginFormErrors = {};

  const email_error = validate_email(values.email);
  if (email_error !== undefined) {
    errors.email = email_error;
  }

  const password_error = validate_password(values.password);
  if (password_error !== undefined) {
    errors.password = password_error;
  }

  return errors;
}

export function is_form_valid(errors: LoginFormErrors): boolean {
  return errors.email === undefined && errors.password === undefined;
}
