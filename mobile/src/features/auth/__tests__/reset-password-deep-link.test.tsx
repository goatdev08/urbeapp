/**
 * Tests — cableado del deep link de recuperación en app/reset-password.tsx
 * (subtarea 72.5, PRD §5.3). Reutiliza `useSessionFromDeepLink`
 * (hooks/useSessionFromDeepLink.ts, ya testeado en su propia suite — 72.3)
 * SIN modificarlo: esta pantalla lo monta con su propio `on_success`.
 *
 * Contrato bajo test (diseño aprobado, ver subtarea 72.5):
 * - El enlace de recovery del correo trae tokens en el fragment
 *   (`urbea://reset-password#access_token=...&refresh_token=...`) →
 *   `setSession` se llama con esos tokens; `on_success` para ESTA pantalla es
 *   quedarse en ella (NO navega) — la sesión de recovery queda establecida
 *   para que `updatePassword` funcione.
 * - Si el hook reporta error (enlace expirado/inválido): mensaje inline +
 *   CTA que navega a /forgot-password.
 * - Al éxito de `updatePassword`: mensaje de éxito + `router.replace('/')`
 *   (el usuario ya tiene sesión, entra directo — no requiere tap manual).
 * - Sin sesión y sin deep link: `updatePassword` falla con el error real de
 *   GoTrue (sesión ausente) → el mensaje se muestra, no se traga, y no navega.
 *
 * Mocks de frontera: `expo-linking` (Linking.useURL), `@/lib/supabase/client`
 * (supabase.auth.setSession — llamada HTTP real a GoTrue, vía el hook),
 * `@/features/auth/context` (useAuth — updatePassword) y `expo-router`
 * (useRouter — con jest.fn() capturados a nivel de módulo para poder
 * aserirlos, a diferencia del mock inline de new-auth-screens-smoke.test.tsx
 * que crea un jest.fn() nuevo en cada llamada y no permite assertions).
 *
 * NOTA API RNTL v14 + React 19 (mismo patrón que register-user-mode.test.tsx):
 * - `render(...)` devuelve una Promise → se usa dentro de `act(async () => {})`.
 * - `fill_valid_password_form` agrupa TODOS los `changeText` en un único
 *   `act`, y el `fireEvent.press` del submit va en OTRO `act` separado
 *   (nunca junto con los `changeText` en el mismo `act`) — confirmado
 *   empíricamente: meter cambios de texto y el press en el MISMO `act`
 *   deja el handler del press corriendo contra el closure del render
 *   anterior (password/confirm todavía '' ahí dentro), aunque el árbol
 *   renderizado ya muestre el valor nuevo en el input.
 * - `drain_react_updates()` tras la interacción, antes de cualquier assert
 *   (incluidos los que van a fallar en RED) — deja correr los `await` de
 *   `handle_submit` dentro del componente.
 *
 * EDGE CASES:
 * - RP-DL-1 (RED — falla hoy): URL con tokens de recovery → setSession con
 *   esos tokens exactos; la pantalla NO navega (router.replace no llamado) y
 *   el formulario sigue visible. Falla hoy porque el hook aún no está
 *   montado en la pantalla.
 * - RP-DL-2 (RED — falla hoy): URL de error (otp_expired) → mensaje inline
 *   de enlace expirado visible; el CTA "Pedir un nuevo enlace" navega a
 *   /forgot-password al presionarlo. Falla hoy por lo mismo (sin hook, sin
 *   mensaje, sin CTA).
 * - RP-DL-3 (RED — falla hoy): updatePassword resuelve ok → mensaje de éxito
 *   visible y router.replace('/') (no '/login', no manual). Falla HOY solo
 *   en el router.replace('/') — el mensaje de éxito y la llamada a
 *   updatePassword ya funcionan (pantalla "done" existente), lo que falta es
 *   la navegación automática.
 * - RP-DL-4 (regresión — YA pasa hoy, sin cambios): updatePassword lanza
 *   (sesión ausente, error real de GoTrue) → mensaje de error visible (no se
 *   traga), NO navega, el formulario sigue visible. El catch/map_auth_error
 *   existente en reset-password.tsx ya cubre esto; se deja como candado de
 *   regresión explícito en el contrato — el GREEN de 72.5 no debe romperlo.
 */
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — jest.fn() a nivel de módulo (capturables) dentro de cada factory
// para evitar el problema de hoisting, mismo patrón que useSessionFromDeepLink.test.ts.
// ---------------------------------------------------------------------------
const mock_router_replace = jest.fn();
const mock_router_push = jest.fn();

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const React = require('react');
  return {
    useRouter: () => ({ replace: mock_router_replace, push: mock_router_push, back: jest.fn() }),
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

jest.mock('expo-linking', () => ({
  useURL: jest.fn(),
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      setSession: jest.fn(),
    },
  },
}));

const mock_update_password = jest.fn();
jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({ updatePassword: mock_update_password }),
}));

