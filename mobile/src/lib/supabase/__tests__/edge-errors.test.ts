/**
 * Tests fase RED — extract_error_code
 * Archivo SUT: mobile/src/lib/supabase/edge-errors.ts
 * Subtarea Taskmaster: 34.2 — API cliente + hook useCreateInvitation
 *
 * SUT: extract_error_code(error: unknown) → Promise<string | undefined>
 * Extraído de registration/api.ts (donde vivía module-private) para reusarlo
 * desde features/agency/api.ts. Mismo contrato best-effort:
 *   - FunctionsHttpError con body { error: { code } } → code
 *   - FunctionsHttpError con body sin code / code no-string → undefined
 *   - FunctionsHttpError con body no-JSON → undefined
 *   - error que NO es FunctionsHttpError (red, TypeError) → undefined
 */

import { FunctionsHttpError } from '@supabase/supabase-js';

import { extract_error_code } from '../edge-errors';

function make_http_error(body: BodyInit | null): FunctionsHttpError {
  return new FunctionsHttpError(new Response(body, { status: 422 }));
}

describe('extract_error_code', () => {
  it('EC-1: FunctionsHttpError con { error: { code } } → devuelve el code', async () => {
    const error = make_http_error(
      JSON.stringify({ error: { code: 'NOT_AGENCY_OWNER', message: 'x' } }),
    );
    expect(await extract_error_code(error)).toBe('NOT_AGENCY_OWNER');
  });

  it('EC-2: body sin error.code → undefined', async () => {
    const error = make_http_error(JSON.stringify({ mensaje: 'sin code' }));
    expect(await extract_error_code(error)).toBeUndefined();
  });

  it('EC-3: error.code no-string (número) → undefined', async () => {
    const error = make_http_error(JSON.stringify({ error: { code: 422 } }));
    expect(await extract_error_code(error)).toBeUndefined();
  });

  it('EC-4: body no-JSON → undefined (sin throw)', async () => {
    const error = make_http_error('<html>gateway timeout</html>');
    expect(await extract_error_code(error)).toBeUndefined();
  });

  it('EC-5: error que no es FunctionsHttpError → undefined', async () => {
    expect(await extract_error_code(new TypeError('Network request failed'))).toBeUndefined();
    expect(await extract_error_code(undefined)).toBeUndefined();
  });
});
