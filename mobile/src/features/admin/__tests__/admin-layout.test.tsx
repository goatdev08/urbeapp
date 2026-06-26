/**
 * Tests — AdminLayout (mobile/src/features/admin/admin-layout.tsx)
 * Subtarea 7.1 — Create admin layout with role guard
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### isLoading=true (prioridad absoluta)
 * - EC-AL1: isLoading=true, session=null, user=null        → loading indicator; NO redirect; NO slot.
 * - EC-AL2: isLoading=true, session=<obj>, role='admin'    → loading indicator; NO slot prematuramente.
 *
 * ### Sin sesión
 * - EC-AL3: isLoading=false, session=null                  → Redirect href="/login"; NO slot; NO loading.
 *
 * ### Sesión activa, rol no-admin
 * - EC-AL4: isLoading=false, session=<obj>, role='agent'   → Redirect href="/(protected)"; NO slot.
 * - EC-AL5: isLoading=false, session=<obj>, role='user'    → Redirect href="/(protected)"; NO slot.
 * - EC-AL6: isLoading=false, session=<obj>, user=null      → Redirect href="/(protected)"; NO slot.
 *
 * ### Happy path — admin
 * - EC-AL7: isLoading=false, session=<obj>, role='admin'   → Slot; NO redirect; NO loading.
 *
 * ### Transición de estado
 * - EC-AL8: re-render role='user'→'admin' (isLoading=false) → Redirect desaparece; Slot aparece.
 */

import React from 'react';
import { render, act, cleanup } from '@testing-library/react-native';
import type { Session } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mocks — declarados ANTES de importar el SUT
// ---------------------------------------------------------------------------

type UserRole = 'user' | 'agent' | 'admin';

const mock_use_auth_state: {
  session: Session | null;
  user: { role: UserRole } | null;
  isLoading: boolean;
} = {
  session: null,
  user: null,
  isLoading: true,
};

jest.mock('@/features/auth/context', () => ({
  useAuth: () => ({
    session: mock_use_auth_state.session,
    user: mock_use_auth_state.user,
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
// SUT — importado DESPUÉS de los mocks
// ---------------------------------------------------------------------------
import AdminLayout from '../admin-layout';

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
      email: 'admin@urbea.mx',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00Z',
    },
  } as unknown as Session;
}

function make_user(role: UserRole) {
  return { role };
}

// ---------------------------------------------------------------------------
// Tipo del resultado de render (RNTL v14 render es async)
// ---------------------------------------------------------------------------
type RenderResult = Awaited<ReturnType<typeof render>>;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  captured_redirect_href = null;
  mock_use_auth_state.session = null;
  mock_use_auth_state.user = null;
  mock_use_auth_state.isLoading = true;
});

afterEach(() => {
  cleanup();
});

// ===========================================================================
// EC-AL1: isLoading=true, session=null → loading indicator
// ===========================================================================

describe('EC-AL1: cargando_sin_sesion_muestra_indicador', () => {
  it('isLoading=true, session=null → loading-indicator presente; redirect ausente; slot ausente', async () => {
    mock_use_auth_state.isLoading = true;
    mock_use_auth_state.session = null;
    mock_use_auth_state.user = null;

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    expect(q.getByTestId('loading-indicator')).toBeTruthy();
    expect(q.queryByTestId('redirect-component')).toBeNull();
    expect(q.queryByTestId('slot-content')).toBeNull();
  });
});

// ===========================================================================
// EC-AL2: isLoading=true con session+rol admin → sigue mostrando loading (no slot prematuro)
// ===========================================================================

describe('EC-AL2: cargando_con_sesion_admin_no_renderiza_prematuramente', () => {
  it('isLoading=true, session=<obj>, role=admin → loading-indicator; NO slot prematuro', async () => {
    mock_use_auth_state.isLoading = true;
    mock_use_auth_state.session = make_session('uid-revalidating');
    mock_use_auth_state.user = make_user('admin');

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    expect(q.getByTestId('loading-indicator')).toBeTruthy();
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('redirect-component')).toBeNull();
  });
});

// ===========================================================================
// EC-AL3: isLoading=false, session=null → Redirect a /login
// ===========================================================================

