/**
 * Tests fase RED — register.tsx modo 'user' (registro libre §5.1), subtareas
 * 93.3 + 72.3 (verificación real de email).
 * Archivo SUT: mobile/app/register.tsx
 *
 * Cambio bajo prueba (93.3, base): handle_user_submit debe dejar de llamar
 * `signUp` (context) + `record_signup_consents` y en su lugar llamar
 * `register_user` (EF `register`, 93.2).
 *
 * Cambio bajo prueba (72.3 — RENEGOCIADO, reemplaza el contrato post-éxito de
 * 93.3): GoTrue ya NO auto-confirma la cuenta (email_confirm:false en la EF),
 * así que el auto-login (`signIn`) tras el éxito de `register_user` YA NO
 * ocurre (GoTrue rechazaría el password grant con email_not_confirmed). El
 * flujo correcto es: éxito → `send_verification_email(email)` →
 * `router.replace({ pathname: '/verify-email', params: { email } })`. El modo
 * 'agent' (invitación, auto-login SÍ vigente porque redeem_invitation
 * confirma el email a propósito) NO cambia (EC-6, no-regresión).
 *
 * Reusa el armazón de mocks de login-submit.test.tsx (useAuth, expo-router,
 * SafeAreaView) — misma convención RNTL v14 + React 19 (render async, act,
 * drain de microtareas antes de un assert que va a fallar).
 *
 * `LocationFields` se reemplaza por un stub de 2 Pressables: es un componente
 * de UI ajeno al SUT (carga estados/municipios de Supabase) — mockearlo evita
 * acoplar este test a esa carga async, que no es lo que se está probando aquí.
 *
 * EDGE CASES (RED):
 *
 * ### Happy path
 * - EC-1: submit válido (todo lleno, 3 consentimientos aceptados) → register_user
 *   llamado UNA vez con el payload EXACTO (email trim, phone E.164, date_of_birth
 *   YYYY-MM-DD, state_id/municipality_id del picker, first_name/last_name
 *   partidos del nombre completo) y, tras éxito, send_verification_email
 *   llamado con el email trim + router.replace hacia /verify-email con param
 *   email; signIn y signUp (context) NUNCA se llaman.
 *
 * ### Validación local (gate antes de llamar a la red)
 * - EC-2: falta un consentimiento (whatsapp) → register_user NO se llama (0 veces)
 *   y se ve el mensaje de consentimientos obligatorios.
 * - EC-7 (RED mini, hallazgo del guardián): nombre de una sola palabra ("Ana",
 *   sin apellido) → register_user NO se llama; se ve 'Escribe tu nombre y
 *   apellido'. La EF exige last_name no vacío y el submit ahora lo manda
 *   incondicional — sin este gate local, el usuario ve un 400 INVALID_INPUT
 *   genérico sin saber qué corregir.
 *
 * ### Errores de negocio de la EF → mensaje ES ya definido en el repo
 * - EC-3: PHONE_TAKEN → mensaje EXACTO de auth-errors.ts (MSG_PHONE_TAKEN)
 * - EC-4: EMAIL_ALREADY_EXISTS → mensaje EXACTO de registration-errors.ts (MESSAGES.EMAIL_ALREADY_EXISTS)
 * - EC-5: UNDERAGE → mensaje EXACTO de validation.ts (validate_birthdate, MINIMUM_AGE=18)
 *
 * ### No-regresión — modo 'agent' sin cambios
 * - EC-6: el flujo de agente (código → redeem_invitation → signIn) sigue intacto;
 *   register_user NO se usa en este modo.
 */
import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los mocks (los jest.mock de abajo se hoistean)
// ---------------------------------------------------------------------------
import RegisterScreen from '../../../../app/register';

// ---------------------------------------------------------------------------
// Mock de useAuth
// ---------------------------------------------------------------------------
const mock_sign_in = jest.fn();
const mock_sign_up = jest.fn();

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    session: null,
    user: null,
    isLoading: false,
    signIn: mock_sign_in,
    signUp: mock_sign_up,
  }),
}));

