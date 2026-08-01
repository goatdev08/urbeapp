/**
 * Tests — useGoogleOAuth (mobile/src/features/auth/hooks/useGoogleOAuth.ts)
 * Subtarea 72.4 (Google OAuth). Reutiliza el patrón de mocks/estilo de
 * useSessionFromDeepLink.test.ts (72.3): jest.fn() dentro del factory,
 * import del SUT y de los mocks DESPUÉS de jest.mock, `flush()` para drenar
 * microtareas.
 *
 * SUT: useGoogleOAuth() → { sign_in_with_google, error_message }.
 *
 * DISEÑO APROBADO:
 *  1. sign_in_with_google() llama supabase.auth.signInWithOAuth({
 *       provider: 'google',
 *       options: { redirectTo: Linking.createURL('login'), skipBrowserRedirect: true },
 *     }).
 *  2. Con data.url → WebBrowser.openAuthSessionAsync(data.url, redirectTo)
 *     (mismo redirectTo del paso 1).
 *  3. result.type === 'success' con tokens en el fragment de result.url →
 *     supabase.auth.setSession({ access_token, refresh_token }) exactos.
 *  4. result.type === 'cancel' | 'dismiss' → no-op silencioso, sin error.
 *  5. Cualquier fallo (signInWithOAuth, callback #error=, setSession) expone
 *     `error_message`.
 *
 * Mocks de frontera: `expo-web-browser` (browser nativo del sistema),
 * `expo-linking` (createURL — deep link nativo) y `@/lib/supabase/client`
 * (llamadas HTTP reales a GoTrue). NO se mockea `parse_session_from_url`
 * (colaborador propio, ya cubierto en deep-link-session.test.ts) — se
 * ejercita con URLs reales, mismo patrón que useSessionFromDeepLink.test.ts.
 *
 * EDGE CASES:
 * - GO-1: happy path — signInWithOAuth con provider/options exactos →
 *   openAuthSessionAsync con la url + redirectTo exactos → success con
 *   tokens → setSession con esos tokens exactos → sin error.
 * - GO-2a: openAuthSessionAsync 'cancel' → NO setSession, sin error_message.
 * - GO-2b: openAuthSessionAsync 'dismiss' → NO setSession, sin error_message.
 * - GO-3: signInWithOAuth devuelve error → error_message expuesto; el browser
 *   NO se abre (openAuthSessionAsync no se llama).
 * - GO-4: callback de vuelta con #error=access_denied → error_message
 *   expuesto; setSession NO se llama.
 * - GO-5: setSession devuelve error → error_message expuesto.
 * - GO-6 (reentrada / guard in_flight): DIFERIDO — fuera de alcance de esta
 *   fase RED por complejidad de sincronizar dos invocaciones concurrentes del
 *   mismo callback en un test determinista; no se testea aquí.
 */
import { act, renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — jest.fn() dentro del factory (evita hoisting), mismo patrón que
// useSessionFromDeepLink.test.ts.
// ---------------------------------------------------------------------------
jest.mock('expo-linking', () => ({
  createURL: jest.fn(),
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithOAuth: jest.fn(),
      setSession: jest.fn(),
    },
  },
}));

// ---------------------------------------------------------------------------
// Importamos el SUT y los mocks DESPUÉS de jest.mock
// ---------------------------------------------------------------------------
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '@/lib/supabase/client';
import { useGoogleOAuth } from '../hooks/useGoogleOAuth';

const mock_create_url = Linking.createURL as jest.MockedFunction<typeof Linking.createURL>;
const mock_open_auth_session = WebBrowser.openAuthSessionAsync as jest.MockedFunction<
  typeof WebBrowser.openAuthSessionAsync
>;
const mock_sign_in_with_oauth = supabase.auth.signInWithOAuth as jest.MockedFunction<
  typeof supabase.auth.signInWithOAuth
>;
const mock_set_session = supabase.auth.setSession as jest.MockedFunction<
  typeof supabase.auth.setSession
>;

const REDIRECT_TO = 'urbea://login';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/auth?client_id=fake';

