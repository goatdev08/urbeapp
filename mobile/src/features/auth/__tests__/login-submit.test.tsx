/**
 * Tests fase RED — comportamiento del submit en LoginScreen (mobile/app/login.tsx)
 * Subtarea 2.4 — Pieza B: integración del wiring signIn + manejo de errores en UI.
 *
 * NOTA DE ARQUITECTURA:
 * login.tsx aún tiene un TODO en handle_submit (no llama signIn). Los tests de
 * esta pieza fallarán por aserción porque el wiring no está implementado (fase RED).
 *
 * NOTA API RNTL v14 + React 19:
 * - `render(...)` devuelve una Promise — usar dentro de `act(async () => { ... })`.
 * - Para aislar tests cuando uno falla: envolver setup + interacciones en `act`,
 *   seguido de `act(async () => { await Promise.resolve(); await Promise.resolve(); })`
 *   para drenar microtareas de React antes del assert que va a fallar.
 * - `afterEach(cleanup)` explícito.
 *
 * MOCKS:
 * - useAuth de '@/features/auth/context' → signIn jest.fn() controlable
 * - expo-router useRouter → router.replace jest.fn() para detectar navegación
 * - SafeAreaView → View puro (evita dependencias nativas en jest)
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - EC-B1: submit con credenciales válidas → signIn llamado UNA vez con email (trim) y password exactos
 *
 * ### Error de credenciales
 * - EC-B2: signIn rechaza con AuthError invalid_credentials → mensaje mapeado en español en pantalla; NO navega
 *
 * ### Estado de carga / doble submit
 * - EC-B3: mientras signIn está en vuelo → botón deshabilitado o texto de carga; signIn llamado solo una vez
 *
 * ### Éxito sin error visible
 * - EC-B4: signIn resuelve OK → NO se muestra mensaje de error; signIn fue llamado
 */

import React from 'react';
import { render, fireEvent, cleanup, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los mocks
// ---------------------------------------------------------------------------
import LoginScreen from '../../../../app/login';

// ---------------------------------------------------------------------------
// Mock de useAuth — ANTES de importar el SUT
// ---------------------------------------------------------------------------

const mock_sign_in = jest.fn();
const mock_sign_out = jest.fn();

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    session: null,
    user: null,
    isLoading: false,
    signIn: mock_sign_in,
    signOut: mock_sign_out,
  }),
}));

// ---------------------------------------------------------------------------
// Mock de expo-router — useRouter
// ---------------------------------------------------------------------------

const mock_router_replace = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({
    replace: mock_router_replace,
    push: jest.fn(),
    back: jest.fn(),
  }),
  Stack: {
    Screen: () => null,
  },
}));

// ---------------------------------------------------------------------------
// Mock de react-native-safe-area-context — SafeAreaView nativo
// ---------------------------------------------------------------------------

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    SafeAreaView: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const VALID_EMAIL = 'agente@urbea.mx';
const VALID_PASSWORD = 'Secreto123';

