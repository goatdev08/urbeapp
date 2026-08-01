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
 * - EC-PL7: estado autenticado completo (isLoading=false, session=<Session>) → stack-content en árbol.
 */

import React from 'react';
import { render, act, cleanup, fireEvent } from '@testing-library/react-native';
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

// Estado controlable de useLegalGate (#72.6). Se mockea el hook completo porque ya
// tiene su propia suite (useLegalGate.test.ts, 7 tests) — aquí lo que se prueba es la
// PRECEDENCIA de gates del layout, no la lógica del gate.
const mock_legal_gate_state: {
  pending: { doc_type: 'terms' | 'privacy'; version: string; terms_version_id: string }[];
  is_loading: boolean;
  error: string | null;
} = {
  pending: [],
  is_loading: false,
  error: null,
};

const mock_legal_refresh = jest.fn();

jest.mock('@/features/auth/hooks/useLegalGate', () => ({
  useLegalGate: () => ({
    pending: mock_legal_gate_state.pending,
    is_loading: mock_legal_gate_state.is_loading,
    error: mock_legal_gate_state.error,
    accept: jest.fn(),
    refresh: mock_legal_refresh,
  }),
}));

// El muro se sustituye por un marcador: su render no es lo que se prueba aquí.
jest.mock('@/features/auth/components/legal-wall', () => {
  const { View } = require('react-native');
  return { LegalWall: () => <View testID="legal-wall" /> };
});

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
    Slot: () => <View testID="stack-content" />,
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
      // 72.3: estas fixtures representan sesiones ya autenticadas y con
      // acceso al contenido protegido — confirmado, no el caso que
      // should_redirect_to_verify_email debe atrapar.
      email_confirmed_at: '2024-01-01T00:00:00Z',
    },
  } as unknown as Session;
}

/** Sesión con email SIN confirmar (72.3) — dispara should_redirect_to_verify_email. */
function make_unconfirmed_session(user_id = 'uid-unconfirmed'): Session {
  return {
    access_token: 'access_token_fake',
    refresh_token: 'refresh_token_fake',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id: user_id,
      email: 'sin-confirmar@urbea.mx',
      app_metadata: {},
      user_metadata: {},
      aud: 'authenticated',
      created_at: '2024-01-01T00:00:00Z',
      email_confirmed_at: null,
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
  // Gate legal al día por defecto: los tests preexistentes de auth no deben verse
  // afectados por el gate nuevo (#72.6).
  mock_legal_gate_state.pending = [];
  mock_legal_gate_state.is_loading = false;
  mock_legal_gate_state.error = null;
  mock_legal_refresh.mockClear();
});

afterEach(() => {
  cleanup();
});

// ===========================================================================
// EC-PL1: Happy path — autenticado, carga resuelta → renderiza Slot
// ===========================================================================

describe('EC-PL1: autenticado_resuelto_renderiza_slot', () => {
  it('isLoading=false, session válida → renderiza stack-content; NO renderiza redirect; NO loading', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();

    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Debe renderizar el contenido protegido (Slot)
    expect(q.getByTestId('stack-content')).toBeTruthy();

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
    expect(q.queryByTestId('stack-content')).toBeNull();
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
    expect(q.queryByTestId('stack-content')).toBeNull();

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
    expect(q.queryByTestId('stack-content')).toBeNull();

    // Transición: el usuario se autentica → useAuth ahora retorna session
    mock_use_auth_state.session = make_session('uid-post-login');

    await act(async () => {
      q.rerender(<ProtectedLayout />);
    });

    // Estado 2: Redirect debe haber desaparecido
    expect(q.queryByTestId('redirect-component')).toBeNull();

    // Estado 2: Slot debe haberse renderizado
    expect(q.getByTestId('stack-content')).toBeTruthy();
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
    expect(q.queryByTestId('stack-content')).toBeNull();

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
// EC-PL7: Boundary — estado autenticado completo → stack-content presente
// ===========================================================================

describe('EC-PL7: estado_autenticado_completo_muestra_slot', () => {
  it('isLoading=false, session=<Session completo> → stack-content en árbol', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session('uid-complete');

    // La implementación real DEBE renderizar el Slot en este estado.
    // El stub devuelve null → getByTestId lanza → FALLA en RED intencionalmente.
    let q!: RenderResult;
    await act(async () => { q = await render(<ProtectedLayout />); });

    // Aserción fuerte: debe existir el contenido protegido
    expect(q.getByTestId('stack-content')).toBeTruthy();
  });
});

// ===========================================================================
// #72.6 — Gate legal (PRD §5.5). Lo que se prueba aquí es la PRECEDENCIA de
// gates del layout; la lógica del gate vive en useLegalGate.test.ts.
//
// Orden esperado: isLoading de auth → sesión → gate legal → contenido.
// ===========================================================================

const PENDING_TERMS = [
  { doc_type: 'terms' as const, version: '2.0', terms_version_id: 'v-2-0' },
];

async function render_layout(): Promise<RenderResult> {
  let q!: RenderResult;
  await act(async () => {
    q = await render(<ProtectedLayout />);
  });
  return q;
}

describe('EC-PL8: gate_legal_con_pendientes_muestra_muro', () => {
  it('con sesión y documentos sin aceptar → muro legal, NO contenido protegido', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();
    mock_legal_gate_state.pending = PENDING_TERMS;

    const q = await render_layout();

    expect(q.queryByTestId('legal-wall')).not.toBeNull();
    expect(q.queryByTestId('stack-content')).toBeNull();
  });
});

describe('EC-PL9: gate_legal_al_dia_deja_pasar', () => {
  it('con sesión y sin pendientes → contenido protegido, sin muro', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();
    mock_legal_gate_state.pending = [];

    const q = await render_layout();

    expect(q.queryByTestId('legal-wall')).toBeNull();
    expect(q.queryByTestId('stack-content')).not.toBeNull();
  });
});

