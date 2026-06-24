/**
 * Tests fase RED — map_auth_error (mobile/src/features/auth/auth-errors.ts)
 * Subtarea 2.4 — Pieza A: función pura de mapeo de errores Supabase → español.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Mapeos conocidos (happy path)
 * - EC-A1: code='invalid_credentials' → mensaje seguro sin revelar qué campo falló
 * - EC-A2: message contiene 'Invalid login credentials' (sin code explícito) → mismo mensaje seguro
 * - EC-A3: code='email_not_confirmed' → pide confirmar correo
 * - EC-A4: code='over_request_rate_limit' → demasiados intentos
 * - EC-A5: status=429 (sin code) → mismo mensaje de rate limit
 *
 * ### Error de red
 * - EC-A6: objeto con message='Network request failed', sin code (AuthRetryableFetchError shape)
 * - EC-A7: Error JS genérico con message='Network request failed'
 * - EC-A8: Error genérico sin code, sin message conocido → fallback (no expone mensaje crudo)
 *
 * ### Boundary / fallback
 * - EC-A9: error con code y message irreconocibles → fallback genérico (no expone internals)
 * - EC-A10: null como error → fallback genérico (no lanza)
 * - EC-A11: undefined como error → fallback genérico (no lanza)
 * - EC-A12: el mensaje devuelto NUNCA es string vacío en ningún caso anterior
 */

import { map_auth_error } from '../auth-errors';

// ---------------------------------------------------------------------------
// Factories — construyen objetos que imitan AuthError de Supabase v2
// Firma posicional para compatibilidad con exactOptionalPropertyTypes: true.
// ---------------------------------------------------------------------------

interface FakeAuthError {
  message: string;
  code?: string;
  status?: number;
}

/**
 * Crea un objeto que imita la forma de AuthError de Supabase v2.
 * Usa parámetros posicionales para ser compatible con exactOptionalPropertyTypes.
 */
function make_auth_error(message: string, code?: string, status?: number): FakeAuthError {
  const err: FakeAuthError = { message };
  if (code !== undefined) err.code = code;
  if (status !== undefined) err.status = status;
  return err;
}

// ---------------------------------------------------------------------------
// EC-A1: Credenciales inválidas por code='invalid_credentials'
// ---------------------------------------------------------------------------

describe('EC-A1: credenciales_invalidas_por_code', () => {
  it("code='invalid_credentials' → mensaje en español sin revelar qué campo falló", () => {
    const error = make_auth_error('Invalid login credentials', 'invalid_credentials', 400);

    const result = map_auth_error(error);

    // El mensaje debe mencionar correo/contraseña de forma ambigua (seguro)
    expect(result).toMatch(/correo|contraseña|incorrectos/i);
    // No debe revelar si fue el email o la contraseña específicamente
    expect(result).not.toMatch(/^correo incorrecto$/i);
    expect(result).not.toMatch(/^contraseña incorrecta$/i);
    // No debe ser el mensaje técnico crudo de Supabase
    expect(result).not.toBe('Invalid login credentials');
  });
});

// ---------------------------------------------------------------------------
// EC-A2: Credenciales inválidas detectadas por message (sin code explícito)
// ---------------------------------------------------------------------------