// ---------------------------------------------------------------------------
// Mock de register_user / send_verification_email (../api.ts — 93.3 + 72.3)
// ---------------------------------------------------------------------------
const mock_register_user = jest.fn();
const mock_send_verification_email = jest.fn();

jest.mock('@/features/auth/api', () => ({
  register_user: (...args: unknown[]) => mock_register_user(...args),
  send_verification_email: (...args: unknown[]) => mock_send_verification_email(...args),
}));

// ---------------------------------------------------------------------------
// Mock de redeem_invitation/validate_invitation (flujo 'agent', no-regresión)
// ---------------------------------------------------------------------------
const mock_validate_invitation = jest.fn();
const mock_redeem_invitation = jest.fn();

jest.mock('@/features/registration/api', () => ({
  validate_invitation: (...args: unknown[]) => mock_validate_invitation(...args),
  redeem_invitation: (...args: unknown[]) => mock_redeem_invitation(...args),
}));

// ---------------------------------------------------------------------------
// Mock de LocationFields — stub de 2 Pressables (ajeno al SUT bajo prueba)
// ---------------------------------------------------------------------------
jest.mock('@/features/auth/components/location-fields', () => {
  const { Pressable, Text } = require('react-native');
  const ReactLib = require('react');
  return {
    LocationFields: (props: {
      on_change_state: (id: string) => void;
      on_change_municipality: (id: string) => void;
    }) =>
      ReactLib.createElement(
        ReactLib.Fragment,
        null,
        ReactLib.createElement(
          Pressable,
          {
            testID: 'signup-state',
            accessibilityRole: 'button',
            onPress: () => props.on_change_state('14'),
          },
          ReactLib.createElement(Text, null, 'Jalisco'),
        ),
        ReactLib.createElement(
          Pressable,
          {
            testID: 'signup-municipality',
            accessibilityRole: 'button',
            onPress: () => props.on_change_municipality('14039'),
          },
          ReactLib.createElement(Text, null, 'Guadalajara'),
        ),
      ),
  };
});

// ---------------------------------------------------------------------------
// Mock de expo-router
// ---------------------------------------------------------------------------
const mock_router_replace = jest.fn();

