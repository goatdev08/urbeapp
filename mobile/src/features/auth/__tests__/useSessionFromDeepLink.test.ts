/**
 * Tests — useSessionFromDeepLink (mobile/src/features/auth/hooks/useSessionFromDeepLink.ts)
 * Subtarea 72.3 (verificación real de email). Añadidos post-guardian (V2:
 * hooks/** es footprint crítico — 0 cobertura sobre las líneas 42-68 era la
 * violación). Cubre lo que el guardian marcó: tokens → setSession + on_success,
 * error del proveedor → error_message sin on_success, setSession fallido →
 * error_message sin on_success, sin URL → no-op, y el guard `ignore` tras
 * unmount (no llamar on_success sobre un componente ya desmontado).
 *
 * Mocks de frontera: `expo-linking` (Linking.useURL, deep link nativo) y
 * `@/lib/supabase/client` (supabase.auth.setSession, llamada HTTP real a
 * GoTrue). `parse_session_from_url` NO se mockea — es un colaborador propio
 * ya cubierto en deep-link-session.test.ts, se ejercita con URLs reales,
 * mismo patrón que api.test.ts con extract_error_code.
 *
 * EDGE CASES:
 * - DL-1: URL con tokens → setSession con esos tokens exactos; on_success 1 vez.
 * - DL-6: URL de error (otp_expired) → error_message seteado; on_success NO se llama.
 * - SS-1: setSession resuelve con error → error_message seteado; on_success NO se llama.
 * - SS-2: sin URL (null) → no pasa nada (ni setSession ni on_success ni error_message).
 * - SS-3: unmount ANTES de que resuelva setSession → on_success NO se llama (guard `ignore`).
 */
import { act, renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — jest.fn() dentro del factory (evita hoisting), mismo patrón que
// useLegalGate.test.ts.
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Importamos el SUT y los mocks DESPUÉS de jest.mock
// ---------------------------------------------------------------------------
import { useURL } from 'expo-linking';
import { supabase } from '@/lib/supabase/client';
import { useSessionFromDeepLink } from '../hooks/useSessionFromDeepLink';

const mock_use_url = useURL as jest.MockedFunction<typeof useURL>;
const mock_set_session = supabase.auth.setSession as jest.MockedFunction<
  typeof supabase.auth.setSession
>;

const EXPIRED_LINK_MESSAGE = 'El enlace expiró, reenvía el correo';

/** Deja correr el setTimeout(0) de la rama de error + cualquier microtarea pendiente. */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// DL-1: tokens → setSession con los tokens exactos + on_success 1 vez
// ===========================================================================
describe('DL-1: url_con_tokens_llama_setSession_y_on_success', () => {
  it('setSession recibe access_token/refresh_token exactos; on_success se llama 1 vez', async () => {
    mock_use_url.mockReturnValue('urbea://verify-email#access_token=AT&refresh_token=RT');
    mock_set_session.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_set_session>>);
    const on_success = jest.fn();

    const { result } = await renderHook(() => useSessionFromDeepLink(on_success));
    await flush();

    expect(mock_set_session).toHaveBeenCalledTimes(1);
    expect(mock_set_session).toHaveBeenCalledWith({ access_token: 'AT', refresh_token: 'RT' });
    expect(on_success).toHaveBeenCalledTimes(1);
    expect(result.current.error_message).toBeNull();
  });
});

// ===========================================================================
// DL-6: URL de error del proveedor → error_message, sin on_success ni setSession
// ===========================================================================
describe('DL-6: url_de_error_expone_error_message_sin_on_success', () => {
  it('otp_expired → error_message = mensaje de enlace expirado; on_success y setSession NO se llaman', async () => {
    mock_use_url.mockReturnValue('urbea://verify-email#error=access_denied&error_code=otp_expired');
    const on_success = jest.fn();

    const { result } = await renderHook(() => useSessionFromDeepLink(on_success));
    await flush();

    expect(result.current.error_message).toBe(EXPIRED_LINK_MESSAGE);
    expect(on_success).not.toHaveBeenCalled();
    expect(mock_set_session).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// SS-1: setSession devuelve error → error_message, sin on_success
// ===========================================================================
describe('SS-1: setSession_con_error_expone_error_message_sin_on_success', () => {
  it('setSession {error} → error_message = mensaje de enlace expirado; on_success NO se llama', async () => {
    mock_use_url.mockReturnValue('urbea://verify-email#access_token=AT&refresh_token=RT');
    mock_set_session.mockResolvedValue({
      data: { session: null, user: null },
      error: new Error('invalid token'),
    } as unknown as Awaited<ReturnType<typeof mock_set_session>>);
    const on_success = jest.fn();

    const { result } = await renderHook(() => useSessionFromDeepLink(on_success));
    await flush();

    expect(result.current.error_message).toBe(EXPIRED_LINK_MESSAGE);
    expect(on_success).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// SS-2: sin URL → no-op total
// ===========================================================================
describe('SS-2: sin_url_no_hace_nada', () => {
  it('url null → no llama setSession ni on_success; error_message queda null', async () => {
    mock_use_url.mockReturnValue(null);
    const on_success = jest.fn();

    const { result } = await renderHook(() => useSessionFromDeepLink(on_success));
    await flush();

    expect(mock_set_session).not.toHaveBeenCalled();
    expect(on_success).not.toHaveBeenCalled();
    expect(result.current.error_message).toBeNull();
  });
});

// ===========================================================================
// SS-3: unmount antes de que resuelva setSession → on_success NO se llama
// ===========================================================================
describe('SS-3: unmount_antes_de_resolver_setSession_no_llama_on_success', () => {
  it('componente desmontado durante el await → el guard `ignore` evita on_success', async () => {
    mock_use_url.mockReturnValue('urbea://verify-email#access_token=AT&refresh_token=RT');
    let resolve_set_session!: (value: Awaited<ReturnType<typeof mock_set_session>>) => void;
    mock_set_session.mockReturnValue(
      new Promise((resolve) => {
        resolve_set_session = resolve;
      }) as ReturnType<typeof mock_set_session>,
    );
    const on_success = jest.fn();

    const { unmount } = await renderHook(() => useSessionFromDeepLink(on_success));
    // `await act(async () => unmount())`, no una llamada síncrona: la limpieza
    // de un efecto pasivo (passive effect) en React se agenda de forma
    // asíncrona — sin este await, el guard `ignore` corre DESPUÉS de que la
    // promesa ya resolvió (confirmado empíricamente con logs), justo la
    // condición de carrera que esta prueba busca cazar.
    await act(async () => {
      unmount();
    });
    resolve_set_session({
      data: { session: null, user: null },
      error: null,
    } as unknown as Awaited<ReturnType<typeof mock_set_session>>);
    await flush();

    expect(on_success).not.toHaveBeenCalled();
  });
});