describe('EC-A2: credenciales_invalidas_por_message', () => {
  it("message contiene 'Invalid login credentials' sin code → mismo mensaje seguro", () => {
    const error = make_auth_error('Invalid login credentials');

    const result = map_auth_error(error);

    expect(result).toMatch(/correo|contraseña|incorrectos/i);
    expect(result).not.toBe('Invalid login credentials');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A3: Email no confirmado
// ---------------------------------------------------------------------------

describe('EC-A3: email_no_confirmado', () => {
  it("code='email_not_confirmed' → mensaje pidiendo confirmar el correo", () => {
    const error = make_auth_error('Email not confirmed', 'email_not_confirmed', 400);

    const result = map_auth_error(error);

    // Debe mencionar confirmación del correo
    expect(result).toMatch(/confirm[a-z]*|verific[a-z]*/i);
    expect(result).not.toBe('Email not confirmed');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A4: Rate limit por code
// ---------------------------------------------------------------------------

describe('EC-A4: rate_limit_por_code', () => {
  it("code='over_request_rate_limit' → mensaje de demasiados intentos (no fallback)", () => {
    // Sin status 429: aísla el branch de `code` (si tuviera 429, el branch de status
    // lo rescataría y enmascararía un mutante que neutralice el branch de `code`).
    const error = make_auth_error('Request rate limit reached', 'over_request_rate_limit');

    const result = map_auth_error(error);

    // Debe contener el mensaje exacto de rate-limit, NO el mensaje de fallback.
    // Si se neutraliza el branch de rate-limit en el SUT (cae a fallback), este test falla.
    expect(result).toMatch(/demasiados intentos|espera un momento/i);
    expect(result).not.toMatch(/inesperado/i);
    expect(result).not.toBe('Request rate limit reached');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A5: Rate limit por status 429 (sin code)
// ---------------------------------------------------------------------------

describe('EC-A5: rate_limit_por_status_429', () => {
  it('status=429 sin code → mismo mensaje de demasiados intentos (no fallback)', () => {
    const error = make_auth_error('Too many requests', undefined, 429);

    const result = map_auth_error(error);

    // Debe contener el mensaje exacto de rate-limit, NO el mensaje de fallback.
    // Si se neutraliza el branch status===429 en el SUT (cae a fallback), este test falla.
    expect(result).toMatch(/demasiados intentos|espera un momento/i);
    expect(result).not.toMatch(/inesperado/i);
    expect(result).not.toBe('Too many requests');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A6: Error de red — forma AuthRetryableFetchError (duck-typing)
// ---------------------------------------------------------------------------

describe('EC-A6: error_de_red_auth_retryable_fetch_error', () => {
  it("objeto con message='Network request failed' sin code → mensaje de conexión", () => {
    const error = make_auth_error('Network request failed');

    const result = map_auth_error(error);

    expect(result).toMatch(/conexión|red|internet|conectar/i);
    expect(result).not.toBe('Network request failed');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A7: Error JS genérico con message de red
// ---------------------------------------------------------------------------

describe('EC-A7: error_js_generico_network_request_failed', () => {
  it("Error JS con message='Network request failed' → mensaje de conexión", () => {
    const error = new Error('Network request failed');

    const result = map_auth_error(error);

    expect(result).toMatch(/conexión|red|internet|conectar/i);
    expect(result).not.toBe('Network request failed');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A8: Error genérico sin code, sin message conocido → NO expone mensaje crudo
// ---------------------------------------------------------------------------

describe('EC-A8: error_generico_sin_code_sin_message_conocido', () => {
  it('error con message técnico desconocido → NO expone el message crudo al usuario', () => {
    const technical_message = 'PGRST116: no rows returned';
    const error = make_auth_error(technical_message);

    const result = map_auth_error(error);

    // No debe filtrar el mensaje técnico crudo
    expect(result).not.toBe(technical_message);
    expect(result).not.toContain('PGRST116');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A9: Error con code y message completamente irreconocibles → fallback genérico
// ---------------------------------------------------------------------------

describe('EC-A9: error_desconocido_fallback_generico', () => {
  it('code y message desconocidos → mensaje genérico (no expone internals)', () => {
    const error = make_auth_error('some_unexpected_error_xyz', 'unknown_code_xyz_987', 500);

    const result = map_auth_error(error);

    // Debe ser un mensaje fallback genérico
    expect(result).toMatch(/error|intenta|intentalo/i);
    expect(result).not.toBe('some_unexpected_error_xyz');
    expect(result).not.toContain('unknown_code_xyz_987');
    expect(result).not.toBe('');
  });
});

// ---------------------------------------------------------------------------
// EC-A10: null como error → fallback genérico sin lanzar
// ---------------------------------------------------------------------------

describe('EC-A10: null_como_error_no_lanza', () => {
  it('null → devuelve fallback genérico sin lanzar', () => {
    expect(() => {
      const result = map_auth_error(null);
      expect(result).not.toBe('');
      expect(typeof result).toBe('string');
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EC-A11: undefined como error → fallback genérico sin lanzar
// ---------------------------------------------------------------------------

describe('EC-A11: undefined_como_error_no_lanza', () => {
  it('undefined → devuelve fallback genérico sin lanzar', () => {
    expect(() => {
      const result = map_auth_error(undefined);
      expect(result).not.toBe('');
      expect(typeof result).toBe('string');
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// EC-A12: el mensaje devuelto NUNCA es string vacío
// ---------------------------------------------------------------------------

describe('EC-A12: mensaje_nunca_vacio', () => {
  const casos: Array<{ nombre: string; error: unknown }> = [
    {
      nombre: 'invalid_credentials',
      error: make_auth_error('Invalid login credentials', 'invalid_credentials'),
    },
    {
      nombre: 'email_not_confirmed',
      error: make_auth_error('Email not confirmed', 'email_not_confirmed'),
    },
    {
      nombre: 'over_request_rate_limit',
      error: make_auth_error('Rate limit', 'over_request_rate_limit'),
    },
    {
      nombre: 'status_429',
      error: make_auth_error('Too many requests', undefined, 429),
    },
    {
      nombre: 'network_request_failed',
      error: make_auth_error('Network request failed'),
    },
    {
      nombre: 'error_js_red',
      error: new Error('Network request failed'),
    },
    {
      nombre: 'error_desconocido',
      error: make_auth_error('xyz', 'abc'),
    },
    { nombre: 'null', error: null },
    { nombre: 'undefined', error: undefined },
  ];

  it.each(casos)('caso $nombre → string no vacío', ({ error }) => {
    const result = map_auth_error(error);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
