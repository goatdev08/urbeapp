/**
 * Tests fase RED — useAgentProfile expone `has_phone` (tarea #255)
 * Archivo SUT: mobile/src/features/profile/hooks/useAgentProfile.ts
 *
 * OBJETIVO DEL RED:
 *   El botón "Contactar por WhatsApp" del perfil público HOY decide con
 *   `phone` (users.phone), que RLS oculta para cualquier publicador
 *   role='admin' visto por un no-admin (#250, el caso de Vladimir en
 *   producción) — sin fila de users visible, sin phone, sin botón, aunque el
 *   publicador SÍ tenga teléfono capturado.
 *
 *   La vista `agent_public_profiles` YA expone `has_phone` (derivado,
 *   migración 20260905200003_identidad_publica_todos_los_roles.sql) sin
 *   necesidad de leer users.phone crudo — pero el hook hoy NO la pide (su
 *   query 2 solo selecciona `full_name, profile_photo_url`). Este archivo
 *   fija que `useAgentProfile` debe pedirla y exponerla en `data.has_phone`,
 *   sobreviviendo exactamente al escenario donde `users` es invisible por RLS.
 *
 * SEAM bajo prueba: la firma pública del hook (`UseAgentProfileState.data`),
 * ejercitada vía el mismo mock de `@/lib/supabase/client` que el resto de la
 * suite del hook (useAgentProfile.test.tsx) — nunca leyendo la tabla
 * directamente.
 *
 * NO se toca `types.ts` (AgentProfile no declara `has_phone` todavía — el
 * GREEN lo agrega): el cast local `as unknown as WithHasPhone` deja pasar
 * tsc sin tocar el archivo de producción; en runtime el objeto real SÍ trae
 * la propiedad, así que el assert corre contra el valor de verdad.
 *
 * EDGE CASES CUBIERTOS (2 casos, complementan los 6 EC de useAgentProfile.test.tsx):
 *   EC-HP1: has_phone=true en la vista Y users invisible por RLS (#250) ->
 *           data.has_phone === true.
 *   EC-HP2: has_phone=false en la vista -> data.has_phone === false (el hook
 *           no lo confunde con "sin dato"/undefined; es un boolean real).
 */

import { renderHook } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Import del SUT — DESPUÉS de todos los jest.mock()
// ---------------------------------------------------------------------------

import { useAgentProfile } from '../hooks/useAgentProfile';

// ---------------------------------------------------------------------------
// Mock de useFocusEffect (expo-router) — mismo patrón que useAgentProfile.test.tsx:
// invoca el callback una vez en mount vía useEffect (foco inicial).
// ---------------------------------------------------------------------------

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {

    const React = require('react');

    React.useEffect(() => {
      callback();
    }, [callback]);
  },
  useRouter: jest.fn().mockReturnValue({ back: jest.fn(), push: jest.fn() }),
  useLocalSearchParams: jest.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — mismo patrón `mock_supabase_holder` que
// useAgentProfile.test.tsx (getter sobre objeto mutable).
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

const TEST_AGENT_ID = 'agente-uuid-has-phone-test';

/**
 * Fábrica del mock — cadena `agent_public_profiles` con `has_phone` en la
 * respuesta (el shape que la vista YA devuelve tras 20260905200003). La
 * cadena `users` responde vacía (maybeSingle -> null): el caso #250 exacto.
 */
function make_supabase_mock(prefs_has_phone: boolean) {
  const user_result = { data: null, error: null };
  const prefs_result = {
    data: {
      full_name: 'Vladimir YEH',
      profile_photo_url: null,
      has_phone: prefs_has_phone,
    },
    error: null,
  };

  const mock_single = jest.fn().mockResolvedValue(user_result);
  const mock_eq_users = jest.fn().mockReturnValue({ maybeSingle: mock_single });
  const mock_select_users = jest.fn().mockReturnValue({ eq: mock_eq_users });

  const mock_maybe_single = jest.fn().mockResolvedValue(prefs_result);
  const mock_eq_prefs = jest.fn().mockReturnValue({ maybeSingle: mock_maybe_single });
  const mock_select_prefs = jest.fn().mockReturnValue({ eq: mock_eq_prefs });

  const mock_from = jest.fn().mockImplementation((table: string) => {
    if (table === 'users') return { select: mock_select_users };
    if (table === 'agent_public_profiles') return { select: mock_select_prefs };
    return {};
  });

  return { from: mock_from, _mock_select_prefs: mock_select_prefs };
}

/** Shape local de prueba — NO se agrega a mobile/src/features/profile/types.ts (GREEN). */
type WithHasPhone = { has_phone: boolean };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAgentProfile — has_phone (#255)', () => {
  it('(EC-HP1) has_phone_true_pese_a_users_invisible_por_rls: con users oculto por RLS (#250) y la vista con has_phone=true, data.has_phone es true', async () => {
    mock_supabase_holder.client = make_supabase_mock(true);

    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    const data = result.current.data as unknown as WithHasPhone | null;
    expect(data?.has_phone).toBe(true);
  });

  it('(EC-HP2) has_phone_false_no_se_confunde_con_undefined: cuando la vista trae has_phone=false, data.has_phone es EXACTAMENTE false (no undefined, no null)', async () => {
    mock_supabase_holder.client = make_supabase_mock(false);

    const { result } = await renderHook(() => useAgentProfile(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    const data = result.current.data as unknown as WithHasPhone | null;
    expect(data?.has_phone).toBe(false);
  });
});
