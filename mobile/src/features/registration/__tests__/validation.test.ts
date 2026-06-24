import {
  is_form_valid,
  validate_code_only,
  validate_invitation_code,
  validate_password,
  validate_register_form,
} from '../validation';

describe('validate_invitation_code', () => {
  it('rechaza código vacío', () => {
    expect(validate_invitation_code('')).toBeDefined();
    expect(validate_invitation_code('   ')).toBeDefined();
  });
  it('rechaza código menor a 6 caracteres', () => {
    expect(validate_invitation_code('ABC')).toBeDefined();
  });
  it('acepta código de 6+ caracteres', () => {
    expect(validate_invitation_code('ABCDEF')).toBeUndefined();
  });
});

describe('validate_password (registro: mín 8)', () => {
  it('rechaza menos de 8 caracteres', () => {
    expect(validate_password('secret1')).toBeDefined(); // 7
  });
  it('acepta 8+ caracteres', () => {
    expect(validate_password('secreto1')).toBeUndefined(); // 8
  });
});

describe('validate_code_only (fase 1)', () => {
  it('solo valida el código', () => {
    expect(is_form_valid(validate_code_only('ABCDEF'))).toBe(true);
    expect(is_form_valid(validate_code_only('ABC'))).toBe(false);
  });
});

describe('validate_register_form (fase 2)', () => {
  const valido = {
    invitationCode: 'ABCDEF',
    firstName: 'Juan',
    lastName: 'Pérez',
    email: 'agente@inmobiliaria.mx',
    password: 'secreto123',
  };

  it('acepta un formulario válido', () => {
    expect(is_form_valid(validate_register_form(valido))).toBe(true);
  });
  it('rechaza nombre vacío', () => {
    const e = validate_register_form({ ...valido, firstName: '  ' });
    expect(e.firstName).toBeDefined();
    expect(is_form_valid(e)).toBe(false);
  });
  it('rechaza apellido vacío', () => {
    expect(validate_register_form({ ...valido, lastName: '' }).lastName).toBeDefined();
  });
  it('rechaza email inválido', () => {
    expect(validate_register_form({ ...valido, email: 'no-es-email' }).email).toBeDefined();
  });
  it('rechaza password corta', () => {
    expect(validate_register_form({ ...valido, password: 'corta1' }).password).toBeDefined();
  });
});
