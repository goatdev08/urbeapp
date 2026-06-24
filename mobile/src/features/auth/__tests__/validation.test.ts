/**
 * Tests de validación de formulario de login — funciones puras.
 * Subtarea 2.3 — validate_email, validate_password, validate_login_form, is_form_valid
 */

import {
  validate_email,
  validate_password,
  validate_login_form,
  is_form_valid,
} from '../validation';

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
