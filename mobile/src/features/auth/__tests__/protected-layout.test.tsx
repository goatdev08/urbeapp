/**
 * Tests fase RED — ProtectedLayout (mobile/src/features/auth/protected-layout.tsx)
 * Subtarea 2.5 — Create protected route wrapper and auth state listener for navigation
 *
 * PATRÓN EXPO ROUTER SDK 56 CONFIRMADO EN DOCS:
 * El patrón canónico de SDK 56 usa Stack.Protected con prop `guard` en app/_layout.tsx.
 * ProtectedLayout encapsula la lógica de decisión (isLoading/session) con <Redirect> +
 * <Slot /> para ser unit-testeable de forma aislada. El GREEN de app/(protected)/_layout.tsx
 * será un thin wrapper. <Redirect> sigue exportado por expo-router en SDK 56 (aparece
 * en la tabla de APIs como "Link and Redirect components").
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - EC-PL1: isLoading=false, session=<objeto> → renderiza Slot; NO Redirect; NO loading.
 *
 * ### isLoading=true
 * - EC-PL2: isLoading=true, session=null → loading indicator; NO Redirect; NO Slot.
 * - EC-PL5: isLoading=true, session=<objeto> → loading indicator; NO Slot prematuramente.
 *
 * ### Sin sesión
 * - EC-PL3: isLoading=false, session=null → Redirect href="/login"; NO Slot; NO loading.
 *
 * ### Transición de estado
 * - EC-PL4: re-render session null→<objeto> (isLoading=false) → Redirect desaparece, Slot aparece.
 *
 * ### Boundary / no-crash
 * - EC-PL6: estado inicial (isLoading=true, session=null) → loading-indicator en árbol.
 * - EC-PL7: estado autenticado completo (isLoading=false, session=<Session>) → slot-content en árbol.
 */

import React from 'react';
import { render, act, cleanup } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// SUT — importado DESPUÉS de los mocks
// ---------------------------------------------------------------------------
import ProtectedLayout from '../protected-layout';

// ---------------------------------------------------------------------------
// Mocks — declarados ANTES de importar el SUT
// ---------------------------------------------------------------------------

// Estado controlable de useAuth por cada test
const mock_use_auth_state: {
  session: Session | null;
  isLoading: boolean;
} = {
  session: null,
  isLoading: true,
};

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    session: mock_use_auth_state.session,
    user: null,
    isLoading: mock_use_auth_state.isLoading,
    signIn: jest.fn(),
    signOut: jest.fn(),
  }),
}));

// Captura el href que recibe Redirect para poder asertar sobre él
let captured_redirect_href: string | null = null;

jest.mock('expo-router', () => {
  const { View, Text } = require('react-native');
  return {
    Redirect: ({ href }: { href: string }) => {
      captured_redirect_href = href;
      // Renderiza elementos con testID para poder asertar
      return (
        <View testID="redirect-component">
          <Text testID="redirect-href">{href}</Text>
        </View>
      );
    },
    Slot: () => <View testID="slot-content" />,
    Stack: () => <View testID="stack-content" />,
  };
});

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function make_session(user_id = 'uid-test-123'): Session {
  return {
    access_token: 'access_token_fake',
    refresh_token: 'refresh_token_fake',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: user_id,
      email: 'inquilino@urbea.mx',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00Z',
    },
  } as unknown as Session;
}

// ---------------------------------------------------------------------------
// Tipo del resultado de render resuelto (RNTL v14 render es async)
// ---------------------------------------------------------------------------
type RenderResult = Awaited<ReturnType<typeof render>>;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  captured_redirect_href = null;
  // Estado por defecto: cargando sin sesión (inicio de app)
  mock_use_auth_state.session = null;
  mock_use_auth_state.isLoading = true;
});

afterEach(() => {
  cleanup();
});

// ===========================================================================
// EC-PL1: Happy path — autenticado, carga resuelta → renderiza Slot
// ===========================================================================

describe('EC-PL1: autenticado_resuelto_renderiza_slot', () => {
  it('isLoading=false, session válida → renderiza slot-content; NO renderiza redirect; NO loading', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();

    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Debe renderizar el contenido protegido (Slot)
    expect(q.getByTestId('slot-content')).toBeTruthy();

    // NO debe renderizar el componente Redirect
    expect(q.queryByTestId('redirect-component')).toBeNull();

    // NO debe renderizar el indicador de carga
    expect(q.queryByTestId('loading-indicator')).toBeNull();
  });
});

// ===========================================================================
// EC-PL2: isLoading=true, session=null → loading indicator, sin Redirect, sin Slot
// ===========================================================================