jest.mock('expo-router', () => {
  const { Text } = require('react-native');
  const ReactLib = require('react');
  return {
    useRouter: () => ({ replace: mock_router_replace, push: jest.fn(), back: jest.fn() }),
    Link: ({ children }: { children: React.ReactNode }) =>
      ReactLib.createElement(Text, null, children),
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
// Mock de @/lib/supabase/client — solo lo que register.tsx usa hoy
// (supabase.auth.getSession, del record_signup_consents que esta subtarea retira)
// ---------------------------------------------------------------------------
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const VALID = {
  full_name: 'Juan Pérez',
  phone: '3312345678',
  phone_e164: '+523312345678',
  birthdate: '2000-01-15',
  email: '  nuevo@urbea.mx  ',
  email_trimmed: 'nuevo@urbea.mx',
  password: 'Secreto123',
};

type RenderResult = Awaited<ReturnType<typeof render>>;

async function drain_react_updates() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function fill_valid_user_form(
  q: RenderResult,
  accept_whatsapp = true,
  full_name: string = VALID.full_name,
) {
  await act(async () => {
    fireEvent.changeText(q.getByTestId('signup-name'), full_name);
    fireEvent.changeText(q.getByTestId('signup-phone'), VALID.phone);
    fireEvent.changeText(q.getByTestId('signup-birthdate'), VALID.birthdate);
    fireEvent.press(q.getByTestId('signup-state'));
    fireEvent.press(q.getByTestId('signup-municipality'));
    fireEvent.changeText(q.getByTestId('signup-email'), VALID.email);
    fireEvent.changeText(q.getByTestId('signup-password'), VALID.password);
    fireEvent.changeText(q.getByTestId('signup-confirm'), VALID.password);
    fireEvent.press(q.getByTestId('signup-accept-terms'));
    fireEvent.press(q.getByTestId('signup-accept-privacy'));
    if (accept_whatsapp) fireEvent.press(q.getByTestId('signup-accept-whatsapp'));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_sign_in.mockResolvedValue(undefined);
  mock_send_verification_email.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

// ===========================================================================
// EC-1: submit válido → register_user con el payload exacto, luego
//       send_verification_email + router.replace a /verify-email (72.3);
//       signIn/signUp (context) nunca se llaman.
// ===========================================================================
describe('EC-1: submit_valido_llama_register_user_y_luego_send_verification_email', () => {
  it('register_user recibe el payload normalizado; tras éxito llama send_verification_email(email) y navega a /verify-email con el email; signIn/signUp NO se usan', async () => {
    mock_register_user.mockResolvedValue({ ok: true, user_id: 'uuid-93' });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<RegisterScreen />);
    });

    await fill_valid_user_form(q);

    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /crear cuenta/i }));
    });
    await drain_react_updates();

    expect(mock_register_user).toHaveBeenCalledTimes(1);
    expect(mock_register_user).toHaveBeenCalledWith({
      email: VALID.email_trimmed,
      password: VALID.password,
      first_name: 'Juan',
      last_name: 'Pérez',
      phone: VALID.phone_e164,
      date_of_birth: VALID.birthdate,
      state_id: '14',
      municipality_id: '14039',
    });

    expect(mock_send_verification_email).toHaveBeenCalledTimes(1);
    expect(mock_send_verification_email).toHaveBeenCalledWith(VALID.email_trimmed);

    expect(mock_router_replace).toHaveBeenCalledWith({
      pathname: '/verify-email',
      params: { email: VALID.email_trimmed },
    });

    // GoTrue rechazaría el password grant sin email confirmado (72.3) — ya no
    // hay auto-login en el modo 'user'. El wiring viejo (signUp de context)
    // tampoco debe usarse.
    expect(mock_sign_in).not.toHaveBeenCalled();
    expect(mock_sign_up).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// EC-2: falta un consentimiento → register_user NO se llama
// ===========================================================================
describe('EC-2: sin_los_tres_consentimientos_no_llama_register_user', () => {
  it('whatsapp sin aceptar → register_user NO se llama; se ve el mensaje de consentimientos', async () => {
    mock_register_user.mockResolvedValue({ ok: true, user_id: 'uuid-93' });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<RegisterScreen />);
    });

    await fill_valid_user_form(q, /* accept_whatsapp */ false);

    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /crear cuenta/i }));
    });
    await drain_react_updates();

    expect(mock_register_user).not.toHaveBeenCalled();
    expect(q.queryByText('Debes aceptar los tres para crear tu cuenta')).not.toBeNull();
  });
});

// ===========================================================================
// EC-7 (RED mini, hallazgo del guardián): nombre de una sola palabra → la EF
// exige last_name no vacío (ahora se manda incondicional) — el gate LOCAL debe
// exigir nombre y apellido ANTES de llamar a register_user, con el mismo
// mensaje que fija validate_full_name (ver validation.test.ts).
// ===========================================================================
describe('EC-7: nombre_de_una_sola_palabra_no_llama_register_user', () => {
  it('"Ana" (sin apellido) → mensaje de validación visible; register_user NO se llama', async () => {
    mock_register_user.mockResolvedValue({ ok: true, user_id: 'uuid-93' });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<RegisterScreen />);
    });

    await fill_valid_user_form(q, /* accept_whatsapp */ true, /* full_name */ 'Ana');

    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /crear cuenta/i }));
    });
    await drain_react_updates();

    expect(mock_register_user).not.toHaveBeenCalled();
    expect(q.queryByText('Escribe tu nombre y apellido')).not.toBeNull();
  });
});

// ===========================================================================
// EC-3: PHONE_TAKEN → mensaje EXACTO ya definido en auth-errors.ts
// ===========================================================================
describe('EC-3: register_user_PHONE_TAKEN_muestra_mensaje_de_telefono_duplicado', () => {
  it('error PHONE_TAKEN → mensaje EXACTO de MSG_PHONE_TAKEN visible en pantalla', async () => {
    mock_register_user.mockResolvedValue({ ok: false, code: 'PHONE_TAKEN' });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<RegisterScreen />);
    });

    await fill_valid_user_form(q);
    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /crear cuenta/i }));
    });
    await drain_react_updates();

    expect(
      q.queryByText(
        'Ese teléfono ya está registrado en otra cuenta. Usa uno distinto o inicia sesión.',
      ),
    ).not.toBeNull();
    expect(mock_sign_in).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// EC-4: EMAIL_ALREADY_EXISTS → mensaje EXACTO ya definido en registration-errors.ts
