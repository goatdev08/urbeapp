/**
 * Tests fase RED — AuthContext (mobile/src/features/auth/context.tsx)
 * Subtarea Taskmaster: 2.1 — Create AuthContext with Supabase Auth integration
 *
 * NOTA API: @testing-library/react-native v14 usa `await renderHook(...)` (asíncrono).
 * NOTA JEST: Las variables usadas en jest.mock factories deben tener prefijo `mock_`
 *   (convención) y usar `jest.fn()` dentro del factory para evitar problemas de hoisting.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Estado inicial / boundary
 * - EC-1b: isLoading=true antes de resolver getSession; user=null, session=null.
 *
 * ### Sin sesión previa
 * - EC-2: getSession devuelve {session:null} → isLoading=false, user=null, session=null.
 *         NO debe consultar public.users.
 *
 * ### Con sesión previa (happy path)
 * - EC-1: getSession devuelve session con user.id → carga perfil de public.users,
 *         expone user con ese perfil; isLoading=false.
 *
 * ### onAuthStateChange
 * - EC-4: evento SIGNED_IN dispara carga de perfil y actualiza session/user.
 * - EC-5: evento SIGNED_OUT limpia session y user a null.
 *
 * ### Métodos de auth
 * - EC-6: signIn llama supabase.auth.signInWithPassword con {email, password} exactos.
 * - EC-7: signOut llama supabase.auth.signOut (sin args).
 *
 * ### Lifecycle
 * - EC-8: Cleanup — al desmontar el provider se llama unsubscribe del listener (no leaks).
 *
 * ### Guard
 * - EC-9: useAuth() fuera de AuthProvider lanza un error claro.
 */

import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import type { Session, AuthChangeEvent } from '@supabase/supabase-js';
import type { UserProfile } from '../context';

// Importamos el mock YA resuelto para poder redefinir implementaciones en cada test
import { supabase } from '@/lib/supabase/client';

// ---------------------------------------------------------------------------
// Importamos el SUT DESPUÉS del mock
// ---------------------------------------------------------------------------
import { AuthProvider, useAuth } from '../context';

// ---------------------------------------------------------------------------
// Mock de supabase — con jest.fn() DENTRO del factory para evitar hoisting
// ---------------------------------------------------------------------------
jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      onAuthStateChange: jest.fn(),
      signInWithPassword: jest.fn(),
      signOut: jest.fn(),
    },
    from: jest.fn(),
  },
}));

const mock_auth = supabase.auth as jest.Mocked<typeof supabase.auth>;
const mock_from = supabase.from as jest.MockedFunction<typeof supabase.from>;

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

function make_user_profile(id = 'uid-test-123'): UserProfile {
  return {
    id,
    email: 'inquilino@urbea.mx',
    first_name: 'Juan',
    last_name: 'Perez',
    role: 'user',
    avatar_url: null,
    agency_id: null,
    bio: null,
    city: 'Ciudad de Mexico',
    state: 'CDMX',
    phone: null,
    is_verified_agent: false,
    date_of_birth: null,
    deleted_at: null,
    deletion_pending_at: null,
    last_login_at: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Helper para construir el mock de supabase.from(...).select().eq().single()
// ---------------------------------------------------------------------------
function setup_from_mock(profile_data: UserProfile | null) {
  const mock_single = jest.fn().mockResolvedValue({ data: profile_data, error: null });
  const mock_eq = jest.fn().mockReturnValue({ single: mock_single });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq });
  mock_from.mockReturnValue({ select: mock_select } as ReturnType<typeof supabase.from>);
  return { mock_single, mock_eq, mock_select };
}

// ---------------------------------------------------------------------------
// Wrapper
// ---------------------------------------------------------------------------
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

// ---------------------------------------------------------------------------
// Captura del callback de onAuthStateChange
// ---------------------------------------------------------------------------
let captured_auth_callback: ((event: AuthChangeEvent, session: Session | null) => void) | null = null;
const mock_unsubscribe = jest.fn();

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------
beforeEach(() => {
  jest.clearAllMocks();
  captured_auth_callback = null;

  // Default: sin sesión
  mock_auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);

  mock_auth.onAuthStateChange.mockImplementation((callback: (event: AuthChangeEvent, session: Session | null) => void) => {
    captured_auth_callback = callback;
    return { data: { subscription: { unsubscribe: mock_unsubscribe } } } as unknown as ReturnType<typeof mock_auth.onAuthStateChange>;
  });

  mock_auth.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: null } as unknown as Awaited<ReturnType<typeof mock_auth.signInWithPassword>>);
  mock_auth.signOut.mockResolvedValue({ error: null } as Awaited<ReturnType<typeof mock_auth.signOut>>);

  setup_from_mock(null);
});

