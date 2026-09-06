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
 * Builder thenable que RECHAZA (a diferencia de make_insert_builder, que
 * siempre resuelve con {error}) — simula un fallo fatal del transporte
 * (network, cliente no inicializado) en vez de un error de negocio devuelto
 * por PostgREST. M4 (guardian): sin esto, quitar el try/catch de insert_event
 * deja la suite en verde porque ningún test hacía que el await realmente lanzara.
 */
function make_rejecting_insert_builder(error: Error) {
  return {
    then: (
      onFulfilled: (v: never) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => Promise.reject(error).then(onFulfilled, onRejected),
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
  event_type: 'video_view' | 'video_completed' | 'video_progress',
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

  // ── (M4) try/catch del fire-and-forget — insert() lanza síncrono ─────────

  it('(M4-a) insert_lanza_sincrono_no_rompe_y_loggea: .insert() lanza una excepción SÍNCRONA (p.ej. get_client() truena porque faltan env vars) → report_view() NO propaga, el error se loggea', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_insert = jest.fn(() => {
      throw new Error('cliente supabase no inicializado');
    });
    const mock_supabase = { from: jest.fn().mockReturnValue({ insert: mock_insert }) };

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

  // ── (M4) try/catch del fire-and-forget — el thenable de insert() rechaza ──

  it('(M4-b) insert_thenable_rechaza_no_rompe_y_loggea: el builder de .insert() RECHAZA la promesa (fallo fatal de red, no un {error} de PostgREST) → report_time_update() NO propaga, el error se loggea', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_insert = jest
      .fn()
      .mockReturnValue(make_rejecting_insert_builder(new Error('network fatal')));
    const mock_supabase = { from: jest.fn().mockReturnValue({ insert: mock_insert }) };

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

  // ── (M12) mark_seen ANTES del await insert — protección de concurrencia ──

  it('(M12) dos_report_view_sin_await_entre_ellas_una_sola_insercion: 2 llamadas a report_view() SIN await entre ellas (como en producción — fire-and-forget a 2 ticks/seg) → UNA sola fila video_view; solo pasa si mark_seen ocurre ANTES del await al insert', async () => {
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
      const first = result.current.report_view();
      const second = result.current.report_view();
      await Promise.all([first, second]);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_view')).toHaveLength(1);
  });

  it('(M12-completed) dos_report_time_update_sin_await_entre_ellas_una_sola_insercion: 2 llamadas a report_time_update() (currentTime ya completo) SIN await entre ellas → UNA sola fila video_completed', async () => {
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
      const first = result.current.report_time_update(40, 40);
      const second = result.current.report_time_update(40, 40);
      await Promise.all([first, second]);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_completed')).toHaveLength(1);
  });

  // ── (M9/M14 guard) session_id inválido — NO se escribe ────────────────────

  it('(guard + V3) sin_session_id_valido_report_view_no_escribe: session_id vacío (simula Crypto.randomUUID() devolviendo algo falsy por un fallo del módulo nativo, ver appSession.test.ts) → report_view() NO llama from("events_raw"), no lanza, y loggea con console.error (V3: diagnosticable, no un fallo silencioso)', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: '',
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_view();
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(console_error_spy).toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(guard + V3) sin_session_id_valido_report_time_update_no_escribe: session_id vacío, video completo (currentTime=duration) → report_time_update() NO llama from("events_raw"), no lanza, y loggea con console.error', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: '',
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(40, 40);
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(console_error_spy).toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

});

// ---------------------------------------------------------------------------
// AÑADIDO 268.1 — video_progress: máximo % de reproducción por (sesión, propiedad)
//
// SUT nuevo: report_progress() en el return del hook.
//
// Contrato (subtarea 268.1, decisión Abraham 2026-09-06):
//   - report_time_update ADEMÁS actualiza el máximo de progreso en el store
//     (bump_max_progress), en cada tick, independientemente de si completa.
//   - report_progress(): si hay un máximo registrado para (session_id,
//     property_id) y aún no se envió video_progress para esa clave, inserta
//     UNA fila events_raw {event_type:'video_progress', payload:{progress}}
//     con el MÁXIMO vigente y marca la clave como vista. Sin máximo
//     registrado (nunca hubo timeUpdate) → NO inserta.
//   - video_view/video_completed NO cambian de forma: siguen sin `payload`.
//   - Fire-and-forget (nunca lanza) y fail-closed sin session_id, mismo
//     patrón que report_view/report_time_update.
//
// EDGE CASES CUBIERTOS (8 casos):
//
// ### Happy path — progreso máximo se reporta una sola vez
// - (EC-15) varios_timeupdate_luego_report_progress_inserta_el_maximo
// - (EC-16) segunda_llamada_a_report_progress_no_duplica
//
// ### Boundary — sin progreso registrado
// - (EC-17) sin_ningun_timeupdate_report_progress_no_inserta
//
// ### video_progress y video_completed son eventos DISTINTOS (contexto 268.1)
// - (EC-18) completar_e_progresar_generan_dos_filas_distintas
//
// ### Fail-closed / fire-and-forget
// - (EC-19) sin_sesion_report_progress_no_escribe_y_loggea_sin_user_id
// - (EC-20) insert_de_video_progress_que_rechaza_no_rompe
//
// ### Dedupe compartido entre instancias (reciclaje de FlashList)
// - (EC-21) store_compartido_entre_instancias_un_solo_video_progress
//
// ### Forma de los eventos existentes NO cambia
// - (EC-22) video_view_y_video_completed_siguen_sin_payload
// ---------------------------------------------------------------------------

describe('useVideoEngagementEvents — video_progress (268.1)', () => {

  // ── (EC-15) Happy path — el máximo se reporta al pedir report_progress ──

  it('(EC-15) varios_timeupdate_luego_report_progress_inserta_el_maximo: report_time_update(10,60), (40,60), (20,60) [máximo=66%] → report_progress() inserta UNA fila video_progress con payload.progress===66', async () => {
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
      await result.current.report_time_update(10, 60);
      await result.current.report_time_update(40, 60);
      await result.current.report_time_update(20, 60);
      await result.current.report_progress();
    });

    const progress_calls = insert_calls_of_type(mock_supabase._mock_insert, 'video_progress');
    expect(progress_calls).toHaveLength(1);
    expect(progress_calls[0]![0]).toEqual(
      expect.objectContaining({
        event_type: 'video_progress',
        user_id: TEST_USER_ID,
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        payload: { progress: 66 },
      })
    );
  });

  // ── (EC-16) Dedupe — segunda llamada a report_progress no duplica ───────

  it('(EC-16) segunda_llamada_a_report_progress_no_duplica: tras un report_progress() ya insertado, una SEGUNDA llamada → 0 inserts nuevos de video_progress', async () => {
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
      await result.current.report_time_update(30, 60);
      await result.current.report_progress();
      await result.current.report_progress();
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_progress')).toHaveLength(1);
  });

  // ── (EC-17) Sin timeUpdate — report_progress no inserta ──────────────────

  it('(EC-17) sin_ningun_timeupdate_report_progress_no_inserta: report_progress() llamado SIN ningún report_time_update previo (nunca hubo máximo registrado) → NO inserta video_progress', async () => {
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
      await result.current.report_progress();
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_progress')).toHaveLength(0);
    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
  });

  // ── (EC-18) video_completed y video_progress son eventos distintos ──────

  it('(EC-18) completar_e_progresar_generan_dos_filas_distintas: report_time_update(58,60) [95.67%, cruza el umbral de compleción] inserta video_completed SIN payload; luego report_progress() inserta video_progress con payload.progress===96 — DOS filas distintas', async () => {
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
      await result.current.report_time_update(58, 60);
      await result.current.report_progress();
    });

    const completed_calls = insert_calls_of_type(mock_supabase._mock_insert, 'video_completed');
    const progress_calls = insert_calls_of_type(mock_supabase._mock_insert, 'video_progress');
    expect(completed_calls).toHaveLength(1);
    expect(completed_calls[0]![0]).not.toHaveProperty('payload');
    expect(progress_calls).toHaveLength(1);
    expect(progress_calls[0]![0]).toEqual(
      expect.objectContaining({ payload: { progress: 96 } })
    );
  });

  // ── (EC-19) Sin sesión — report_progress no escribe ni expone PII ───────

  it('(EC-19) sin_sesion_report_progress_no_escribe_y_loggea_sin_user_id: session_id vacío (fail-closed) → report_progress() NO llama from("events_raw"), no lanza, loggea con console.error SIN incluir el user_id en el mensaje', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: '',
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_progress();
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(console_error_spy).toHaveBeenCalled();
    const logged_text = console_error_spy.mock.calls.map((args) => args.join(' ')).join(' | ');
    expect(logged_text).not.toContain(TEST_USER_ID);
    console_error_spy.mockRestore();
  });

  // ── (EC-20) Fire-and-forget — INSERT de video_progress rechaza ──────────

  it('(EC-20) insert_de_video_progress_que_rechaza_no_rompe: el INSERT del video_progress RECHAZA la promesa (fallo fatal de red) → report_progress() NO lanza, se loggea con console.error', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_insert = jest
      .fn()
      .mockReturnValue(make_rejecting_insert_builder(new Error('network fatal')));
    const mock_supabase = { from: jest.fn().mockReturnValue({ insert: mock_insert }) };

    const { result } = await renderHook(() =>
      useVideoEngagementEvents({
        property_id: TEST_PROPERTY_ID,
        property_video_id: TEST_PROPERTY_VIDEO_ID,
        session_id: TEST_SESSION_ID,
        supabase: mock_supabase,
      })
    );

    await act(async () => {
      await result.current.report_time_update(30, 60);
      await expect(result.current.report_progress()).resolves.toBeUndefined();
    });

    expect(console_error_spy).toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  // ── (EC-21) Store compartido entre instancias (reciclaje de FlashList) ──

  it('(EC-21) store_compartido_entre_instancias_un_solo_video_progress: 2 instancias del hook con el MISMO store y (session_id, property_id) — la 1ª acumula progreso e inserta video_progress; la 2ª (sin ticks propios) llama report_progress() de nuevo → 0 inserts nuevos (dedupe por store compartido)', async () => {
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
      await first.result.current.report_time_update(45, 60);
      await first.result.current.report_progress();
    });

    const second = await renderHook(() => useVideoEngagementEvents(hook_opts));
    await act(async () => {
      await second.result.current.report_progress();
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'video_progress')).toHaveLength(1);
  });

  // ── (EC-22) Forma de video_view/video_completed intacta ─────────────────

  it('(EC-22) video_view_y_video_completed_siguen_sin_payload: report_view() y report_time_update(40,40) (compleción) insertan SIN la clave `payload` — el contrato viejo de events_raw no cambia de forma', async () => {
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
      await result.current.report_time_update(40, 40);
    });

    const view_calls = insert_calls_of_type(mock_supabase._mock_insert, 'video_view');
    const completed_calls = insert_calls_of_type(mock_supabase._mock_insert, 'video_completed');
    expect(view_calls).toHaveLength(1);
    expect(completed_calls).toHaveLength(1);
    expect(view_calls[0]![0]).not.toHaveProperty('payload');
    expect(completed_calls[0]![0]).not.toHaveProperty('payload');
  });

});