// ===========================================================================
describe('EC-4: register_user_EMAIL_ALREADY_EXISTS_muestra_mensaje_de_correo_duplicado', () => {
  it('error EMAIL_ALREADY_EXISTS → mensaje EXACTO de MESSAGES.EMAIL_ALREADY_EXISTS visible', async () => {
    mock_register_user.mockResolvedValue({ ok: false, code: 'EMAIL_ALREADY_EXISTS' });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<RegisterScreen />);
    });

    await fill_valid_user_form(q);
    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /crear cuenta/i }));
    });
    await drain_react_updates();

    expect(
      q.queryByText('Ya existe una cuenta con este correo. Inicia sesión.'),
    ).not.toBeNull();
    expect(mock_sign_in).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// EC-5: UNDERAGE → mensaje EXACTO ya definido en validation.ts (validate_birthdate)
// ===========================================================================
describe('EC-5: register_user_UNDERAGE_muestra_mensaje_de_mayoria_de_edad', () => {
  it('error UNDERAGE → mensaje EXACTO "Debes tener al menos 18 años para registrarte" visible', async () => {
    mock_register_user.mockResolvedValue({ ok: false, code: 'UNDERAGE' });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<RegisterScreen />);
    });

    // Formulario válido del lado cliente (>=18) — la EF es la que responde
    // UNDERAGE (p.ej. discrepancia de reloj cliente/servidor); esto aísla el
    // mapeo de error del gate de validación local (EC-2 ya cubre ese gate).
    await fill_valid_user_form(q);
    await act(async () => {
      fireEvent.press(q.getByRole('button', { name: /crear cuenta/i }));
    });
    await drain_react_updates();

    expect(
      q.queryByText('Debes tener al menos 18 años para registrarte'),
    ).not.toBeNull();
    expect(mock_sign_in).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// EC-6: no-regresión — modo 'agent' sigue igual (redeem_invitation + signIn)
// ===========================================================================
describe('EC-6: modo_agent_sin_cambios_no_usa_register_user', () => {
  it('código de invitación → redeem_invitation + signIn; register_user NUNCA se llama', async () => {
    mock_validate_invitation.mockResolvedValue({ ok: true, agency_name: 'Urbea Demo' });
    mock_redeem_invitation.mockResolvedValue({
      ok: true,
      user_id: 'agent-uuid',
      agency_id: 'agencia-1',
      agency_name: 'Urbea Demo',
      agency_member_id: 'member-1',
    });

    let q!: RenderResult;
    await act(async () => {
      q = await render(<RegisterScreen />);
    });

    await act(async () => {
      fireEvent.press(q.getByText('Regístrate como agente'));
    });

    await act(async () => {
      fireEvent.changeText(q.getByTestId('register-code'), 'CODIGO123');
      fireEvent.press(q.getByRole('button', { name: /validar código/i }));
    });
    await drain_react_updates();

    await act(async () => {
      fireEvent.changeText(q.getByTestId('register-first-name'), 'Ana');
      fireEvent.changeText(q.getByTestId('register-last-name'), 'García');
      fireEvent.changeText(q.getByTestId('register-email'), 'agente@urbea.mx');
      fireEvent.changeText(q.getByTestId('register-password'), 'Secreto123');
      fireEvent.press(q.getByRole('button', { name: /crear cuenta/i }));
    });
    await drain_react_updates();

    expect(mock_redeem_invitation).toHaveBeenCalledTimes(1);
    expect(mock_sign_in).toHaveBeenCalledWith('agente@urbea.mx', 'Secreto123');
    expect(mock_register_user).not.toHaveBeenCalled();
  });
});
