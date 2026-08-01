/**
 * Smoke tests — las tres pantallas de la subtarea 72 (72.3/72.4/72.5)
 * construidas hoy detrás de prereqs externos (SMTP Resend, credenciales
 * Google/Apple). No hay lógica crítica aquí (esa vive y se testea en
 * validation.ts) — solo confirmamos que cada pantalla monta sin lanzar.
 *
 * 72.3 (verificación real de email) añade un caso NO-smoke, con aserción
 * fuerte: verify-email SIN sesión (el caso real post-registro, antes de que
 * el usuario abra el enlace del correo) debe mostrar el email por route
 * param — sin sesión, `session?.user.email` es undefined y hoy la pantalla
 * cae al texto genérico sin email.
 *
 * EDGE CASES (RED, añadidos en 72.3):
 * - VE-1: sin sesión + param email → el texto muestra ESE email (route param,
 *   no session.user.email)
 */
import React from 'react';
import { render, cleanup, act } from '@testing-library/react-native';

import ForgotPasswordScreen from '../../../../app/forgot-password';
import ResetPasswordScreen from '../../../../app/reset-password';
import VerifyEmailScreen from '../../../../app/verify-email';

// ---------------------------------------------------------------------------
// Mocks compartidos
// ---------------------------------------------------------------------------

const mock_use_auth = jest.fn();

jest.mock('@/features/auth/context', () => ({
  useAuth: () => mock_use_auth(),
}));

const mock_use_local_search_params = jest.fn();

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const React = require('react');
  return {
    useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
    useLocalSearchParams: () => mock_use_local_search_params(),
    Link: ({ children }: { children: React.ReactNode }) =>
      React.createElement(Text, null, children),
  };
});

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      resend: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

beforeEach(() => {
  mock_use_auth.mockReturnValue({
    session: {
      user: { id: 'u1', email: 'agente@urbea.mx' },
    },
    user: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
    requestPasswordReset: jest.fn().mockResolvedValue(undefined),
    updatePassword: jest.fn().mockResolvedValue(undefined),
  });
  mock_use_local_search_params.mockReturnValue({});
});

afterEach(() => {
  cleanup();
});

describe('pantallas nuevas (72.3/72.5) — smoke', () => {
  it('ForgotPasswordScreen monta sin lanzar', async () => {
    await act(async () => {
      render(<ForgotPasswordScreen />);
    });
  });

  it('ResetPasswordScreen monta sin lanzar', async () => {
    await act(async () => {
      render(<ResetPasswordScreen />);
    });
  });

  it('VerifyEmailScreen monta sin lanzar', async () => {
    await act(async () => {
      render(<VerifyEmailScreen />);
    });
  });
});

describe('VE-1: verify_email_sin_sesion_usa_el_email_del_route_param', () => {
  it('sin sesión + param email → el texto muestra ESE email, no un genérico', async () => {
    mock_use_auth.mockReturnValue({
      session: null,
      user: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn().mockResolvedValue(undefined),
      requestPasswordReset: jest.fn().mockResolvedValue(undefined),
      updatePassword: jest.fn().mockResolvedValue(undefined),
    });
    mock_use_local_search_params.mockReturnValue({ email: 'sin-sesion@urbea.mx' });

    let q!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      q = await render(<VerifyEmailScreen />);
    });

    expect(
      q.queryByText(
        'Te enviamos un enlace de confirmación a sin-sesion@urbea.mx. Ábrelo para activar tu cuenta.',
      ),
    ).not.toBeNull();
  });
});
