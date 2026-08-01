/**
 * Tests fase RED — register_user (cliente de la EF `register`, §5.1)
 * Archivo SUT: mobile/src/features/auth/api.ts — subtarea 93.3 (stub que LANZA
 * 'not_implemented'; sin `deps` reales todavía, ver header del archivo).
 *
 * Contrato real de la EF: supabase/functions/register/{handler,types}.ts (93.2)
 *   POST público, body RegisterUserInput → 200 {user_id} | 4xx/5xx {error:{code,message}}
 *
 * Frontera de sistema mockeada: `supabase.functions.invoke` (llamada HTTP real a
 * la Edge Function). `extract_error_code` es un colaborador interno propio
 * (mobile/src/lib/supabase/edge-errors.ts) — NO se mockea; se ejercita con
 * FunctionsHttpError reales, mismo patrón que edge-errors.test.ts.
 *
 * EDGE CASES (RED):
 *
 * ### Happy path
 * - RU-1: invoke resuelve {data:{user_id}, error:null} → {ok:true, user_id};
 *   invoke se llama exactamente 1 vez con ('register', {body: <payload exacto>})
 *
 * ### Error de negocio (código conocido de la EF, vía FunctionsHttpError real)
 * - RU-2: error {code:'PHONE_TAKEN'} → {ok:false, code:'PHONE_TAKEN'}
 * - RU-3: error {code:'UNDERAGE'} → {ok:false, code:'UNDERAGE'}
 * - RU-4: error {code:'EMAIL_ALREADY_EXISTS'} → {ok:false, code:'EMAIL_ALREADY_EXISTS'}
 *
 * ### Boundary / error de red
 * - RU-5: error que NO es FunctionsHttpError (TypeError de red) → {ok:false, code:undefined}
 *
 * ### send_verification_email (subtarea 72.3 — verificación real de email)
 * Seam: la firma pública `send_verification_email(email)`. Frontera de
 * sistema mockeada: `supabase.auth.resend` (llamada HTTP real a GoTrue) y
 * `expo-linking` (deep link nativo — no hay scheme real bajo Jest).
 * - SV-1: llama supabase.auth.resend con {type:'signup', email, options:{emailRedirectTo}}
 *   EXACTO — emailRedirectTo es el valor que devuelve Linking.createURL('verify-email')
 * - SV-2: resend devuelve {error: null} → resuelve void, NO lanza
 * - SV-3: resend devuelve {error} → NO lanza (fail-soft) y hace console.warn
 */
import { FunctionsHttpError } from '@supabase/supabase-js';

import { register_user, send_verification_email, type RegisterUserInput } from '../api';

// ---------------------------------------------------------------------------
// Mock de frontera — supabase.functions.invoke / supabase.auth.resend
// ---------------------------------------------------------------------------
const mock_invoke = jest.fn();
const mock_resend = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mock_invoke(...args),
    },
    auth: {
      resend: (...args: unknown[]) => mock_resend(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock de frontera — expo-linking (deep link nativo, sin scheme real en Jest)
// ---------------------------------------------------------------------------
const mock_create_url = jest.fn();

jest.mock('expo-linking', () => ({
  createURL: (...args: unknown[]) => mock_create_url(...args),
}));

function make_http_error(code: string): FunctionsHttpError {
  return new FunctionsHttpError(
    new Response(JSON.stringify({ error: { code, message: 'mensaje de la EF' } }), {
      status: 409,
    }),
  );
}

const INPUT: RegisterUserInput = {
  email: 'nuevo@urbea.mx',
  password: 'Secreto123',
  first_name: 'Juan',
  last_name: 'Pérez',
  phone: '+523312345678',
  date_of_birth: '2000-01-15',
  state_id: '14',
  municipality_id: '14039',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('register_user', () => {
  it('RU-1: happy path — invoke con el payload exacto → {ok:true, user_id}', async () => {
    mock_invoke.mockResolvedValue({ data: { user_id: 'uuid-93' }, error: null });

    const result = await register_user(INPUT);

    expect(result).toEqual({ ok: true, user_id: 'uuid-93' });
    expect(mock_invoke).toHaveBeenCalledTimes(1);
    expect(mock_invoke).toHaveBeenCalledWith('register', { body: INPUT });
  });

  it('RU-2: error de negocio PHONE_TAKEN → {ok:false, code:"PHONE_TAKEN"}', async () => {
    mock_invoke.mockResolvedValue({ data: null, error: make_http_error('PHONE_TAKEN') });

    const result = await register_user(INPUT);

    expect(result).toEqual({ ok: false, code: 'PHONE_TAKEN' });
  });

  it('RU-3: error de negocio UNDERAGE → {ok:false, code:"UNDERAGE"}', async () => {
    mock_invoke.mockResolvedValue({ data: null, error: make_http_error('UNDERAGE') });

    const result = await register_user(INPUT);

    expect(result).toEqual({ ok: false, code: 'UNDERAGE' });
  });

  it('RU-4: error de negocio EMAIL_ALREADY_EXISTS → {ok:false, code:"EMAIL_ALREADY_EXISTS"}', async () => {
    mock_invoke.mockResolvedValue({
      data: null,
      error: make_http_error('EMAIL_ALREADY_EXISTS'),
    });

    const result = await register_user(INPUT);

    expect(result).toEqual({ ok: false, code: 'EMAIL_ALREADY_EXISTS' });
  });

  it('RU-5: error de red (no FunctionsHttpError) → {ok:false, code:undefined}', async () => {
    mock_invoke.mockResolvedValue({
      data: null,
      error: new TypeError('Network request failed'),
    });

    const result = await register_user(INPUT);

    expect(result).toEqual({ ok: false, code: undefined });
  });
});

describe('send_verification_email', () => {
  it('SV-1: llama resend con type signup, el email exacto y emailRedirectTo de Linking.createURL("verify-email")', async () => {
    mock_create_url.mockReturnValue('urbea://verify-email');
    mock_resend.mockResolvedValue({ error: null });

    await send_verification_email('nuevo@urbea.mx');

    expect(mock_create_url).toHaveBeenCalledWith('verify-email');
    expect(mock_resend).toHaveBeenCalledTimes(1);
    expect(mock_resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'nuevo@urbea.mx',
      options: { emailRedirectTo: 'urbea://verify-email' },
    });
  });

  // SV-2/SV-3 renegociados post-guardian (O1, 72.3): el contrato pasó de
  // Promise<void> a Promise<boolean> — verify-email.tsx necesita distinguir
  // "se reenvió" de "falló" para no pintar "correo reenviado" sobre un envío
  // que no ocurrió (antes el fail-soft ocultaba el fallo también al UI, no
  // solo al caller). Renegociación aprobada por el orquestador tras el
  // hallazgo del guardián (O1 — regresión de UX).
  it('SV-2: resend sin error → resuelve true (no lanza)', async () => {
    mock_create_url.mockReturnValue('urbea://verify-email');
    mock_resend.mockResolvedValue({ error: null });

    await expect(send_verification_email('nuevo@urbea.mx')).resolves.toBe(true);
  });

  it('SV-3: resend devuelve error → resuelve false (fail-soft, no lanza) y hace console.warn', async () => {
    mock_create_url.mockReturnValue('urbea://verify-email');
    mock_resend.mockResolvedValue({ error: new Error('rate limit exceeded') });
    const warn_spy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(send_verification_email('nuevo@urbea.mx')).resolves.toBe(false);

    expect(warn_spy).toHaveBeenCalledTimes(1);
    warn_spy.mockRestore();
  });
});
