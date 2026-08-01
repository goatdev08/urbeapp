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
 *
 * EDGE CASES (post-guardian, 72.3):
 * - O1: send_verification_email resuelve false (resend falló) → mensaje de
 *   error visible, el botón NO entra en cooldown de 60s (renegociación del
 *   contrato de send_verification_email a boolean, ver api.test.ts SV-2/SV-3).
 * - O2: el deep link entrante trae un error del proveedor → la pantalla
 *   muestra error_message de useSessionFromDeepLink.
 */
import React from 'react';
import { render, cleanup, act, fireEvent } from '@testing-library/react-native';

import ForgotPasswordScreen from '../../../../app/forgot-password';
import ResetPasswordScreen from '../../../../app/reset-password';
import VerifyEmailScreen from '../../../../app/verify-email';
import { supabase } from '@/lib/supabase/client';
import { useURL } from 'expo-linking';

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
      setSession: jest.fn().mockResolvedValue({ error: null }),
    },
  },
}));

// expo-linking: createURL (send_verification_email) + useURL (deep link de
// vuelta, useSessionFromDeepLink). Sin URL entrante por defecto — O2 la
// sobreescribe para simular el click en el enlace de correo.
jest.mock('expo-linking', () => ({
  createURL: jest.fn(() => 'urbea://verify-email'),
  useURL: jest.fn(() => null),
}));

const mock_resend = supabase.auth.resend as jest.Mock;
const mock_use_url = useURL as jest.Mock;

beforeEach(() => {
  mock_resend.mockClear().mockResolvedValue({ error: null });
  mock_use_url.mockReturnValue(null);
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

describe('O1: resend_fallido_muestra_error_sin_arrancar_cooldown', () => {
  it('resend devuelve error → send_verification_email resuelve false, mensaje de error visible y SIN cooldown', async () => {
    mock_resend.mockResolvedValue({ error: new Error('rate limit exceeded') });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    let q!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      q = await render(<VerifyEmailScreen />);
    });

    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /reenviar correo de verificación/i }));
    });
    // handle_resend es async — deja correr el await de send_verification_email.
    await act(async () => {
      await Promise.resolve();
    });

    expect(q.queryByText('No pudimos reenviar el correo. Inténtalo de nuevo.')).not.toBeNull();
    // Sin cooldown: el botón sigue diciendo "Reenviar correo", no "Reenviar en 60s".
    expect(q.queryByText('Reenviar en 60s')).toBeNull();

    (console.warn as jest.Mock).mockRestore();
  });
});

describe('O2: deep_link_con_error_muestra_error_message_del_hook', () => {
  it('la URL entrante trae error del proveedor → la pantalla muestra el mensaje de enlace expirado', async () => {
    mock_use_url.mockReturnValue(
      'urbea://verify-email#error=access_denied&error_code=otp_expired',
    );

    let q!: Awaited<ReturnType<typeof render>>;
    await act(async () => {
      q = await render(<VerifyEmailScreen />);
    });
    // La rama de error de useSessionFromDeepLink difiere el setState un tick
    // (setTimeout(0)) — mismo patrón que el cooldown de esta pantalla.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(q.queryByText('El enlace expiró, reenvía el correo')).not.toBeNull();
  });
});