describe('EC-PL2: cargando_sin_sesion_muestra_indicador', () => {
  it('isLoading=true, session=null → loading-indicator presente; redirect ausente; slot ausente', async () => {
    mock_use_auth_state.isLoading = true;
    mock_use_auth_state.session = null;

    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Debe mostrar el indicador de carga
    expect(q.getByTestId('loading-indicator')).toBeTruthy();

    // NO debe renderizar Redirect (no sabemos aún si hay sesión)
    expect(q.queryByTestId('redirect-component')).toBeNull();

    // NO debe renderizar el contenido protegido
    expect(q.queryByTestId('slot-content')).toBeNull();
  });
});

// ===========================================================================
// EC-PL3: isLoading=false, session=null → Redirect a /login
// ===========================================================================

describe('EC-PL3: sin_sesion_resuelta_redirige_a_login', () => {
  it('isLoading=false, session=null → Redirect con href="/login"; NO slot; NO loading', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = null;

    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Debe renderizar el componente Redirect
    expect(q.getByTestId('redirect-component')).toBeTruthy();

    // El href del Redirect debe ser exactamente '/login'
    expect(q.getByTestId('redirect-href').props.children).toBe('/login');

    // La variable capturada también debe ser '/login'
    expect(captured_redirect_href).toBe('/login');

    // NO debe renderizar el contenido protegido
    expect(q.queryByTestId('slot-content')).toBeNull();

    // NO debe renderizar indicador de carga
    expect(q.queryByTestId('loading-indicator')).toBeNull();
  });
});

// ===========================================================================
// EC-PL4: Transición session null → <objeto> con isLoading=false
// ===========================================================================

describe('EC-PL4: transicion_null_a_sesion_deja_de_redirigir', () => {
  it('re-render: session null→objeto (isLoading=false) → Redirect desaparece; Slot aparece', async () => {
    // Estado inicial: sin sesión, carga resuelta
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = null;

    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Estado 1: debe mostrar Redirect
    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(q.queryByTestId('slot-content')).toBeNull();

    // Transición: el usuario se autentica → useAuth ahora retorna session
    mock_use_auth_state.session = make_session('uid-post-login');

    await act(async () => {
      q.rerender(<ProtectedLayout />);
    });

    // Estado 2: Redirect debe haber desaparecido
    expect(q.queryByTestId('redirect-component')).toBeNull();

    // Estado 2: Slot debe haberse renderizado
    expect(q.getByTestId('slot-content')).toBeTruthy();
  });
});

// ===========================================================================
// EC-PL5: isLoading=true con session ya presente → sigue mostrando loading
// ===========================================================================

describe('EC-PL5: cargando_con_sesion_existente_no_renderiza_prematuramente', () => {
  it('isLoading=true, session=<objeto> → loading-indicator; NO renderiza slot prematuramente', async () => {
    // Race condition: session existe (de AsyncStorage) pero isLoading=true (re-validando)
    mock_use_auth_state.isLoading = true;
    mock_use_auth_state.session = make_session('uid-revalidating');

    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Debe seguir mostrando loading (isLoading tiene prioridad)
    expect(q.getByTestId('loading-indicator')).toBeTruthy();

    // NO debe renderizar el contenido protegido prematuramente
    expect(q.queryByTestId('slot-content')).toBeNull();

    // NO debe redirigir (no sabemos el estado final aún)
    expect(q.queryByTestId('redirect-component')).toBeNull();
  });
});

// ===========================================================================
// EC-PL6: Boundary — estado inicial válido → loading-indicator presente
// ===========================================================================

describe('EC-PL6: estado_inicial_muestra_loading_indicator', () => {
  it('isLoading=true, session=null (estado inicial de AuthProvider) → loading-indicator en árbol', async () => {
    mock_use_auth_state.isLoading = true;
    mock_use_auth_state.session = null;

    // La implementación real DEBE renderizar el loading-indicator en este estado.
    // El stub devuelve null → getByTestId lanza → FALLA en RED intencionalmente.
    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Aserción fuerte: debe existir el indicador de carga
    expect(q.getByTestId('loading-indicator')).toBeTruthy();
  });
});

// ===========================================================================
// EC-PL7: Boundary — estado autenticado completo → slot-content presente
// ===========================================================================

describe('EC-PL7: estado_autenticado_completo_muestra_slot', () => {
  it('isLoading=false, session=<Session completo> → slot-content en árbol', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session('uid-complete');

    // La implementación real DEBE renderizar el Slot en este estado.
    // El stub devuelve null → getByTestId lanza → FALLA en RED intencionalmente.
    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Aserción fuerte: debe existir el contenido protegido
    expect(q.getByTestId('slot-content')).toBeTruthy();
  });
});