describe('EC-PL10: gate_legal_cargando_no_deja_pasar', () => {
  it('mientras el gate carga NO se renderiza el contenido protegido', async () => {
    // El caso que importa: dejar pasar "mientras carga" abriría justo la ventana
    // que el gate existe para cerrar.
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();
    mock_legal_gate_state.is_loading = true;

    const q = await render_layout();

    expect(q.queryByTestId('legal-gate-loading')).not.toBeNull();
    expect(q.queryByTestId('stack-content')).toBeNull();
    expect(q.queryByTestId('legal-wall')).toBeNull();
  });
});

describe('EC-PL11: gate_legal_con_error_falla_cerrado_con_reintento', () => {
  it('error de la RPC → NO deja pasar, ofrece reintentar', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();
    mock_legal_gate_state.error = 'connection timeout';
    mock_legal_gate_state.pending = [];

    const q = await render_layout();

    expect(q.queryByTestId('legal-gate-error')).not.toBeNull();
    expect(q.queryByTestId('legal-gate-retry')).not.toBeNull();
    // Lo esencial: no se cuela al contenido por un fallo de red.
    expect(q.queryByTestId('stack-content')).toBeNull();
  });

  it('el botón de reintentar vuelve a consultar el gate (no es un callejón sin salida)', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();
    mock_legal_gate_state.error = 'connection timeout';

    const q = await render_layout();
    await act(async () => {
      fireEvent.press(q.getByTestId('legal-gate-retry'));
    });

    expect(mock_legal_refresh).toHaveBeenCalled();
  });
});

describe('EC-PL12: precedencia_auth_sobre_gate_legal', () => {
  it('sin sesión, aunque haya pendientes legales, redirige a login (auth manda)', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = null;
    mock_legal_gate_state.pending = PENDING_TERMS;

    const q = await render_layout();

    expect(captured_redirect_href).toBe('/login');
    expect(q.queryByTestId('legal-wall')).toBeNull();
  });

  it('isLoading de auth manda sobre todo, incluido el gate legal', async () => {
    mock_use_auth_state.isLoading = true;
    mock_use_auth_state.session = null;
    mock_legal_gate_state.pending = PENDING_TERMS;

    const q = await render_layout();

    expect(q.queryByTestId('loading-indicator')).not.toBeNull();
    expect(q.queryByTestId('legal-wall')).toBeNull();
  });
});

// ===========================================================================
// #72.3 — Guard de email sin confirmar (should_redirect_to_verify_email).
// Orden de gates elegido: isLoading → sesión (login) → email confirmado
// (verify-email) → gate legal → contenido. El guard de verificación va ANTES
// del legal porque no tiene sentido pedirle aceptar términos a una cuenta que
// ni siquiera pudo demostrar ser dueña de su correo.
// ===========================================================================

describe('EC-PL13: sesion_sin_confirmar_redirige_a_verify_email', () => {
  it('email_confirmed_at null → Redirect con href="/verify-email"; NO slot; NO muro legal', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_unconfirmed_session();

    const q = await render_layout();

    expect(q.getByTestId('redirect-component')).toBeTruthy();
    expect(captured_redirect_href).toBe('/verify-email');
    expect(q.queryByTestId('stack-content')).toBeNull();
    expect(q.queryByTestId('legal-wall')).toBeNull();
  });

  it('precedencia: sesión sin confirmar Y gate legal con pendientes → gana /verify-email', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_unconfirmed_session();
    mock_legal_gate_state.pending = PENDING_TERMS;

    const q = await render_layout();

    expect(captured_redirect_href).toBe('/verify-email');
    expect(q.queryByTestId('legal-wall')).toBeNull();
    expect(q.queryByTestId('stack-content')).toBeNull();
  });

  it('sin sesión sigue ganando /login, aunque el guard de verificación exista', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = null;

    const q = await render_layout();

    expect(captured_redirect_href).toBe('/login');
  });

  it('sesión con email confirmado → NO redirige a verify-email (regresión, EC-PL1 ya lo cubre para el resto del árbol)', async () => {
    mock_use_auth_state.isLoading = false;
    mock_use_auth_state.session = make_session();

    const q = await render_layout();

    expect(captured_redirect_href).not.toBe('/verify-email');
    expect(q.getByTestId('stack-content')).toBeTruthy();
  });
});
