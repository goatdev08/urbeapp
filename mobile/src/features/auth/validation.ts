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

// Registro (§5.1). Las claves son las de INEGI sembradas en 72.1: el estado son 2
// dígitos con cero a la izquierda ('09') y el municipio es el cvegeo de 5 ('14039').
const STATE_ID_REGEX = /^\d{2}$/;
const MUNICIPALITY_ID_REGEX = /^\d{5}$/;
const MINIMUM_AGE = 18;
const FULL_NAME_MIN_LENGTH = 3;

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
// Tipos — Registro (§5.1 PRD: teléfono, correo, nombre completo, estado,
// ciudad/municipio y fecha de nacimiento son requeridos; único por correo y
// por teléfono; mayoría de edad calculada server-side con la fecha del
// servidor — estos validadores son solo UX, replican la regla del lado
// cliente para feedback inmediato).
// ---------------------------------------------------------------------------

export interface RegisterFormValues {
  full_name: string;
  email: string;
  password: string;
  phone: string;
  birthdate: string; // ISO 'YYYY-MM-DD'
  state_id: string; // clave INEGI de 2 dígitos, p.ej. '14'
  municipality_id: string; // clave INEGI (cvegeo) de 5 dígitos, p.ej. '14039'
}

export interface RegisterFormErrors {
  full_name?: FieldError;
  email?: FieldError;
  password?: FieldError;
  phone?: FieldError;
  birthdate?: FieldError;
  state_id?: FieldError;
  municipality_id?: FieldError;
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
// Validadores individuales — Registro (§5.1)
// ---------------------------------------------------------------------------

/**
 * Normaliza un teléfono capturado a mano: quita espacios, guiones y paréntesis.
 * NO quita el '+' — la lada sí distingue (+52 válida, +1 no).
 */
function normalize_phone(phone: string): string {
  return phone.replace(/[\s\-().]/g, '');
}

/**
 * Lleva un teléfono válido a E.164 (`+52##########`) — el ÚNICO formato que se
 * debe persistir.
 *
 * Por qué importa: `users_phone_unique_active` es un índice único sobre el texto
 * crudo. Si se guarda tal como se teclea, '3312345678', '+523312345678' y
 * '33 1234 5678' son tres valores distintos para Postgres y la misma persona
 * podría registrar tres cuentas — la unicidad de §5.1 quedaría en nada.
 *
 * Devuelve la entrada normalizada sin más si no es un teléfono MX válido; quien
 * llama debe haber pasado antes por `validate_phone`.
 */
export function to_e164_mx(phone: string): string {
  const normalized = normalize_phone(phone);
  if (/^\d{10}$/.test(normalized)) {
    return `+52${normalized}`;
  }
  return normalized;
}

export function validate_phone(phone: string): FieldError | undefined {
  const normalized = normalize_phone(phone);
  if (normalized.length === 0) {
    return { message: 'El teléfono es requerido' };
  }
  // Solo MX: 10 dígitos nacionales, o E.164 +52 + esos mismos 10.
  // ponytail: regex propia en vez de libphonenumber (~250 KB de bundle) — la demo
  // es solo México y el backend no depende de esto (es UX; el único garante real
  // de unicidad es el índice users_phone_unique_active). Techo conocido: no valida
  // que la lada nacional exista, ni soporta números de otros países.
  if (!/^(\+52)?\d{10}$/.test(normalized)) {
    return { message: 'Ingresa un teléfono de 10 dígitos (México)' };
  }
  return undefined;
}

export function validate_birthdate(birthdate: string): FieldError | undefined {
  const trimmed = birthdate.trim();
  if (trimmed.length === 0) {
    return { message: 'La fecha de nacimiento es requerida' };
  }

  // Se exige ISO 'YYYY-MM-DD' y se re-serializa para comparar: `new Date('2023-13-45')`
  // NO lanza en todos los motores, y en los que aceptan el desbordamiento devuelven
  // una fecha desplazada silenciosamente. El round-trip caza ambos casos.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (match === null) {
    return { message: 'Ingresa una fecha válida (AAAA-MM-DD)' };
  }
  const [, year, month, day] = match.map(Number) as unknown as [string, number, number, number];
  // UTC a propósito: `new Date('1990-01-01')` se interpreta como UTC mientras que
  // `new Date(1990, 0, 1)` usa la zona local. Mezclarlos corre la fecha un día en
  // husos negativos como el de México y rompe justo el boundary de los 18 años.
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return { message: 'Ingresa una fecha válida (AAAA-MM-DD)' };
  }

  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  if (parsed.getTime() > today.getTime()) {
    return { message: 'La fecha de nacimiento no puede ser futura' };
  }

  // Mayoría de edad por comparación de fechas, no por división de milisegundos:
  // los años bisiestos hacen que `ms / 365.25` falle en el borde exacto.
  const eighteenth = new Date(
    Date.UTC(parsed.getUTCFullYear() + MINIMUM_AGE, parsed.getUTCMonth(), parsed.getUTCDate())
  );
  if (eighteenth.getTime() > today.getTime()) {
    return { message: `Debes tener al menos ${MINIMUM_AGE} años para registrarte` };
  }

  return undefined;
}

