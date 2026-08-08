/**
 * Tests fase RED — useVideoEngagementEvents hook
 * Archivo SUT: mobile/src/features/feed/hooks/useVideoEngagementEvents.ts
 * Subtarea Taskmaster: 112.2 — captura en el feed: video_view y
 * video_completed con dedupe por sesión (parte crítica)
 *
 * SUT: useVideoEngagementEvents({ property_id, property_video_id, session_id, supabase?, store? })
 *        → { report_view: () => Promise<void>, report_time_update: (currentTime, duration) => Promise<void> }
 *
 * Contrato (contexto verificado en la subtarea 112, sin PRD § — feature
 * derivada de 75.2, origen usuario 2026-08-08):
 *   - Escritura DIRECTA a public.events_raw con RLS (mismo patrón que
 *     useLikeProperty/useSaveProperty), NUNCA vía Edge Function.
 *   - user_id SIEMPRE de useAuth(), nunca de parámetros externos.
 *   - report_view(): una sola fila `video_view` por (session_id, property_id).
 *   - report_time_update(currentTime, duration): al cruzar el umbral de
 *     compleción (>=95%), una sola fila `video_completed` por
 *     (session_id, property_id) — el feed reproduce en LOOP: timeUpdate
 *     dispara continuamente y SIN dedupe generaría cientos de filas +
 *     inflaría las estadísticas del agente con actividad falsa.
 *   - session_id distinto (nueva sesión de app) → sí vuelve a contar (insumo
 *     de "veces que volvió a ver").
 *   - Fire-and-forget: INSERT falla (offline, RLS) → NO rompe la
 *     reproducción (no lanza), pero el error se loggea, no se traga en
 *     silencio.
 *   - Un video a la mitad NO cuenta como completado; duration inválida
 *     (0/NaN mientras carga) tampoco marca completado ni truena.
 *   - Sin user autenticado → no intenta escribir.
 *
 * PATRÓN DE MOCK: idéntico a useLikeProperty.test.tsx / useSaveProperty.test.tsx
 *   - supabase inyectado como dep: useVideoEngagementEvents({ ..., supabase: mock })
 *   - useAuth() mockeado vía jest.mock
 *   - store inyectado (create_video_engagement_store real, NO mockeado): permite
 *     compartir estado de dedupe entre dos renderHook() (simula un remount del
 *     ítem del feed al volver a scrollear a la misma propiedad dentro de la
 *     MISMA sesión) o aislarlo (simula una sesión nueva de la app).
 *
 * EDGE CASES CUBIERTOS (14 casos):
 *
 * ### Happy path
 * - (EC-1) report_view_inserta_video_view_con_campos_exactos
 * - (EC-2) report_time_update_al_completar_inserta_video_completed
 *
 * ### Dedupe por bucle — requisito MÁS importante de la subtarea (contexto 112.2 #1)
 * - (EC-3) dedupe_bucle_n_timeupdate_cruzando_umbral_una_sola_insercion
 * - (EC-4) dedupe_view_multiples_activaciones_misma_instancia_una_sola_insercion
 *
 * ### Dedupe por sesión/propiedad (contexto 112.2 #2 y #3)
 * - (EC-5) dedupe_misma_sesion_revisit_no_duplica
 * - (EC-6) sesion_nueva_vuelve_a_contar_como_vista
 *
 * ### Fire-and-forget (contexto 112.2 #4)
 * - (EC-7) fire_and_forget_error_insert_view_no_rompe_y_loggea
 * - (EC-8) fire_and_forget_error_insert_completed_no_rompe_y_loggea
 *
 * ### Umbral de compleción a nivel de integración (contexto 112.2 #5)
 * - (EC-9) mitad_del_video_no_inserta_completado
 * - (EC-10) umbral_95_porciento_exacto_si_inserta_completado
 *
 * ### duration inválida (contexto 112.2 #6 — el caso que más fácil se cuela)
 * - (EC-11) duration_cero_no_inserta_completado_ni_truena
 * - (EC-12) duration_nan_no_inserta_completado_ni_truena
 *
 * ### Sin sesión (contexto 112.2 #7)
 * - (EC-13) sin_sesion_report_view_no_escribe
 * - (EC-14) sin_sesion_report_time_update_no_escribe
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useVideoEngagementEvents } from '../hooks/useVideoEngagementEvents';
import { create_video_engagement_store } from '../lib/videoEngagementDedupe';

// ---------------------------------------------------------------------------
// Mock de useAuth — debe declararse ANTES de cualquier import del SUT
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-buscador-uuid-9';
const TEST_PROPERTY_ID = 'propiedad-uuid-departamento-roma';
const TEST_PROPERTY_VIDEO_ID = 'video-uuid-departamento-roma';
const TEST_SESSION_ID = 'sesion-uuid-primera-visita';
const OTHER_SESSION_ID = 'sesion-uuid-app-reabierta';

// ---------------------------------------------------------------------------
// Helper — cast tipado de mock
// ---------------------------------------------------------------------------

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Factories de mock
// ---------------------------------------------------------------------------

/**
 * Builder thenable para INSERT en events_raw.
 * supabase.from('events_raw').insert({...}) → { error }
 */