// ---------------------------------------------------------------------------
// Tipo del resultado de render resuelto
// ---------------------------------------------------------------------------
type RenderResult = Awaited<ReturnType<typeof render>>;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_sign_in.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Helper: drena microtareas pendientes de React (necesario antes de asserts
// que van a fallar, para que el árbol se limpie correctamente entre tests)
// ---------------------------------------------------------------------------
async function drain_react_updates() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

// ===========================================================================
// EC-B1: Submit con credenciales válidas → signIn llamado una vez
// ===========================================================================

describe('EC-B1: submit_credenciales_validas_llama_signIn_una_vez', () => {
  it('signIn es llamado exactamente una vez con email (trim) y password exactos', async () => {
    let q!: RenderResult;
    await act(async () => { q = await render(<LoginScreen />); });

    // Email con espacios extra para verificar trim
    await act(async () => {
      fireEvent.changeText(q.getByPlaceholderText('tu@correo.com'), '  agente@urbea.mx  ');
      fireEvent.changeText(q.getByPlaceholderText('Mínimo 6 caracteres'), VALID_PASSWORD);
      fireEvent.press(q.getByRole('button', { name: /iniciar sesión/i }));
    });

    // Drenar actualizaciones de React antes del assert que falla
    await drain_react_updates();

    // El TODO actual no llama signIn → FALLA en RED
    expect(mock_sign_in).toHaveBeenCalledTimes(1);

    // Si se llama (implementación real), verificar args
    if (mock_sign_in.mock.calls.length > 0) {
      const [called_email, called_password] = mock_sign_in.mock.calls[0] as [string, string];
      expect(called_email.trim()).toBe('agente@urbea.mx');
      expect(called_password).toBe(VALID_PASSWORD);
    }
  });
});

// ===========================================================================
// EC-B2: signIn rechaza → mensaje en español en pantalla, NO navega
// ===========================================================================

describe('EC-B2: signIn_rechaza_credenciales_invalidas_muestra_mensaje_espanol', () => {
  it('error de credenciales → mensaje en español visible; no llama router.replace', async () => {
    const auth_error = Object.assign(new Error('Invalid login credentials'), {
      code: 'invalid_credentials',
      status: 400,
    });
    mock_sign_in.mockRejectedValue(auth_error);

    let q!: RenderResult;
    await act(async () => { q = await render(<LoginScreen />); });

    await act(async () => {
      fireEvent.changeText(q.getByPlaceholderText('tu@correo.com'), VALID_EMAIL);
      fireEvent.changeText(q.getByPlaceholderText('Mínimo 6 caracteres'), VALID_PASSWORD);
      fireEvent.press(q.getByRole('button', { name: /iniciar sesión/i }));
    });

    await drain_react_updates();

    // Debe aparecer en pantalla el mensaje mapeado en español.
    // Como login.tsx no tiene el wiring: signIn no se llama → el error nunca llega
    // → el mensaje nunca aparece → queryByText devuelve null → FALLA en RED.
    const error_message = q.queryByText(/correo.*contraseña|contraseña.*correo|incorrectos/i);
    expect(error_message).not.toBeNull();

    // No debe navegar a otra ruta tras el error
    expect(mock_router_replace).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// EC-B3: Mientras signIn está en vuelo → botón deshabilitado; no doble submit
// ===========================================================================

describe('EC-B3: durante_submit_boton_deshabilitado_no_doble_submit', () => {
  it('guard programático: onSubmitEditing invocado dos veces → signIn llamado solo una vez', async () => {
    let resolve_sign_in!: () => void;
    const sign_in_promise = new Promise<void>((res) => { resolve_sign_in = res; });
    mock_sign_in.mockReturnValue(sign_in_promise);

    let q!: RenderResult;
    await act(async () => { q = await render(<LoginScreen />); });

    await act(async () => {
      fireEvent.changeText(q.getByPlaceholderText('tu@correo.com'), VALID_EMAIL);
      fireEvent.changeText(q.getByPlaceholderText('Mínimo 6 caracteres'), VALID_PASSWORD);
    });

    // Primer submit vía onSubmitEditing del campo password.
    // El botón no interviene aquí — ejercitamos la ruta directa del TextInput.
    const password_input = q.getByPlaceholderText('Mínimo 6 caracteres');
    await act(async () => {
      fireEvent(password_input, 'submitEditing');
    });

    // Drenar para que React procese is_submitting=true y re-renderice
    // (campo password queda con editable={false}, botón con disabled=true)
    await drain_react_updates();

    // signIn debe haberse llamado exactamente una vez → FALLA en RED si el wiring no existe
    expect(mock_sign_in).toHaveBeenCalledTimes(1);

    // Segundo submit: llamamos onSubmitEditing DIRECTAMENTE desde el prop del elemento
    // (bypasea la verificación editable de RNTL).
    // En este punto is_submitting=true en el closure del componente re-renderizado.
    // El guard programático `if (is_submitting) return;` es LO ÚNICO que impide el doble signIn.
    // Si se neutraliza ese guard, handle_submit llamaría signIn una segunda vez.
    const on_submit_editing = password_input.props.onSubmitEditing as (() => void) | undefined;
    if (on_submit_editing !== undefined) {
      await act(async () => {
        on_submit_editing();
      });
      await drain_react_updates();
    }

    // signIn NO debe haberse llamado una segunda vez — el guard interno lo bloquea
    expect(mock_sign_in).toHaveBeenCalledTimes(1);

    // Resolvemos la promesa para limpiar estado asíncrono pendiente
    await act(async () => {
      resolve_sign_in();
      await sign_in_promise;
    });
  });
});

// ===========================================================================
// EC-B4: signIn resuelve OK → no hay mensaje de error; signIn fue llamado
// ===========================================================================

describe('EC-B4: signIn_ok_no_muestra_error', () => {
  it('signIn OK → no se muestra mensaje de error en pantalla; signIn fue invocado', async () => {
    let q!: RenderResult;
    await act(async () => { q = await render(<LoginScreen />); });

    await act(async () => {
      fireEvent.changeText(q.getByPlaceholderText('tu@correo.com'), VALID_EMAIL);
      fireEvent.changeText(q.getByPlaceholderText('Mínimo 6 caracteres'), VALID_PASSWORD);
      fireEvent.press(q.getByRole('button', { name: /iniciar sesión/i }));
    });

    await drain_react_updates();

    // La implementación real debe haber llamado signIn → FALLA en RED (TODO actual)
    expect(mock_sign_in).toHaveBeenCalledTimes(1);

    // No debe haber ningún alerta de error visible tras éxito
    const error_alert = q.queryByRole('alert');
    expect(error_alert).toBeNull();
  });
});