/** Deja correr cualquier microtarea pendiente tras invocar sign_in_with_google. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_create_url.mockReturnValue(REDIRECT_TO);
});

// ===========================================================================
// GO-1: happy path
// ===========================================================================
describe('GO-1: happy_path_signInWithOAuth_openAuthSession_setSession', () => {
  it('encadena signInWithOAuth → openAuthSessionAsync → setSession con los valores exactos', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: AUTH_URL },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_sign_in_with_oauth>>);
    mock_open_auth_session.mockResolvedValue({
      type: 'success',
      url: 'urbea://login#access_token=AT&refresh_token=RT',
    } as unknown as Awaited<ReturnType<typeof mock_open_auth_session>>);
    mock_set_session.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_set_session>>);

    const { result } = await renderHook(() => useGoogleOAuth());
    await act(async () => {
      await result.current.sign_in_with_google();
    });
    await flush();

    expect(mock_sign_in_with_oauth).toHaveBeenCalledTimes(1);
    expect(mock_sign_in_with_oauth).toHaveBeenCalledWith({
      provider: 'google',
      options: { redirectTo: REDIRECT_TO, skipBrowserRedirect: true },
    });

    expect(mock_open_auth_session).toHaveBeenCalledTimes(1);
    expect(mock_open_auth_session).toHaveBeenCalledWith(AUTH_URL, REDIRECT_TO);

    expect(mock_set_session).toHaveBeenCalledTimes(1);
    expect(mock_set_session).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' });

    expect(result.current.error_message).toBeNull();
  });
});

// ===========================================================================
// GO-2a / GO-2b: cancelación del usuario — silencio total
// ===========================================================================
describe('GO-2a: cancel_no_llama_setSession_ni_expone_error', () => {
  it('type "cancel" → setSession NO se llama; error_message queda null', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: AUTH_URL },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_sign_in_with_oauth>>);
    mock_open_auth_session.mockResolvedValue({
      type: 'cancel',
    } as unknown as Awaited<ReturnType<typeof mock_open_auth_session>>);

    const { result } = await renderHook(() => useGoogleOAuth());
    await act(async () => {
      await result.current.sign_in_with_google();
    });
    await flush();

    expect(mock_set_session).not.toHaveBeenCalled();
    expect(result.current.error_message).toBeNull();
  });
});

describe('GO-2b: dismiss_no_llama_setSession_ni_expone_error', () => {
  it('type "dismiss" → setSession NO se llama; error_message queda null', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: AUTH_URL },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_sign_in_with_oauth>>);
    mock_open_auth_session.mockResolvedValue({
      type: 'dismiss',
    } as unknown as Awaited<ReturnType<typeof mock_open_auth_session>>);

    const { result } = await renderHook(() => useGoogleOAuth());
    await act(async () => {
      await result.current.sign_in_with_google();
    });
    await flush();

    expect(mock_set_session).not.toHaveBeenCalled();
    expect(result.current.error_message).toBeNull();
  });
});

// ===========================================================================
// GO-3: signInWithOAuth devuelve error → NO abre el browser
// ===========================================================================
describe('GO-3: signInWithOAuth_error_no_abre_browser', () => {
  it('signInWithOAuth {error} → error_message expuesto; openAuthSessionAsync NO se llama', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: new Error('oauth provider not configured'),
    } as unknown as Awaited<ReturnType<typeof mock_sign_in_with_oauth>>);

    const { result } = await renderHook(() => useGoogleOAuth());
    await act(async () => {
      await result.current.sign_in_with_google();
    });
    await flush();

    expect(mock_open_auth_session).not.toHaveBeenCalled();
    expect(mock_set_session).not.toHaveBeenCalled();
    expect(result.current.error_message).not.toBeNull();
  });
});

// ===========================================================================
// GO-4: callback con #error= → error_message; setSession NO se llama
// ===========================================================================
describe('GO-4: callback_con_error_no_llama_setSession', () => {
  it('url de retorno con #error=access_denied → error_message expuesto; setSession NO se llama', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: AUTH_URL },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_sign_in_with_oauth>>);
    mock_open_auth_session.mockResolvedValue({
      type: 'success',
      url: 'urbea://login#error=access_denied&error_code=access_denied',
    } as unknown as Awaited<ReturnType<typeof mock_open_auth_session>>);

    const { result } = await renderHook(() => useGoogleOAuth());
    await act(async () => {
      await result.current.sign_in_with_google();
    });
    await flush();

    expect(mock_set_session).not.toHaveBeenCalled();
    expect(result.current.error_message).not.toBeNull();
  });
});

// ===========================================================================
// GO-5: setSession devuelve error → error_message expuesto
// ===========================================================================
describe('GO-5: setSession_error_expone_error_message', () => {
  it('setSession {error} → error_message expuesto', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: AUTH_URL },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_sign_in_with_oauth>>);
    mock_open_auth_session.mockResolvedValue({
      type: 'success',
      url: 'urbea://login#access_token=AT&refresh_token=RT',
    } as unknown as Awaited<ReturnType<typeof mock_open_auth_session>>);
    mock_set_session.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('invalid token'),
    } as unknown as Awaited<ReturnType<typeof mock_set_session>>);

    const { result } = await renderHook(() => useGoogleOAuth());
    await act(async () => {
      await result.current.sign_in_with_google();
    });
    await flush();

    expect(result.current.error_message).not.toBeNull();
  });
});