export function validate_state(state_id: string): FieldError | undefined {
  const trimmed = state_id.trim();
  if (trimmed.length === 0) {
    return { message: 'El estado es requerido' };
  }
  if (!STATE_ID_REGEX.test(trimmed)) {
    return { message: 'Selecciona un estado de la lista' };
  }
  return undefined;
}

export function validate_municipality(
  municipality_id: string,
  state_id: string
): FieldError | undefined {
  const trimmed = municipality_id.trim();
  if (trimmed.length === 0) {
    return { message: 'El municipio es requerido' };
  }
  if (!MUNICIPALITY_ID_REGEX.test(trimmed)) {
    return { message: 'Selecciona un municipio de la lista' };
  }
  // Sin estado todavía no hay nada contra qué contrastar: ese hueco lo reporta
  // validate_state, y duplicar el error aquí marcaría dos campos en rojo por una
  // sola omisión.
  const state_trimmed = state_id.trim();
  if (state_trimmed.length === 0) {
    return undefined;
  }
  // Los 2 primeros dígitos del cvegeo INEGI SON la clave del estado — misma
  // verificación que el CHECK users_municipio_del_estado en la DB.
  if (trimmed.slice(0, 2) !== state_trimmed) {
    return { message: 'El municipio no pertenece al estado seleccionado' };
  }
  return undefined;
}

export function validate_full_name(full_name: string): FieldError | undefined {
  const trimmed = full_name.trim();
  if (trimmed.length === 0) {
    return { message: 'El nombre completo es requerido' };
  }
  if (trimmed.length < FULL_NAME_MIN_LENGTH) {
    return { message: `El nombre debe tener al menos ${FULL_NAME_MIN_LENGTH} caracteres` };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Validador del formulario completo
// ---------------------------------------------------------------------------

export function validate_register_form(values: RegisterFormValues): RegisterFormErrors {
  const errors: RegisterFormErrors = {};

  const checks: [keyof RegisterFormErrors, FieldError | undefined][] = [
    ['full_name', validate_full_name(values.full_name)],
    ['email', validate_email(values.email)],
    ['password', validate_password(values.password)],
    ['phone', validate_phone(values.phone)],
    ['birthdate', validate_birthdate(values.birthdate)],
    ['state_id', validate_state(values.state_id)],
    ['municipality_id', validate_municipality(values.municipality_id, values.state_id)],
  ];

  for (const [field, error] of checks) {
    if (error !== undefined) {
      errors[field] = error;
    }
  }

  return errors;
}

export function is_register_form_valid(errors: RegisterFormErrors): boolean {
  return Object.keys(errors).length === 0;
}

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

// ---------------------------------------------------------------------------
// Recuperación de contraseña (§5.3, subtarea 72.5) — nueva contraseña +
// confirmación. Reusa validate_password (mismas reglas que registro/login);
// solo se agrega el chequeo de que la confirmación coincida.
// ---------------------------------------------------------------------------

export interface ResetPasswordFormValues {
  password: string;
  confirm: string;
}

export interface ResetPasswordFormErrors {
  password?: FieldError;
  confirm?: FieldError;
}

export function validate_password_confirmation(
  password: string,
  confirm: string
): FieldError | undefined {
  if (confirm.length === 0) {
    return { message: 'Confirma tu nueva contraseña' };
  }
  if (confirm !== password) {
    return { message: 'Las contraseñas no coinciden' };
  }
  return undefined;
}

export function validate_reset_password_form(
  values: ResetPasswordFormValues
): ResetPasswordFormErrors {
  const errors: ResetPasswordFormErrors = {};

  const password_error = validate_password(values.password);
  if (password_error !== undefined) {
    errors.password = password_error;
  }

  const confirm_error = validate_password_confirmation(values.password, values.confirm);
  if (confirm_error !== undefined) {
    errors.confirm = confirm_error;
  }

  return errors;
}

export function is_reset_password_form_valid(errors: ResetPasswordFormErrors): boolean {
  return errors.password === undefined && errors.confirm === undefined;
}
