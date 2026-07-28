/**
 * Smoke tests — las tres pantallas de la subtarea 72 (72.3/72.4/72.5)
 * construidas hoy detrás de prereqs externos (SMTP Resend, credenciales
 * Google/Apple). No hay lógica crítica aquí (esa vive y se testea en
 * validation.ts) — solo confirmamos que cada pantalla monta sin lanzar.
 */
import React from 'react';
import { render, cleanup, act } from '@testing-library/react-native';

import ForgotPasswordScreen from '../../../../app/forgot-password';
import ResetPasswordScreen from '../../../../app/reset-password';
import VerifyEmailScreen from '../../../../app/verify-email';

// ---------------------------------------------------------------------------
// Mocks compartidos
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    session: {
      user: { id: 'u1', email: 'agente@urbea.mx' },
    },
    user: null,
    isLoading: false,
    signIn: jest.fn(),
    signUp: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
    requestPasswordReset: jest.fn().mockResolvedValue(undefined),
    updatePassword: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const React = require('react');
  return {
    useRouter: () => ({ replace: jest.fn(), push: jest.fn(), back: jest.fn() }),
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
