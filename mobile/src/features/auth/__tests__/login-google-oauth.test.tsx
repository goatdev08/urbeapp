/**
 * Tests fase RED — wiring del botón "Continuar con Google" en LoginScreen
 * (mobile/app/login.tsx). Subtarea 72.4 (Google OAuth).
 *
 * `GOOGLE_OAUTH_ENABLED` se mockea a `true` (jest.mock del módulo
 * feature-flags) porque en el repo real sigue apagado (sin credenciales de
 * Google Cloud, ver feature-flags.ts) — así se puede probar el wiring del
 * botón sin depender del flag real.
 *
 * No se mockea `useGoogleOAuth` (colaborador propio de login.tsx): se
 * ejercita completo, mockeando solo las fronteras que usa por dentro
 * (`@/lib/supabase/client`, `expo-web-browser`, `expo-linking`) — mismo
 * criterio que useGoogleOAuth.test.ts. Esto prueba el slice vertical
 * completo: press del botón → useGoogleOAuth real → supabase.auth.signInWithOAuth.
 *
 * EDGE CASES:
 * - LG-1: con el flag prendido, presionar "Continuar con Google" invoca
 *   supabase.auth.signInWithOAuth con provider 'google' — el
 *   handle_social_login_stub legacy (que lanzaba Error) ya NO debe ser lo que
 *   corre para Google.
 * - LG-2: si signInWithOAuth falla, el mensaje de error queda visible en
 *   pantalla (mismo patrón de error_banner que el submit por password).
 *
 * (El caso "flag apagado → botones no se renderizan" ya lo cubre el
 * comportamiento condicional de app/login.tsx; no hay test previo dedicado
 * pero no es parte de esta subtarea — 72.4 es sobre el flujo OAuth, no sobre
 * la visibilidad condicional que ya existía.)
 */
import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mock de feature-flags — fuerza GOOGLE_OAUTH_ENABLED=true para poder probar
// el wiring aunque en el repo real siga apagado.
// ---------------------------------------------------------------------------
jest.mock('@/features/auth/feature-flags', () => ({
  GOOGLE_OAUTH_ENABLED: true,
  APPLE_OAUTH_ENABLED: false,
}));

// ---------------------------------------------------------------------------
// Mocks de frontera que usa useGoogleOAuth por dentro (real, sin mockear el
// hook en sí — mismo patrón que useGoogleOAuth.test.ts).
// ---------------------------------------------------------------------------
const mock_sign_in_with_oauth = jest.fn();
const mock_set_session = jest.fn();

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      signInWithOAuth: (...args: unknown[]) => mock_sign_in_with_oauth(...args),
      setSession: (...args: unknown[]) => mock_set_session(...args),
    },
  },
}));

const mock_create_url = jest.fn((..._args: unknown[]) => 'urbea://login');
jest.mock('expo-linking', () => ({
  createURL: (...args: unknown[]) => mock_create_url(...args),
}));

const mock_open_auth_session = jest.fn();
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...args: unknown[]) => mock_open_auth_session(...args),
}));

// ---------------------------------------------------------------------------
// Mock de useAuth — sin sesión, no cargando (mismo patrón que login-submit.test.tsx)
// ---------------------------------------------------------------------------
jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    session: null,
    user: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock de expo-router
// ---------------------------------------------------------------------------
jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const React = require('react');
  return {
    useRouter: () => ({
      replace: jest.fn(),
      push: jest.fn(),
      back: jest.fn(),
    }),
    Stack: { Screen: () => null },
    Link: ({ children }: { children: React.ReactNode }) =>
      React.createElement(Text, null, children),
    Redirect: () => null,
  };
});

// ---------------------------------------------------------------------------
// Mock de react-native-safe-area-context
// ---------------------------------------------------------------------------
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los mocks
// ---------------------------------------------------------------------------
import LoginScreen from '../../../../app/login';

type RenderResult = Awaited<ReturnType<typeof render>>;

beforeEach(() => {
  jest.clearAllMocks();
  mock_create_url.mockReturnValue('urbea://login');
});

afterEach(() => {
  cleanup();
});

async function drain_react_updates() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ===========================================================================
// LG-1: presionar "Continuar con Google" invoca signInWithOAuth (provider google)
// ===========================================================================
describe('LG-1: boton_google_invoca_signInWithOAuth_provider_google', () => {
  it('con GOOGLE_OAUTH_ENABLED=true, el botón invoca supabase.auth.signInWithOAuth con provider "google"', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: new Error('sin browser en este test'),
    });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<LoginScreen />);
    });

    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /continuar con google/i }));
    });
    await drain_react_updates();

    expect(mock_sign_in_with_oauth).toHaveBeenCalledTimes(1);
    const call_args = mock_sign_in_with_oauth.mock.calls[0]?.[0] as { provider?: string };
    expect(call_args?.provider).toBe('google');
  });
});

// ===========================================================================
// LG-2: signInWithOAuth falla → mensaje de error visible en pantalla
// ===========================================================================
describe('LG-2: signInWithOAuth_falla_muestra_error_en_pantalla', () => {
  it('error de signInWithOAuth → aparece un mensaje de error visible', async () => {
    mock_sign_in_with_oauth.mockResolvedValue({
      data: { provider: 'google', url: null },
      error: new Error('Google OAuth no configurado'),
    });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<LoginScreen />);
    });

    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /continuar con google/i }));
    });
    await drain_react_updates();

    const error_alert = q.queryByRole('alert');
    expect(error_alert).not.toBeNull();
  });
});