// ---------------------------------------------------------------------------
// Importamos el SUT y los mocks DESPUÉS de jest.mock
// ---------------------------------------------------------------------------
import { useURL } from 'expo-linking';
import { supabase } from '@/lib/supabase/client';
import ResetPasswordScreen from '../../../../app/reset-password';

const mock_use_url = useURL as jest.MockedFunction<typeof useURL>;
const mock_set_session = supabase.auth.setSession as jest.MockedFunction<
  typeof supabase.auth.setSession
>;

const EXPIRED_LINK_MESSAGE = 'El enlace expiró, reenvía el correo';
const VALID_PASSWORD = 'SuperSegura123';

type RenderResult = Awaited<ReturnType<typeof render>>;

/** Deja correr timers pendientes (setTimeout(0) de la rama de error del hook) + microtareas. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

/** Drena microtareas pendientes de React — mismo helper que login-submit.test.tsx. */
async function drain_react_updates(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Mismo patrón que fill_valid_user_form en register-user-mode.test.tsx. */
async function fill_valid_password_form(q: RenderResult): Promise<void> {
  await act(async () => {
    fireEvent.changeText(q.getByTestId('reset-password-new'), VALID_PASSWORD);
    fireEvent.changeText(q.getByTestId('reset-password-confirm'), VALID_PASSWORD);
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_url.mockReturnValue(null);
  mock_update_password.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

// ===========================================================================
// RP-DL-1: tokens de recovery → setSession exacto; sin navegar; form visible
// ===========================================================================
describe('RP-DL-1: url_con_tokens_de_recovery_establece_sesion_sin_navegar', () => {
  it('setSession recibe access_token/refresh_token exactos; router.replace NO se llama; el formulario sigue visible', async () => {
    mock_use_url.mockReturnValue('urbea://reset-password#access_token=RAT&refresh_token=RRT');
    mock_set_session.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_set_session>>);

    let q!: RenderResult;
    await act(async () => {
      q = await render(<ResetPasswordScreen />);
    });
    await flush();

    expect(mock_set_session).toHaveBeenCalledTimes(1);
    expect(mock_set_session).toHaveBeenCalledWith({
      access_token: 'RAT',
      refresh_token: 'RRT',
    });
    expect(mock_router_replace).not.toHaveBeenCalled();
    expect(q.queryByTestId('reset-password-new')).not.toBeNull();
  });
});

// ===========================================================================
// RP-DL-2: URL de error → mensaje inline + CTA navega a /forgot-password
// ===========================================================================
describe('RP-DL-2: url_de_error_muestra_mensaje_y_el_cta_navega_a_forgot_password', () => {
  it('otp_expired → mensaje de enlace expirado visible; al presionar el CTA navega a /forgot-password', async () => {
    mock_use_url.mockReturnValue(
      'urbea://reset-password#error=access_denied&error_code=otp_expired',
    );

    let q!: RenderResult;
    await act(async () => {
      q = await render(<ResetPasswordScreen />);
    });
    await flush();

    expect(q.queryByText(EXPIRED_LINK_MESSAGE)).not.toBeNull();
    expect(mock_set_session).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /pedir un nuevo enlace/i }));
    });

    expect(mock_router_push).toHaveBeenCalledWith('/forgot-password');
  });
});

// ===========================================================================
// RP-DL-3: updatePassword ok → mensaje de éxito + router.replace('/')
// ===========================================================================
describe('RP-DL-3: guardar_contrasena_exitoso_navega_a_la_raiz', () => {
  it('updatePassword resuelve → mensaje de confirmación visible y router.replace llamado con "/"', async () => {
    let q!: RenderResult;
    await act(async () => {
      q = await render(<ResetPasswordScreen />);
    });

    await fill_valid_password_form(q);
    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /guardar contraseña/i }));
    });
    await drain_react_updates();

    expect(mock_update_password).toHaveBeenCalledWith(VALID_PASSWORD);
    expect(
      q.queryByText('Tu contraseña se actualizó correctamente. Ya puedes iniciar sesión con ella.'),
    ).not.toBeNull();
    expect(mock_router_replace).toHaveBeenCalledWith('/');
    expect(mock_router_replace).not.toHaveBeenCalledWith('/login');
  });
});

// ===========================================================================
// RP-DL-4: sin sesión y sin deep link → error de GoTrue visible, no se traga
// ===========================================================================
describe('RP-DL-4: sin_sesion_ni_deep_link_el_error_de_updatePassword_no_se_traga', () => {
  it('updatePassword lanza (sesión ausente) → mensaje de error visible; NO navega; el formulario sigue visible', async () => {
    mock_update_password.mockRejectedValue(
      Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' }),
    );

    let q!: RenderResult;
    await act(async () => {
      q = await render(<ResetPasswordScreen />);
    });

    await fill_valid_password_form(q);
    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /guardar contraseña/i }));
    });
    await drain_react_updates();

    expect(q.queryByText('Ocurrió un error inesperado. Inténtalo de nuevo.')).not.toBeNull();
    expect(mock_router_replace).not.toHaveBeenCalled();
    expect(q.queryByTestId('reset-password-new')).not.toBeNull();
  });
});
