/**
 * Tests fase RED — useAgentProfile hook (re-fetch-on-focus)
 * Archivo SUT: mobile/src/features/profile/hooks/useAgentProfile.ts
 * Subtarea Taskmaster: 22.5 — scope extra anti-stale (useFocusEffect)
 *
 * OBJETIVO DEL RED:
 *   Verificar que useAgentProfile re-fetcha los datos cuando la pantalla recupera
 *   el foco. HOY el hook usa useState + useEffect con dep [agent_id] — NO re-fetcha
 *   en focus. El test EC-2 (clave) falla en rojo por esta razón.
 *
 * FIRMA DEL HOOK (sin cambios esperados en la firma pública):
 *   useAgentProfile(agent_id: string): { loading: boolean; error: string | null; data: AgentProfile | null }
 *
 * PATRÓN DE MOCK:
 *   - @/lib/supabase/client: mock de módulo con getter sobre objeto mutable
 *     `mock_supabase_holder` (prefijado con "mock" — requerimiento de Jest para
 *     que el factory pueda referenciar la variable de módulo).
 *   - expo-router.useFocusEffect: captura el callback en `captured_focus_callback`;
 *     lo auto-invoca en mount (simula foco inicial). EC-2 lo invoca manualmente
 *     una segunda vez para simular refoco de pantalla.
 *   - Patrón `await renderHook(...)`: igual que useEditProfile.test.tsx (RNTL 14
 *     renderHook es async — devuelve Promise que estabiliza efectos).
 *
 * EDGE CASES CUBIERTOS (6 casos):
 *
 * ### Happy path
 * - EC-1: fetch_inicial_en_mount
 *
 * ### Edge cases del scope extra (re-fetch on focus) — RED
 * - EC-2: re_fetch_on_focus_invoca_queries_de_nuevo  ← FALLA HOY (rojo intencional)
 *
 * ### Ramas de reglas no obvias
 * - EC-3: prefs_null_no_rompe (usuario sin onboarding)
 * - EC-4: agency_null_no_rompe (agente independiente)
 *
 * ### Boundary / error
 * - EC-5: error_en_user_query_expone_error_y_data_null
 * - EC-6: agente_no_encontrado_expone_mensaje
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Import del SUT — DESPUÉS de todos los jest.mock()
// ---------------------------------------------------------------------------

import { useAgentProfile } from '../hooks/useAgentProfile';

// ---------------------------------------------------------------------------
// Mock de useFocusEffect (expo-router) — declarado ANTES de cualquier import.
//
// Estrategia:
//   1. `captured_focus_callback` almacena el callback que el hook pase a
//      useFocusEffect.
//   2. El mock imita la semántica REAL de useFocusEffect: el callback se invoca
//      UNA VEZ tras el commit (foco de mount) vía React.useEffect con dep [cb].
//      Como el SUT memoiza con useCallback([agent_id]), la identidad de `cb` es
//      estable — el useEffect solo corre en mount (= foco inicial).
//      NO se invoca síncronamente en cada render (eso era el defecto anterior).
//   3. En EC-2, el test invoca `captured_focus_callback()` manualmente para
//      simular que el usuario vuelve de EditProfile (re-foco real).
// ---------------------------------------------------------------------------

/** Callback registrado por el SUT en useFocusEffect. */
let captured_focus_callback: (() => void) | null = null;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    captured_focus_callback = callback;
    // Imita commit-once: el useEffect solo corre cuando `callback` cambia de
    // identidad (es decir, cuando agent_id cambia). En un foco real, React
    // Navigation llama el callback directamente; aquí lo modelamos con useEffect.
     
    const React = require('react');
     
    React.useEffect(() => {
      callback();
    }, [callback]);
  },
  useRouter: jest.fn().mockReturnValue({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: jest.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock del cliente Supabase
//
// `mock_supabase_holder` debe estar prefijado con "mock" (case-insensitive)
// para que Jest permita referenciarlo dentro del factory de jest.mock().
// El getter hace que cada acceso a `supabase` en el SUT lea el mock actual,
// incluso después de que beforeEach lo reemplace.
// ---------------------------------------------------------------------------

/** Holder mutable — beforeEach lo reemplaza con el mock apropiado por test. */
const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never, // se sobrescribe en beforeEach antes de cada test
};

jest.mock('@/lib/supabase/client', () => ({
  // Getter: cada acceso a `supabase` en el SUT resuelve el valor actual.
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

const TEST_AGENT_ID = 'agente-uuid-test-abc123';

const TEST_USER_DATA = {
  bio: 'Especialista en propiedades residenciales en CDMX',
  created_at: '2024-01-15T10:00:00Z',
  agencies: { name: 'Inmobiliaria Urbea SA' } as { name: string } | null,
};

const TEST_PREFS_DATA = {
  full_name: 'Carlos Mendoza Reyes',
  profile_photo_url: 'https://storage.supabase.co/profile-photos/carlos.jpg',
} as { full_name: string | null; profile_photo_url: string | null } | null;

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
//
// Recrea las cadenas builder que el hook usa:
//   from('users').select(...).eq('id', agent_id).single()
//   from('user_preferences').select(...).eq('user_id', agent_id).maybeSingle()
// ---------------------------------------------------------------------------

function make_supabase_mock(opts: {
  user_result?: { data: typeof TEST_USER_DATA | null; error: null | { message: string } };
  prefs_result?: {
    data: typeof TEST_PREFS_DATA | null;
    error: null | { message: string };
  };
} = {}) {
  const {
    user_result = { data: TEST_USER_DATA, error: null },
    prefs_result = { data: TEST_PREFS_DATA, error: null },
  } = opts;

  // Cadena users → single()
  const mock_single = jest.fn().mockResolvedValue(user_result);
  const mock_eq_users = jest.fn().mockReturnValue({ single: mock_single });
  const mock_select_users = jest.fn().mockReturnValue({ eq: mock_eq_users });

  // Cadena user_preferences → maybeSingle()
  const mock_maybe_single = jest.fn().mockResolvedValue(prefs_result);
  const mock_eq_prefs = jest.fn().mockReturnValue({ maybeSingle: mock_maybe_single });
  const mock_select_prefs = jest.fn().mockReturnValue({ eq: mock_eq_prefs });

  const mock_from = jest.fn().mockImplementation((table: string) => {
    if (table === 'users') return { select: mock_select_users };
    if (table === 'user_preferences') return { select: mock_select_prefs };
    return {};
  });

  return {
    from: mock_from,
    // Expuestos para aserciones directas
    _mock_from: mock_from,
    _mock_single: mock_single,
    _mock_maybe_single: mock_maybe_single,
    _mock_eq_users: mock_eq_users,
    _mock_eq_prefs: mock_eq_prefs,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  captured_focus_callback = null;
  mock_supabase_holder.client = make_supabase_mock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useAgentProfile', () => {
  // ── EC-1: Fetch inicial en mount ──────────────────────────────────────────

  it('(EC-1) fetch_inicial_en_mount: al montar, llama from("users") y from("user_preferences") y expone data con los campos del agente', async () => {
    // Patrón RNTL 14: await renderHook estabiliza efectos async antes de continuar.
    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    // Ambas queries deben haberse ejecutado
    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('users');
    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('user_preferences');
    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledTimes(2);

    // Estado final: sin error, con datos
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.full_name).toBe('Carlos Mendoza Reyes');
    expect(result.current.data?.profile_photo_url).toBe(
      'https://storage.supabase.co/profile-photos/carlos.jpg'
    );
    expect(result.current.data?.bio).toBe(TEST_USER_DATA.bio);
    expect(result.current.data?.agency_name).toBe('Inmobiliaria Urbea SA');
  });

  // ── EC-2: Re-fetch on focus ───────────────────────────────────────────────
  //
  // Flujo:
  //   1. Hook monta → useFocusEffect registra callback → mock lo captura y lo
  //      invoca una vez vía useEffect (foco de mount) → 2 queries (baseline).
  //   2. Test dispara captured_focus_callback() manualmente (= re-foco real tras
  //      volver de EditProfile) → SUT re-fetcha → 4 queries totales.
  //   3. Aserción: 4 > 2 → pasa por la razón correcta (re-fetch real, no artefacto).

  it('(EC-2) re_fetch_on_focus_invoca_queries_de_nuevo: cuando la pantalla recupera el foco, supabase.from se llama de nuevo (re-fetch anti-stale)', async () => {
    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    // Baseline: 2 queries en mount (users + user_preferences)
    expect(result.current.loading).toBe(false);
    const calls_tras_mount = mock_supabase_holder.client._mock_from.mock.calls.length;
    expect(calls_tras_mount).toBe(2);

    // Simula que la pantalla recupera el foco (usuario vuelve desde EditProfile).
    // HOY: captured_focus_callback es null → .?() es no-op → count no sube.
    await act(async () => {
      captured_focus_callback?.(); // no-op mientras el hook no use useFocusEffect
    });

    // ASSERTION RED: debe haber re-fetcheado tras el foco (count > baseline).
    // HOY falla: el hook no usa useFocusEffect → count sigue siendo 2.
    expect(mock_supabase_holder.client._mock_from.mock.calls.length).toBeGreaterThan(
      calls_tras_mount
    );
  });

  // ── EC-3: prefs null no rompe ─────────────────────────────────────────────

  it('(EC-3) prefs_null_no_rompe: si user_preferences devuelve null (usuario sin onboarding), full_name y profile_photo_url son null sin error', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      prefs_result: { data: null, error: null },
    });

    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.full_name).toBeNull();
    expect(result.current.data?.profile_photo_url).toBeNull();
    expect(result.current.data?.bio).toBe(TEST_USER_DATA.bio);
  });

  // ── EC-4: agency null no rompe ────────────────────────────────────────────

  it('(EC-4) agency_null_no_rompe: si el join de agencies devuelve null (agente independiente), agency_name es null sin error', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      user_result: {
        data: { ...TEST_USER_DATA, agencies: null },
        error: null,
      },
    });

    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.data).not.toBeNull();
    expect(result.current.data?.agency_name).toBeNull();
  });

  // ── EC-5: error en user query ─────────────────────────────────────────────

  it('(EC-5) error_en_user_query_expone_error_y_data_null: si la query de users retorna error, state.error != null y state.data === null', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      user_result: {
        data: null,
        error: { message: 'RLS denied: no tienes acceso a este perfil' },
      },
    });

    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('RLS denied: no tienes acceso a este perfil');
    expect(result.current.data).toBeNull();
  });

  // ── EC-6: agente no encontrado ────────────────────────────────────────────

  it('(EC-6) agente_no_encontrado_expone_mensaje: si user_data es null (agente inexistente), error = "Agente no encontrado" y data === null', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      user_result: { data: null, error: null },
    });

    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe('Agente no encontrado');
    expect(result.current.data).toBeNull();
  });
});
