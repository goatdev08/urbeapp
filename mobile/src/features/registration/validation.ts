/**
 * Validaciones del formulario de registro de agente — solo UX; el backend
 * (Edge Functions validate-invitation / redeem-invitation) es la fuente de verdad.
 *
 * Espejo de las reglas del backend (supabase/functions/_shared/validation.ts):
 *   - invitationCode: mín 6 caracteres
 *   - email: formato válido
 *   - password: mín 8 caracteres   (¡OJO! el registro exige 8, no 6 como el login)
 *   - firstName / lastName: requeridos, no vacíos
 *
 * Funciones puras y testeables; sin side-effects.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE_MIN_LENGTH = 6;
const PASSWORD_MIN_LENGTH = 8;

export interface FieldError {
  message: string;
}

export interface RegisterFormErrors {
  invitationCode?: FieldError;
  firstName?: FieldError;
  lastName?: FieldError;
  email?: FieldError;
  password?: FieldError;
}

export interface RegisterFormValues {
  invitationCode: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}

export function validate_invitation_code(code: string): FieldError | undefined {
  const trimmed = code.trim();
  if (trimmed.length === 0) {
    return { message: 'El código de invitación es requerido' };
  }
  if (trimmed.length < CODE_MIN_LENGTH) {
    return {
      message: `El código debe tener al menos ${CODE_MIN_LENGTH} caracteres`,
    };
  }
  return undefined;
}

export function validate_first_name(name: string): FieldError | undefined {
  if (name.trim().length === 0) {
    return { message: 'El nombre es requerido' };
  }
  return undefined;
}

export function validate_last_name(name: string): FieldError | undefined {
  if (name.trim().length === 0) {
    return { message: 'El apellido es requerido' };
  }
  return undefined;
}

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

/** Valida solo el código (fase 1: previa a mostrar la agencia). */
export function validate_code_only(code: string): RegisterFormErrors {
  const errors: RegisterFormErrors = {};
  const code_error = validate_invitation_code(code);
  if (code_error !== undefined) {
    errors.invitationCode = code_error;
  }
  return errors;
}

/** Valida el formulario completo (fase 2: antes de canjear). */
export function validate_register_form(
  values: RegisterFormValues,
): RegisterFormErrors {
  const errors: RegisterFormErrors = {};

  const code_error = validate_invitation_code(values.invitationCode);
  if (code_error !== undefined) errors.invitationCode = code_error;

  const first_error = validate_first_name(values.firstName);
  if (first_error !== undefined) errors.firstName = first_error;

  const last_error = validate_last_name(values.lastName);
  if (last_error !== undefined) errors.lastName = last_error;

  const email_error = validate_email(values.email);
  if (email_error !== undefined) errors.email = email_error;

  const password_error = validate_password(values.password);
  if (password_error !== undefined) errors.password = password_error;

  return errors;
}

export function is_form_valid(errors: RegisterFormErrors): boolean {
  return (
    errors.invitationCode === undefined &&
    errors.firstName === undefined &&
    errors.lastName === undefined &&
    errors.email === undefined &&
    errors.password === undefined
  );
}
