/**
 * Tests de validación de formulario de login/registro — funciones puras.
 * Subtarea 2.3 — validate_email, validate_password, validate_login_form, is_form_valid
 * Subtarea 72.2 — validate_phone, validate_birthdate, validate_state, validate_municipality,
 *   validate_full_name, validate_register_form (§5.1 PRD: campos de registro requeridos).
 */

import {
  validate_email,
  validate_password,
  validate_login_form,
  is_form_valid,
  validate_phone,
  validate_birthdate,
  validate_state,
  validate_municipality,
  validate_full_name,
  validate_register_form,
  to_e164_mx,
  validate_password_confirmation,
  validate_reset_password_form,
  is_reset_password_form_valid,
} from '../validation';

// ---------------------------------------------------------------------------
// Helpers de fecha — SIEMPRE relativos a "hoy" (nunca literales que caduquen)
// ---------------------------------------------------------------------------

/** Formatea un Date como 'YYYY-MM-DD' (mismo formato que espera validate_birthdate). */
function to_iso_date(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Fecha de nacimiento de alguien que cumple exactamente `years` años el día de hoy. */
function birthdate_years_ago(years: number): string {
  const today = new Date();
  return to_iso_date(new Date(today.getFullYear() - years, today.getMonth(), today.getDate()));
}

/** Un día antes de cumplir `years` años (todavía no los cumple). */
function birthdate_one_day_before_turning(years: number): string {
  const today = new Date();
  const turns_today = new Date(today.getFullYear() - years, today.getMonth(), today.getDate());
  turns_today.setDate(turns_today.getDate() + 1); // el día que cumple `years` años
  return to_iso_date(turns_today);
}

function tomorrow_iso(): string {
  const today = new Date();
  return to_iso_date(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
}

// ---------------------------------------------------------------------------
// validate_email
// ---------------------------------------------------------------------------

describe('validate_email', () => {
  it('devuelve undefined para un email válido', () => {
    expect(validate_email('usuario@ejemplo.com')).toBeUndefined();
    expect(validate_email('agente@urbea.mx')).toBeUndefined();
    expect(validate_email('test+tag@sub.dominio.io')).toBeUndefined();
  });

  it('devuelve error cuando el email está vacío', () => {
    expect(validate_email('')).toEqual({ message: expect.stringContaining('requerido') });
  });

  it('devuelve error cuando el email tiene solo espacios', () => {
    expect(validate_email('   ')).toEqual({ message: expect.stringContaining('requerido') });
  });

  it('devuelve error cuando el formato es inválido (sin @)', () => {
    expect(validate_email('sinArroba.com')).toEqual({
      message: expect.stringContaining('válido'),
    });
  });

  it('devuelve error cuando el formato es inválido (sin dominio)', () => {
    expect(validate_email('usuario@')).toEqual({
      message: expect.stringContaining('válido'),
    });
  });

  it('devuelve error cuando el formato es inválido (sin TLD)', () => {
    expect(validate_email('usuario@dominio')).toEqual({
      message: expect.stringContaining('válido'),
    });
  });
});

// ---------------------------------------------------------------------------
// validate_password
// ---------------------------------------------------------------------------

describe('validate_password', () => {
  it('devuelve undefined para una contraseña válida (6+ caracteres)', () => {
    expect(validate_password('123456')).toBeUndefined();
    expect(validate_password('Secreto$1')).toBeUndefined();
    expect(validate_password('        ')).toBeUndefined(); // 8 espacios — no validamos contenido, solo longitud
  });

  it('devuelve error cuando la contraseña está vacía', () => {
    expect(validate_password('')).toEqual({ message: expect.stringContaining('requerida') });
  });

  it('devuelve error cuando la contraseña tiene menos de 6 caracteres', () => {
    expect(validate_password('12345')).toEqual({ message: expect.stringContaining('6') });
    expect(validate_password('a')).toEqual({ message: expect.stringContaining('6') });
  });

  it('acepta exactamente 6 caracteres', () => {
    expect(validate_password('123456')).toBeUndefined();
  });

  // Review pre-merge #93: contraseñas NUEVAS exigen 8 (paridad con la EF
  // `register`, que rechaza <8 con 400). El login se queda en 6 (cuentas
  // viejas pueden tener contraseñas más cortas).
  it('con min_length 8 rechaza 7 caracteres y acepta 8', () => {
    expect(validate_password('1234567', 8)).toEqual({
      message: expect.stringContaining('8'),
    });
    expect(validate_password('12345678', 8)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validate_login_form
// ---------------------------------------------------------------------------

describe('validate_login_form', () => {
  it('devuelve objeto vacío cuando ambos campos son válidos', () => {
    const result = validate_login_form({ email: 'test@test.com', password: 'password1' });
    expect(result).toEqual({});
  });

  it('incluye error de email cuando el email es inválido', () => {
    const result = validate_login_form({ email: 'no-es-email', password: 'password1' });
    expect(result.email).toBeDefined();
    expect(result.password).toBeUndefined();
  });

  it('incluye error de password cuando la contraseña es muy corta', () => {
    const result = validate_login_form({ email: 'test@test.com', password: '123' });
    expect(result.email).toBeUndefined();
    expect(result.password).toBeDefined();
  });

  it('incluye ambos errores cuando ambos campos son inválidos', () => {
    const result = validate_login_form({ email: '', password: '' });
    expect(result.email).toBeDefined();
    expect(result.password).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// is_form_valid
// ---------------------------------------------------------------------------

describe('is_form_valid', () => {
  it('devuelve true cuando no hay errores', () => {
    expect(is_form_valid({})).toBe(true);
  });

  it('devuelve false cuando hay error de email', () => {
    expect(is_form_valid({ email: { message: 'error' } })).toBe(false);
  });

  it('devuelve false cuando hay error de password', () => {
    expect(is_form_valid({ password: { message: 'error' } })).toBe(false);
  });

  it('devuelve false cuando hay ambos errores', () => {
    expect(
      is_form_valid({ email: { message: 'e1' }, password: { message: 'e2' } })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validate_phone (§5.1: teléfono requerido, único por cuenta)
// ---------------------------------------------------------------------------

describe('validate_phone', () => {
  it('devuelve undefined para 10 dígitos nacionales MX', () => {
    expect(validate_phone('3312345678')).toBeUndefined();
  });

  it('devuelve undefined para formato E.164 +52##########', () => {
    expect(validate_phone('+523312345678')).toBeUndefined();
  });

  it('normaliza espacios, guiones y paréntesis antes de validar', () => {
    expect(validate_phone('33 1234 5678')).toBeUndefined();
    expect(validate_phone('33-1234-5678')).toBeUndefined();
    expect(validate_phone('(33) 1234-5678')).toBeUndefined();
    expect(validate_phone('+52 33 1234 5678')).toBeUndefined();
  });

  it('devuelve error cuando el teléfono está vacío', () => {
    expect(validate_phone('')).toEqual({ message: expect.stringContaining('requerido') });
  });

  it('devuelve error cuando el teléfono está vacío tras normalizar (solo espacios)', () => {
    expect(validate_phone('   ')).toEqual({ message: expect.stringContaining('requerido') });
  });

  it('devuelve error cuando tiene menos de 10 dígitos', () => {
    expect(validate_phone('331234567')).toEqual({ message: expect.any(String) });
  });

  it('devuelve error cuando contiene letras', () => {
    expect(validate_phone('331234abcd')).toEqual({ message: expect.any(String) });
  });

  it('devuelve error cuando la lada internacional no es +52', () => {
    expect(validate_phone('+11234567890')).toEqual({ message: expect.any(String) });
    expect(validate_phone('+34600123456')).toEqual({ message: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// validate_birthdate (§5.1: fecha de nacimiento requerida; mayoría de edad
// calculada con la fecha del servidor/dispositivo, NO literales fijos)
// ---------------------------------------------------------------------------

describe('validate_birthdate', () => {
  it('devuelve undefined para alguien que cumple exactamente 18 años hoy (boundary)', () => {
    expect(validate_birthdate(birthdate_years_ago(18))).toBeUndefined();
  });

  it('devuelve undefined para un adulto claramente mayor de edad (30 años)', () => {
    expect(validate_birthdate(birthdate_years_ago(30))).toBeUndefined();
  });

  it('devuelve error un día antes de cumplir 18 años (17 años y 364/365 días, boundary)', () => {
    expect(validate_birthdate(birthdate_one_day_before_turning(18))).toEqual({
      message: expect.stringContaining('18'),
    });
  });

  it('devuelve error para un menor claramente (10 años)', () => {
    expect(validate_birthdate(birthdate_years_ago(10))).toEqual({ message: expect.any(String) });
  });

  it('devuelve error cuando la fecha es futura', () => {
    expect(validate_birthdate(tomorrow_iso())).toEqual({ message: expect.any(String) });
  });

  it('devuelve error cuando la fecha es inválida (no parseable)', () => {
    expect(validate_birthdate('no-es-una-fecha')).toEqual({ message: expect.any(String) });
    expect(validate_birthdate('2023-13-45')).toEqual({ message: expect.any(String) });
  });

  it('devuelve error cuando la fecha de nacimiento está vacía', () => {
    expect(validate_birthdate('')).toEqual({ message: expect.stringContaining('requerida') });
  });
});

// ---------------------------------------------------------------------------
// validate_state (§5.1: estado requerido — catálogo INEGI, ver 72.1)
// ---------------------------------------------------------------------------

describe('validate_state', () => {
  it('devuelve undefined para una clave de estado válida (Jalisco = 14)', () => {
    expect(validate_state('14')).toBeUndefined();
  });

  it('devuelve error cuando el estado está vacío', () => {
    expect(validate_state('')).toEqual({ message: expect.stringContaining('requerido') });
  });

  it('devuelve error cuando la clave no tiene el formato INEGI (2 dígitos)', () => {
    expect(validate_state('JAL')).toEqual({ message: expect.any(String) });
    expect(validate_state('140')).toEqual({ message: expect.any(String) });
  });
});

// ---------------------------------------------------------------------------
// validate_municipality (§5.1: ciudad/municipio requerido, debe pertenecer
// al estado seleccionado — left(municipality_id, 2) === state_id)
// ---------------------------------------------------------------------------

describe('validate_municipality', () => {
  it('devuelve undefined cuando el municipio pertenece al estado (Guadalajara/Jalisco)', () => {
    expect(validate_municipality('14039', '14')).toBeUndefined();
  });

  it('devuelve error cuando el municipio está vacío', () => {
    expect(validate_municipality('', '14')).toEqual({
      message: expect.stringContaining('requerido'),
    });
  });

  it('devuelve error cuando la clave no tiene el formato INEGI (5 dígitos)', () => {
    expect(validate_municipality('140391', '14')).toEqual({ message: expect.any(String) });
    expect(validate_municipality('ab123', '14')).toEqual({ message: expect.any(String) });
  });

  it('devuelve error cuando el municipio NO pertenece al estado seleccionado (Monterrey/Jalisco)', () => {
    expect(validate_municipality('19039', '14')).toEqual({
      message: expect.stringContaining('estado'),
    });
  });

  it('no exige coherencia si aún no hay estado seleccionado (responsabilidad de validate_state)', () => {
    expect(validate_municipality('14039', '')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validate_full_name (§5.1: nombre completo requerido)
// ---------------------------------------------------------------------------

describe('validate_full_name', () => {
  it('devuelve undefined para un nombre completo válido', () => {
    expect(validate_full_name('Ana Pérez')).toBeUndefined();
  });

  it('devuelve error cuando el nombre está vacío', () => {
    expect(validate_full_name('')).toEqual({ message: expect.stringContaining('requerido') });
  });

  it('devuelve error cuando el nombre es solo espacios', () => {
    expect(validate_full_name('     ')).toEqual({ message: expect.stringContaining('requerido') });
  });

  it('devuelve error cuando el nombre es más corto que el mínimo razonable', () => {
    expect(validate_full_name('Al')).toEqual({ message: expect.any(String) });
  });

  // RED mini (93.3, hallazgo del guardián): la EF `register` exige last_name
  // no vacío (supabase/functions/_shared/validation.ts) y el submit ahora manda
  // `last_name` incondicional — un nombre de una sola palabra pasaba el gate
  // local (≥3 chars) y tronaba en el servidor con un 400 INVALID_INPUT genérico.
  // La validación local debe exigir nombre Y apellido ANTES de llamar la EF.
  it('devuelve error cuando el nombre es una sola palabra (falta apellido)', () => {
    expect(validate_full_name('Ana')).toEqual({ message: 'Escribe tu nombre y apellido' });
  });

  it('devuelve undefined cuando trae nombre y apellido', () => {
    expect(validate_full_name('Ana Torres')).toBeUndefined();
  });

  it('devuelve error cuando el nombre es una sola palabra con espacio de sobra', () => {
    expect(validate_full_name('Ana ')).toEqual({ message: 'Escribe tu nombre y apellido' });
  });

  it('devuelve undefined para un nombre compuesto de varias palabras', () => {
    expect(validate_full_name('María de la Luz Pérez')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validate_register_form (compone todos los validadores de §5.1)
// ---------------------------------------------------------------------------

describe('validate_register_form', () => {
  const valid_values = {
    full_name: 'Ana Pérez',
    email: 'ana@test.com',
    password: 'password1',
    phone: '3312345678',
    birthdate: birthdate_years_ago(25),
    state_id: '14',
    municipality_id: '14039',
  };

  it('devuelve objeto vacío cuando todos los campos son válidos', () => {
    expect(validate_register_form(valid_values)).toEqual({});
  });

  it('incluye un error por cada campo cuando todos están vacíos', () => {
    const result = validate_register_form({
      full_name: '',
      email: '',
      password: '',
      phone: '',
      birthdate: '',
      state_id: '',
      municipality_id: '',
    });
    expect(result.full_name).toBeDefined();
    expect(result.email).toBeDefined();
    expect(result.password).toBeDefined();
    expect(result.phone).toBeDefined();
    expect(result.birthdate).toBeDefined();
    expect(result.state_id).toBeDefined();
    expect(result.municipality_id).toBeDefined();
  });

  it('incluye error de phone cuando el resto del formulario es válido', () => {
    const result = validate_register_form({ ...valid_values, phone: '123' });
    expect(result.phone).toBeDefined();
    expect(result.email).toBeUndefined();
    expect(result.full_name).toBeUndefined();
  });

  // Review pre-merge #93: la EF `register` exige 8; el gate local debe
  // atrapar 6-7 caracteres ANTES de llamarla (si no, el usuario ve el
  // banner genérico de INVALID_INPUT sin campo marcado).
  it('rechaza contraseña de 7 caracteres (mínimo 8 para contraseñas nuevas)', () => {
    const result = validate_register_form({ ...valid_values, password: '1234567' });
    expect(result.password).toEqual({ message: expect.stringContaining('8') });
  });

  it('acepta contraseña de exactamente 8 caracteres', () => {
    const result = validate_register_form({ ...valid_values, password: '12345678' });
    expect(result.password).toBeUndefined();
  });

  it('incluye error de birthdate cuando el usuario es menor de edad, resto válido', () => {
    const result = validate_register_form({
      ...valid_values,
      birthdate: birthdate_one_day_before_turning(18),
    });
    expect(result.birthdate).toBeDefined();
    expect(result.phone).toBeUndefined();
  });

  it('incluye error de municipality cuando no pertenece al estado, resto válido', () => {
    const result = validate_register_form({ ...valid_values, municipality_id: '19039' });
    expect(result.municipality_id).toBeDefined();
    expect(result.state_id).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// to_e164_mx (§5.1: el teléfono es único por cuenta — la unicidad la garantiza
// el índice users_phone_unique_active, que compara TEXTO CRUDO. Si cada quien
// guarda su propio formato, la misma persona puede abrir varias cuentas.)
// ---------------------------------------------------------------------------

describe('to_e164_mx', () => {
  it('antepone +52 a un número nacional de 10 dígitos', () => {
    expect(to_e164_mx('3312345678')).toBe('+523312345678');
  });

  it('deja intacto un número que ya viene en E.164', () => {
    expect(to_e164_mx('+523312345678')).toBe('+523312345678');
  });

  it('colapsa a la MISMA cadena las variantes de formato del mismo número', () => {
    const canonical = '+523312345678';
    expect(to_e164_mx('3312345678')).toBe(canonical);
    expect(to_e164_mx('33 1234 5678')).toBe(canonical);
    expect(to_e164_mx('33-1234-5678')).toBe(canonical);
    expect(to_e164_mx('(33) 1234-5678')).toBe(canonical);
    expect(to_e164_mx('+52 33 1234 5678')).toBe(canonical);
  });

  it('es idempotente: normalizar dos veces da lo mismo', () => {
    expect(to_e164_mx(to_e164_mx('33 1234 5678'))).toBe('+523312345678');
  });
});

// ---------------------------------------------------------------------------
// validate_password_confirmation / validate_reset_password_form (§5.3, 72.5)
// ---------------------------------------------------------------------------

describe('validate_password_confirmation', () => {
  it('devuelve undefined cuando la confirmación coincide con la contraseña', () => {
    expect(validate_password_confirmation('secreto123', 'secreto123')).toBeUndefined();
  });

  it('reporta error cuando la confirmación está vacía', () => {
    expect(validate_password_confirmation('secreto123', '')).toEqual({
      message: 'Confirma tu nueva contraseña',
    });
  });

  it('reporta error cuando la confirmación no coincide', () => {
    expect(validate_password_confirmation('secreto123', 'otraCosa')).toEqual({
      message: 'Las contraseñas no coinciden',
    });
  });

  it('es sensible a mayúsculas/minúsculas', () => {
    expect(validate_password_confirmation('Secreto123', 'secreto123')).toEqual({
      message: 'Las contraseñas no coinciden',
    });
  });
});

describe('validate_reset_password_form', () => {
  it('no reporta errores con contraseña válida y confirmación igual', () => {
    const errors = validate_reset_password_form({ password: 'nuevaClave1', confirm: 'nuevaClave1' });
    expect(errors).toEqual({});
  });

  it('reporta el error de validate_password cuando la contraseña es muy corta', () => {
    // Review pre-merge #93: reset fija una contraseña NUEVA → mínimo 8,
    // igual que el registro (paridad con la EF `register`).
    const errors = validate_reset_password_form({ password: '123', confirm: '123' });
    expect(errors.password?.message).toBe('La contraseña debe tener al menos 8 caracteres');
    expect(errors.confirm).toBeUndefined();
  });

  it('reporta el error de confirmación cuando no coincide, aun con contraseña válida', () => {
    const errors = validate_reset_password_form({ password: 'nuevaClave1', confirm: 'otraClave1' });
    expect(errors.password).toBeUndefined();
    expect(errors.confirm?.message).toBe('Las contraseñas no coinciden');
  });

  it('reporta AMBOS errores cuando la contraseña es inválida y no coincide', () => {
    const errors = validate_reset_password_form({ password: '', confirm: 'algo' });
    expect(errors.password?.message).toBe('La contraseña es requerida');
    expect(errors.confirm?.message).toBe('Las contraseñas no coinciden');
  });
});

describe('is_reset_password_form_valid', () => {
  it('es true cuando no hay errores', () => {
    expect(is_reset_password_form_valid({})).toBe(true);
  });

  it('es false si falta password', () => {
    expect(
      is_reset_password_form_valid({ password: { message: 'x' } })
    ).toBe(false);
  });

  it('es false si falta confirm', () => {
    expect(
      is_reset_password_form_valid({ confirm: { message: 'x' } })
    ).toBe(false);
  });
});