function make_insert_builder(result: { error: { message: string; code?: string } | null }) {
  return {
    then: (
      onFulfilled: (v: typeof result) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
}

/**
 * Mock del cliente Supabase para useVideoEngagementEvents.
 * Expone _mock_from, _mock_insert para aserciones.
 */
function make_mock_supabase_events(opts: {
  insert_result?: { error: { message: string; code?: string } | null };
} = {}) {
  const { insert_result = { error: null } } = opts;

  const mock_insert = jest.fn().mockReturnValue(make_insert_builder(insert_result));
  const mock_from = jest.fn().mockReturnValue({ insert: mock_insert });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_insert: mock_insert,
  };
}

/** Filtra las llamadas a insert() por event_type, para aserciones de conteo. */
function insert_calls_of_type(
  mock_insert: jest.Mock,
  event_type: 'video_view' | 'video_completed',
) {
  return mock_insert.mock.calls.filter(
    ([row]: [{ event_type: string }]) => row.event_type === event_type,
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_auth.mockReturnValue({

    user: { id: TEST_USER_ID } as any,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVideoEngagementEvents', () => {

  // ── (EC-1) Happy path — report_view inserta video_view ───────────────────

  it('(EC-1) report_view_inserta_video_view_con_campos_exactos: report_view() → INSERT en events_raw con {event_type:"video_view", user_id (del auth), property_id, property_video_id, session_id}', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_view();
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('events_raw');
    expect(mock_supabase._mock_insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'video_view',
        user_id: TEST_USER_ID,
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
      })
    );
  });

  // ── (EC-2) Happy path — report_time_update al completar inserta video_completed ─

  it('(EC-2) report_time_update_al_completar_inserta_video_completed: currentTime>=95% duration → INSERT con event_type "video_completed" y los mismos campos base', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(38, 40); // 95% de 40s
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('events_raw');
    expect(mock_supabase._mock_insert).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'video_completed',
        user_id: TEST_USER_ID,
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
      })
    );
  });

  // ── (EC-3) Dedupe por bucle — N timeUpdate cruzando el umbral ─────────────

  it('(EC-3) dedupe_bucle_n_timeupdate_cruzando_umbral_una_sola_insercion: 5 timeUpdate simulando el loop del feed (cruza el umbral, reinicia, vuelve a cruzar) → UNA sola fila video_completed', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(38, 40); // cruza el umbral
      await result.current.report_time_update(39, 40); // sigue tras el umbral
      await result.current.report_time_update(0, 40); // el loop reinicia currentTime
      await result.current.report_time_update(38, 40); // 2ª vuelta, cruza otra vez
      await result.current.report_time_update(40, 40); // fin exacto, 2ª vuelta
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_completed')).toHaveLength(1);
  });

  // ── (EC-4) Dedupe view — múltiples activaciones de la misma instancia ────

  it('(EC-4) dedupe_view_multiples_activaciones_misma_instancia_una_sola_insercion: 3 llamadas seguidas a report_view() (reactivaciones rápidas de isActive) → UNA sola fila video_view', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_view();
      await result.current.report_view();
      await result.current.report_view();
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_view')).toHaveLength(1);
  });

  // ── (EC-5) Dedupe por sesión — revisit dentro de la MISMA sesión ─────────

  it('(EC-5) dedupe_misma_sesion_revisit_no_duplica: activar A, ir a B, volver a A (nueva instancia del hook, MISMO store y session_id — simula reciclaje de FlashList) → report_view NO vuelve a insertar', async () => {
    const shared_store = create_video_engagement_store();
    const mock_supabase = make_mock_supabase_events();
    const hook_opts = {
      property_id: TEST_PROPERTY_ID,
      property_video_id: TEST_PROPERTY_VIDEO_ID,
      session_id: TEST_SESSION_ID,
      supabase: mock_supabase,
      store: shared_store,
    };

    const first = await renderHook(() => useVideoEngagementEvents(hook_opts));
    await act(async () => {
      await first.result.current.report_view();
    });

    // Usuario navega a otra propiedad y VUELVE a A: nueva instancia del hook,
    // mismo store (persistente fuera del componente) y misma sesión.
    const second = await renderHook(() => useVideoEngagementEvents(hook_opts));
    await act(async () => {
      await second.result.current.report_view();
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_view')).toHaveLength(1);
  });

  // ── (EC-6) Sesión nueva — sí vuelve a contar ─────────────────────────────

  it('(EC-6) sesion_nueva_vuelve_a_contar_como_vista: mismo store y propiedad, session_id DISTINTO (app se reabrió) → report_view SÍ inserta de nuevo (insumo de "veces que volvió a ver")', async () => {
    const shared_store = create_video_engagement_store();
    const mock_supabase = make_mock_supabase_events();

    const first = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
        store: shared_store,
      })
    );
    await act(async () => {
      await first.result.current.report_view();
    });

    const second = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: OTHER_SESSION_ID,
        supabase: mock_supabase,
        store: shared_store,
      })
    );
    await act(async () => {
      await second.result.current.report_view();
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_view')).toHaveLength(2);
  });

  // ── (EC-7) Fire-and-forget — error en report_view no rompe, se loggea ────

  it('(EC-7) fire_and_forget_error_insert_view_no_rompe_y_loggea: INSERT devuelve error (offline/RLS) → report_view() NO lanza excepción y el error se loggea (console.error), no se traga en silencio', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_supabase = make_mock_supabase_events({
      insert_result: { error: { message: 'permission denied for table events_raw', code: '42501' } },
    });
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_view();
    });

    expect(console_error_spy).toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  // ── (EC-8) Fire-and-forget — error en report_time_update no rompe, se loggea ─

  it('(EC-8) fire_and_forget_error_insert_completed_no_rompe_y_loggea: video completo pero INSERT falla (offline/RLS) → report_time_update() NO lanza excepción y el error se loggea', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_supabase = make_mock_supabase_events({
      insert_result: { error: { message: 'network request failed' } },
    });
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(40, 40);
    });

    expect(console_error_spy).toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  // ── (EC-9) Umbral — mitad del video NO marca completado ──────────────────

  it('(EC-9) mitad_del_video_no_inserta_completado: currentTime = duration/2 (50%) → report_time_update NO inserta video_completed', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(20, 40);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();
  });

  // ── (EC-10) Umbral — exactamente 95% SÍ marca completado ─────────────────

  it('(EC-10) umbral_95_porciento_exacto_si_inserta_completado: currentTime = duration*0.95 (boundary) → SÍ inserta video_completed', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(38, 40); // 38 = 40 * 0.95
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_completed')).toHaveLength(1);
  });

  // ── (EC-11) duration=0 — no inserta completado, no truena ────────────────

  it('(EC-11) duration_cero_no_inserta_completado_ni_truena: duration=0 (player recién montado, sin cargar aún) → NO inserta video_completed, no lanza', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(0, 0);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();
  });

  // ── (EC-12) duration=NaN — no inserta completado, no truena ──────────────

  it('(EC-12) duration_nan_no_inserta_completado_ni_truena: duration=NaN (mientras el status aún es "loading") → NO inserta video_completed, no lanza', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(5, NaN);
    });

    expect(mock_supabase._mock_insert).not.toHaveBeenCalled();
  });

  // ── (EC-13) Sin sesión — report_view no escribe ───────────────────────────

  it('(EC-13) sin_sesion_report_view_no_escribe: user=null → report_view() NO llama from("events_raw"), no lanza excepción', async () => {
    mock_use_auth.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      updatePassword: jest.fn(),
    });

    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_view();
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
  });

  // ── (EC-14) Sin sesión — report_time_update no escribe ────────────────────

  it('(EC-14) sin_sesion_report_time_update_no_escribe: user=null, video completo (currentTime=duration) → report_time_update() NO llama from("events_raw"), no lanza excepción', async () => {
    mock_use_auth.mockReturnValue({
      user: null,
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      updatePassword: jest.fn(),
    });

    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(40, 40);
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
  });

});