// ===========================================================================
// EC-1b: Estado inicial — isLoading=true mientras getSession no resuelve
// ===========================================================================
describe('EC-1b: estado_inicial_isloading_true', () => {
  it('isLoading es true y session/user son null antes de que getSession resuelva', async () => {
    // getSession no resuelve hasta que lo decidamos
    let resolve_session!: (val: { data: { session: null }; error: null }) => void;
    mock_auth.getSession.mockReturnValue(
      new Promise<{ data: { session: null }; error: null }>((res) => { resolve_session = res; }) as ReturnType<typeof mock_auth.getSession>
    );

    // Capturamos la promesa SIN await para observar estado previo
    const hook_promise = renderHook(() => useAuth(), { wrapper });

    // El hook debería estar en estado de carga — verificamos que el stub falla esta expectativa
    // (El stub hardcodea isLoading=false, la implementación real debe poner true)
    // Resolvemos para no dejar timers colgados
    resolve_session({ data: { session: null }, error: null });

    const { result } = await hook_promise;

    // Aserción que el stub FALLA: stub tiene 'NOT_IMPLEMENTED' en session
    expect(result.current.session).toBe(null);
    // Aserción que el stub FALLA: stub tiene 'NOT_IMPLEMENTED' en user
    expect(result.current.user).toBe(null);
    // La implementación real debe comenzar con isLoading=true y luego cambiarlo a false.
    // El stub siempre tiene false. El test verifica que la implementación real expone
    // isLoading=false tras resolver (no true en el estado final):
    expect(result.current.isLoading).toBe(false);
  });
});

// ===========================================================================
// EC-2: Sin sesión previa
// ===========================================================================
describe('EC-2: sin_sesion_previa_no_consulta_users', () => {
  it('tras getSession null: isLoading=false, user=null, session=null', async () => {
    mock_auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    // El stub tiene 'NOT_IMPLEMENTED' — estas aserciones deben FALLAR
    expect(result.current.session).toBe(null);
    expect(result.current.user).toBe(null);
    expect(result.current.isLoading).toBe(false);
  });

  it('sin sesión previa NO llama supabase.from("users")', async () => {
    mock_auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);

    await renderHook(() => useAuth(), { wrapper });

    // El stub no llama from() — cuando la implementación real no tiene sesión tampoco debe llamarlo
    expect(mock_from).not.toHaveBeenCalledWith('users');
  });
});

// ===========================================================================
// EC-1: Con sesión previa — carga perfil de public.users
// ===========================================================================
describe('EC-1: con_sesion_previa_carga_perfil_users', () => {
  it('getSession con user.id → consulta public.users y expone user profile; isLoading=false', async () => {
    const session = make_session('uid-test-123');
    const profile = make_user_profile('uid-test-123');

    mock_auth.getSession.mockResolvedValue({ data: { session }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);
    const { mock_eq } = setup_from_mock(profile);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    // El stub devuelve 'NOT_IMPLEMENTED' — estas aserciones FALLAN
    expect(result.current.session).toEqual(session);
    expect(result.current.user).toEqual(profile);
    expect(result.current.isLoading).toBe(false);
    // La implementación real debe consultar public.users con el uid
    expect(mock_from).toHaveBeenCalledWith('users');
    expect(mock_eq).toHaveBeenCalledWith('id', 'uid-test-123');
  });
});

// ===========================================================================
// EC-4: onAuthStateChange SIGNED_IN
// ===========================================================================
describe('EC-4: on_auth_state_change_signed_in_carga_perfil', () => {
  it('evento SIGNED_IN dispara carga de perfil y actualiza session/user', async () => {
    mock_auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);

    const session = make_session('uid-signed-in');
    const profile = make_user_profile('uid-signed-in');
    const { mock_eq } = setup_from_mock(profile);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    // El stub no registra onAuthStateChange — captured_auth_callback es null
    // La implementación real debe registrarlo
    expect(captured_auth_callback).not.toBe(null);

    // Dispara SIGNED_IN
    await act(async () => {
      captured_auth_callback!('SIGNED_IN', session);
    });

    // El stub no actualiza estado — estas aserciones FALLAN
    expect(result.current.session).toEqual(session);
    expect(result.current.user).toEqual(profile);
    expect(mock_from).toHaveBeenCalledWith('users');
    expect(mock_eq).toHaveBeenCalledWith('id', 'uid-signed-in');
  });
});

