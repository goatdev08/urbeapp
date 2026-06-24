import {
  map_network_error,
  map_registration_error_code,
} from '../registration-errors';

describe('map_registration_error_code', () => {
  it('mapea códigos conocidos a mensajes ES no vacíos', () => {
    for (
      const code of [
        'TOKEN_NOT_FOUND',
        'TOKEN_REVOKED',
        'TOKEN_EXPIRED',
        'TOKEN_MAX_USES_REACHED',
        'AGENCY_INACTIVE',
        'EMAIL_ALREADY_EXISTS',
        'ALREADY_ACTIVE_MEMBER',
        'INVALID_INPUT',
      ]
    ) {
      const msg = map_registration_error_code(code);
      expect(typeof msg).toBe('string');
      expect(msg.length).toBeGreaterThan(0);
    }
  });

  it('códigos distintos producen mensajes distintos (no todo es fallback)', () => {
    expect(map_registration_error_code('TOKEN_NOT_FOUND')).not.toEqual(
      map_registration_error_code('EMAIL_ALREADY_EXISTS'),
    );
  });

  it('código desconocido / undefined → fallback no vacío', () => {
    expect(map_registration_error_code(undefined).length).toBeGreaterThan(0);
    expect(map_registration_error_code('NOPE').length).toBeGreaterThan(0);
  });

  it('no filtra detalle crudo del backend', () => {
    expect(map_registration_error_code('TOKEN_NOT_FOUND')).not.toContain('TOKEN_NOT_FOUND');
  });
});

describe('map_network_error', () => {
  it('detecta errores de red', () => {
    expect(map_network_error({ message: 'Network request failed' })).toContain('conexión');
  });
  it('fallback para otros', () => {
    expect(map_network_error(null).length).toBeGreaterThan(0);
    expect(map_network_error({ message: 'boom' }).length).toBeGreaterThan(0);
  });
});