describe('EC-AL3: sin_sesion_resuelta_redirige_a_login', () => {
  it('isLoading=false, session=null → Redirect href="/login"; NO slot; NO loading', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = null;
    mock_use_auth_state.user = null;

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(q.getByTestId('redirect-href').props.children).toBe('/login');
    expect(captured_redirect_href).toBe('/login');
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('loading-indicator')).toBeNull();
  });
});

// ===========================================================================
// EC-AL4: isLoading=false, session=<obj>, role='agent' → Redirect a /(protected)
// ===========================================================================

describe('EC-AL4: sesion_con_rol_agent_redirige_a_protected', () => {
  it('isLoading=false, session=<obj>, role=agent → Redirect href="/(protected)"; NO slot', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session('uid-agent');
    mock_use_auth_state.user = make_user('agent');

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(q.getByTestId('redirect-href').props.children).toBe('/(protected)');
    expect(captured_redirect_href).toBe('/(protected)');
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('loading-indicator')).toBeNull();
  });
});

// ===========================================================================
// EC-AL5: isLoading=false, session=<obj>, role='user' → Redirect a /(protected)
// ===========================================================================

describe('EC-AL5: sesion_con_rol_user_redirige_a_protected', () => {
  it('isLoading=false, session=<obj>, role=user → Redirect href="/(protected)"; NO slot', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session('uid-user');
    mock_use_auth_state.user = make_user('user');

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(q.getByTestId('redirect-href').props.children).toBe('/(protected)');
    expect(captured_redirect_href).toBe('/(protected)');
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('loading-indicator')).toBeNull();
  });
});

// ===========================================================================
// EC-AL6: isLoading=false, session=<obj>, user=null → Redirect a /(protected)
// (user=null: fetch del perfil falló; no se puede confirmar rol admin)
// ===========================================================================

describe('EC-AL6: sesion_sin_perfil_redirige_a_protected', () => {
  it('isLoading=false, session=<obj>, user=null → Redirect href="/(protected)"; NO slot', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session('uid-no-profile');
    mock_use_auth_state.user = null;

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(q.getByTestId('redirect-href').props.children).toBe('/(protected)');
    expect(captured_redirect_href).toBe('/(protected)');
    expect(q.queryByTestId('slot-content')).toBeNull();
    expect(q.queryByTestId('loading-indicator')).toBeNull();
  });
});

// ===========================================================================
// EC-AL7: Happy path — isLoading=false, session=<obj>, role='admin' → Slot
// ===========================================================================

describe('EC-AL7: admin_autenticado_renderiza_slot', () => {
  it('isLoading=false, session válida, role=admin → slot-content; NO redirect; NO loading', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session('uid-admin');
    mock_use_auth_state.user = make_user('admin');

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    expect(q.getByTestId('slot-content')).toBeTruthy();
    expect(q.queryByTestId('redirect-component')).toBeNull();
    expect(q.queryByTestId('loading-indicator')).toBeNull();
  });
});

// ===========================================================================
// EC-AL8: Transición role='user'→'admin' (isLoading=false) → Redirect desaparece; Slot aparece
// ===========================================================================

describe('EC-AL8: transicion_user_a_admin_deja_de_redirigir', () => {
  it('re-render: role user→admin (isLoading=false) → Redirect desaparece; Slot aparece', async () => {
    // Estado inicial: sesión activa pero rol 'user'
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session('uid-promoted');
    mock_use_auth_state.user = make_user('user');

    let q!: RenderResult;
    await act(async () => { q = await render(<AdminLayout />); });

    // Estado 1: debe redirigir a (protected)
    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(q.queryByTestId('slot-content')).toBeNull();

    // Transición: el usuario es promovido a admin
    mock_use_auth_state.user = make_user('admin');

    await act(async () => {
      q.rerender(<AdminLayout />);
    });

    // Estado 2: Redirect debe haber desaparecido
    expect(q.queryByTestId('redirect-component')).toBeNull();

    // Estado 2: Slot debe haberse renderizado
    expect(q.getByTestId('slot-content')).toBeTruthy();
  });
});