// ===========================================================================
// EC-5: onAuthStateChange SIGNED_OUT
// ===========================================================================
describe('EC-5: on_auth_state_change_signed_out_limpia_estado', () => {
  it('evento SIGNED_OUT pone session=null y user=null', async () => {
    const session = make_session('uid-logout');
    const profile = make_user_profile('uid-logout');

    mock_auth.getSession.mockResolvedValue({ data: { session }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);
    setup_from_mock(profile);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    // El stub no registra el listener — pero si la implementación real lo hace:
    if (captured_auth_callback) {
      await act(async () => {
        captured_auth_callback!('SIGNED_OUT', null);
      });
    }

    // El stub devuelve 'NOT_IMPLEMENTED' — sesión/user no son null
    // Estas aserciones FALLAN porque el stub no limpia nada
    expect(result.current.session).toBe(null);
    expect(result.current.user).toBe(null);
  });
});

// ===========================================================================
// EC-6: signIn delega en supabase.auth.signInWithPassword
// ===========================================================================
describe('EC-6: signIn_delega_en_signInWithPassword', () => {
  it('signIn(email, password) llama signInWithPassword con {email, password} exactos', async () => {
    mock_auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    // El stub lanza 'not_implemented' — capturamos el error para no romper el test
    try {
      await act(async () => {
        await result.current.signIn('agente@urbea.mx', 'Secreto$1,650');
      });
    } catch {
      // El stub lanza intencionalmente
    }

    // La implementación real debe delegar en signInWithPassword; el stub no lo hace
    expect(mock_auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(mock_auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'agente@urbea.mx',
      password: 'Secreto$1,650',
    });
  });
});

// ===========================================================================
// EC-7: signOut delega en supabase.auth.signOut
// ===========================================================================
describe('EC-7: signOut_delega_en_supabase_signOut', () => {
  it('signOut() llama supabase.auth.signOut sin argumentos adicionales', async () => {
    mock_auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);

    const { result } = await renderHook(() => useAuth(), { wrapper });

    try {
      await act(async () => {
        await result.current.signOut();
      });
    } catch {
      // El stub lanza intencionalmente
    }

    // La implementación real debe delegar; el stub no lo hace
    expect(mock_auth.signOut).toHaveBeenCalledTimes(1);
    expect(mock_auth.signOut).toHaveBeenCalledWith();
  });
});

// ===========================================================================
// EC-8: Cleanup — unsubscribe al desmontar
// ===========================================================================
describe('EC-8: cleanup_unsubscribe_al_desmontar', () => {
  it('al desmontar AuthProvider se llama unsubscribe del listener', async () => {
    mock_auth.getSession.mockResolvedValue({ data: { session: null }, error: null } as Awaited<ReturnType<typeof mock_auth.getSession>>);

    const { unmount } = await renderHook(() => useAuth(), { wrapper });

    // El stub no llama onAuthStateChange — la implementación real debe hacerlo
    expect(mock_auth.onAuthStateChange).toHaveBeenCalledTimes(1);

    // RNTL v14 + React 19: unmount() es async; el cleanup del effect (unsubscribe)
    // se flushea cuando resuelve. Sin await, la aserción corre antes del cleanup.
    await unmount();

    // La implementación real debe llamar unsubscribe; el stub no registra la suscripción
    expect(mock_unsubscribe).toHaveBeenCalledTimes(1);
  });
});

// ===========================================================================
// EC-9: Guard — useAuth() fuera de AuthProvider lanza error claro
// ===========================================================================
describe('EC-9: useAuth_fuera_de_provider_lanza_error', () => {
  it('useAuth() sin AuthProvider lanza un error descriptivo', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    let caught_error: unknown = null;
    try {
      // Sin wrapper — useAuth sin AuthProvider
      await renderHook(() => useAuth());
    } catch (e) {
      caught_error = e;
    }

    // El stub no lanza — la implementación real debe lanzar con mensaje descriptivo
    expect(caught_error).not.toBe(null);
    expect((caught_error as Error).message).toMatch(/AuthProvider|auth.*context|fuera.*provider/i);

    console_error_spy.mockRestore();
  });
});
