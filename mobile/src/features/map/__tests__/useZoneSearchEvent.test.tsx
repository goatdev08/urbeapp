/**
 * Tests fase RED — useZoneSearchEvent hook
 * Archivo SUT: mobile/src/features/map/hooks/useZoneSearchEvent.ts
 * Subtarea Taskmaster: 268.2 — zone_search: evento desde el mapa con dedupe
 * por sesión+zona (parte crítica de la tarea 268 "señales nuevas del CRM").
 *
 * SUT: useZoneSearchEvent({ session_id, supabase?, store? })
 *        → { report_zone_search: (payload: ZoneSearchPayload) => Promise<void> }
 *
 * Contrato (contexto verificado en la subtarea 268.2, patrón copiado de
 * useVideoEngagementEvents.ts / 112.2):
 *   - Escritura DIRECTA a public.events_raw con RLS (mismo patrón que
 *     useLikeProperty/useVideoEngagementEvents), NUNCA vía Edge Function.
 *   - user_id SIEMPRE de useAuth(), nunca de parámetros externos.
 *   - INSERT en events_raw con EXACTAMENTE
 *     {event_type:'zone_search', user_id, session_id, payload:<normalizado>}
 *     — SIN property_id, SIN property_video_id, SIN agent_id (a diferencia
 *     de useVideoEngagementEvents, este evento no nace de un video).
 *   - Dedupe por (session_id, zona) vía zone_search_key + store: una sola
 *     fila por clave; llamada repetida NO reinserta; otra sesión sí inserta;
 *     misma sesión con otra zona sí inserta.
 *   - El payload de área viaja NORMALIZADO (redondeado), nunca las coords
 *     crudas del viewport.
 *   - Sin user autenticado → no intenta escribir.
 *   - session_id falsy → NO escribe y loggea con console.error (fail-closed,
 *     sin PII en el mensaje — mismo patrón que useVideoEngagementEvents).
 *   - Fire-and-forget: un error de INSERT (offline, RLS) o el thenable que
 *     RECHAZA se loggean con console.error, la promesa de
 *     report_zone_search NUNCA rechaza.
 *   - mark_seen se aplica ANTES/independiente del resultado del insert (una
 *     zona fallida no se reintenta en bucle si se llama de nuevo sin await
 *     entre medias) — mismo comportamiento que useVideoEngagementEvents.
 *   - store inyectado: compartido entre dos renderHook() (simula un remount
 *     de MapScreen/re-render) → el segundo NO inserta. Sin store inyectado
 *     → cada instancia tiene el suyo propio.
 *
 * PATRÓN DE MOCK: idéntico a useVideoEngagementEvents.test.tsx
 *   - supabase inyectado como dep: useZoneSearchEvent({ ..., supabase: mock })
 *   - useAuth() mockeado vía jest.mock
 *   - store inyectado (create_zone_search_store real, NO mockeado)
 *
 * EDGE CASES CUBIERTOS (14 casos):
 *
 * ### Happy path
 * - (EC-1) report_zone_search_neighborhood_inserta_evento_con_payload_exacto
 * - (EC-2) report_zone_search_municipality_inserta_evento_con_payload_exacto
 * - (EC-3) report_zone_search_area_inserta_con_payload_redondeado_no_coords_crudas
 *
 * ### Contrato de forma de fila
 * - (EC-4) insert_no_incluye_property_id_ni_property_video_id_ni_agent_id
 *
 * ### Dedupe por sesión+zona
 * - (EC-5) dedupe_misma_zona_misma_sesion_llamada_repetida_no_reinserta
 * - (EC-6) otra_sesion_misma_zona_si_inserta
 * - (EC-7) misma_sesion_otra_zona_si_inserta
 * - (EC-8) store_compartido_entre_dos_renderhook_segundo_no_inserta
 * - (EC-9) sin_store_inyectado_cada_instancia_tiene_su_propio_store
 *
 * ### Fail-closed
 * - (EC-10) sin_user_no_escribe
 * - (EC-11) sin_session_id_no_escribe_y_loggea_sin_pii
 *
 * ### Fire-and-forget
 * - (EC-12) error_del_insert_no_rompe_y_loggea_resuelve
 * - (EC-13) insert_thenable_rechaza_no_rompe_y_loggea
 * - (EC-14) mark_seen_antes_del_insert_dos_llamadas_sin_await_una_sola_insercion
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { useZoneSearchEvent } from '../hooks/useZoneSearchEvent';
import { create_zone_search_store } from '../lib/zoneSearchEvent';
import type { ZoneSearchPayload } from '../lib/zoneSearchEvent';

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
const TEST_SESSION_ID = 'sesion-uuid-primera-visita';
const OTHER_SESSION_ID = 'sesion-uuid-app-reabierta';

const NEIGHBORHOOD_PAYLOAD: ZoneSearchPayload = {
  kind: 'neighborhood',
  neighborhood_id: '42',
};

const MUNICIPALITY_PAYLOAD: ZoneSearchPayload = {
  kind: 'municipality',
  municipality_id: '42',
};

const AREA_PAYLOAD_RAW: ZoneSearchPayload = {
  kind: 'area',
  center: { lat: 19.4326001, lng: -99.1332001 },
  radius_m: 500.4,
};

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
 * Builder thenable que RECHAZA — simula un fallo fatal del transporte
 * (network, cliente no inicializado), a diferencia de make_insert_builder
 * (que siempre resuelve con {error}).
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
 * Mock del cliente Supabase para useZoneSearchEvent.
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
function insert_calls_of_type(mock_insert: jest.Mock, event_type: string) {
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

describe('useZoneSearchEvent', () => {

  // ── (EC-1) Happy path — neighborhood ─────────────────────────────────────

  it('(EC-1) report_zone_search_neighborhood_inserta_evento_con_payload_exacto: report_zone_search({kind:"neighborhood", neighborhood_id:"42"}) → INSERT en events_raw con {event_type:"zone_search", user_id, session_id, payload:{kind:"neighborhood", neighborhood_id:"42"}}', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    expect(mock_supabase._mock_from).toHaveBeenCalledWith('events_raw');
    expect(mock_supabase._mock_insert).toHaveBeenCalledWith({
      event_type: 'zone_search',
      user_id: TEST_USER_ID,
      session_id: TEST_SESSION_ID,
      payload: { kind: 'neighborhood', neighborhood_id: '42' },
    });
  });

  // ── (EC-2) Happy path — municipality ──────────────────────────────────────

  it('(EC-2) report_zone_search_municipality_inserta_evento_con_payload_exacto: report_zone_search({kind:"municipality", municipality_id:"42"}) → INSERT con payload {kind:"municipality", municipality_id:"42"}', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(MUNICIPALITY_PAYLOAD);
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledWith({
      event_type: 'zone_search',
      user_id: TEST_USER_ID,
      session_id: TEST_SESSION_ID,
      payload: { kind: 'municipality', municipality_id: '42' },
    });
  });

  // ── (EC-3) Happy path — area redondeada, NO coords crudas ────────────────

  it('(EC-3) report_zone_search_area_inserta_con_payload_redondeado_no_coords_crudas: center={19.4326001,-99.1332001}, radius_m=500.4 → INSERT con payload {kind:"area", center:{lat:19.433,lng:-99.133}, radius_m:500} — NUNCA las coords crudas', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(AREA_PAYLOAD_RAW);
    });

    expect(mock_supabase._mock_insert).toHaveBeenCalledWith({
      event_type: 'zone_search',
      user_id: TEST_USER_ID,
      session_id: TEST_SESSION_ID,
      payload: { kind: 'area', center: { lat: 19.433, lng: -99.133 }, radius_m: 500 },
    });
  });

  // ── (EC-4) Forma de la fila — sin claves de video/agente ─────────────────

  it('(EC-4) insert_no_incluye_property_id_ni_property_video_id_ni_agent_id: la fila insertada NO trae property_id, property_video_id ni agent_id (a diferencia de los eventos de video)', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    const [row] = mock_supabase._mock_insert.mock.calls[0]!;
    expect(row).not.toHaveProperty('property_id');
    expect(row).not.toHaveProperty('property_video_id');
    expect(row).not.toHaveProperty('agent_id');
  });

  // ── (EC-5) Dedupe — llamada repetida a la misma zona no reinserta ────────

  it('(EC-5) dedupe_misma_zona_misma_sesion_llamada_repetida_no_reinserta: 3 llamadas seguidas con la MISMA zona (colonia 42) → UNA sola fila zone_search', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'zone_search')).toHaveLength(1);
  });

  // ── (EC-6) Dedupe — otra sesión, misma zona → SÍ inserta ─────────────────

  it('(EC-6) otra_sesion_misma_zona_si_inserta: misma zona (colonia 42), store compartido, session_id DISTINTO (app reabierta) → SÍ inserta de nuevo', async () => {
    const shared_store = create_zone_search_store();
    const mock_supabase = make_mock_supabase_events();

    const first = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase, store: shared_store })
    );
    await act(async () => {
      await first.result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    const second = await renderHook(() =>
      useZoneSearchEvent({ session_id: OTHER_SESSION_ID, supabase: mock_supabase, store: shared_store })
    );
    await act(async () => {
      await second.result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'zone_search')).toHaveLength(2);
  });

  // ── (EC-7) Dedupe — misma sesión, otra zona → SÍ inserta ─────────────────

  it('(EC-7) misma_sesion_otra_zona_si_inserta: misma sesión, primero colonia 42 y luego municipio 42 (namespace distinto) → DOS filas zone_search', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
      await result.current.report_zone_search(MUNICIPALITY_PAYLOAD);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'zone_search')).toHaveLength(2);
  });

  // ── (EC-8) Store compartido entre instancias (remount de MapScreen) ──────

  it('(EC-8) store_compartido_entre_dos_renderhook_segundo_no_inserta: 2 instancias del hook con el MISMO store, session_id y zona (simula un re-render de MapScreen) → la 2ª NO reinserta', async () => {
    const shared_store = create_zone_search_store();
    const mock_supabase = make_mock_supabase_events();
    const hook_opts = { session_id: TEST_SESSION_ID, supabase: mock_supabase, store: shared_store };

    const first = await renderHook(() => useZoneSearchEvent(hook_opts));
    await act(async () => {
      await first.result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    const second = await renderHook(() => useZoneSearchEvent(hook_opts));
    await act(async () => {
      await second.result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'zone_search')).toHaveLength(1);
  });

  // ── (EC-9) Sin store inyectado — cada instancia tiene el suyo propio ─────

  it('(EC-9) sin_store_inyectado_cada_instancia_tiene_su_propio_store: 2 instancias SIN store compartido, misma sesión y zona → AMBAS insertan (sin dedupe entre instancias no relacionadas)', async () => {
    const mock_supabase = make_mock_supabase_events();

    const first = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );
    await act(async () => {
      await first.result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    const second = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );
    await act(async () => {
      await second.result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'zone_search')).toHaveLength(2);
  });

  // ── (EC-10) Sin user — no escribe ────────────────────────────────────────

  it('(EC-10) sin_user_no_escribe: user=null (useAuth) → report_zone_search() NO llama from("events_raw"), no lanza', async () => {
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
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
  });

  // ── (EC-11) Sin session_id — fail-closed, loggea sin PII ─────────────────

  it('(EC-11) sin_session_id_no_escribe_y_loggea_sin_pii: session_id vacío → report_zone_search() NO llama from("events_raw"), no lanza, loggea con console.error SIN incluir el user_id en el mensaje', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: '', supabase: mock_supabase })
    );

    await act(async () => {
      await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
    });

    expect(mock_supabase._mock_from).not.toHaveBeenCalled();
    expect(console_error_spy).toHaveBeenCalled();
    const logged_text = console_error_spy.mock.calls.map((args) => args.join(' ')).join(' | ');
    expect(logged_text).not.toContain(TEST_USER_ID);
    console_error_spy.mockRestore();
  });

  // ── (EC-12) Fire-and-forget — error del insert no rompe, se loggea ───────

  it('(EC-12) error_del_insert_no_rompe_y_loggea_resuelve: INSERT devuelve error (offline/RLS) → report_zone_search() NO lanza, la promesa RESUELVE y el error se loggea (console.error)', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_supabase = make_mock_supabase_events({
      insert_result: { error: { message: 'permission denied for table events_raw', code: '42501' } },
    });
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await expect(
      act(async () => {
        await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
      })
    ).resolves.toBeUndefined();

    expect(console_error_spy).toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  // ── (EC-13) Fire-and-forget — el thenable de insert() rechaza ────────────

  it('(EC-13) insert_thenable_rechaza_no_rompe_y_loggea: el builder de .insert() RECHAZA la promesa (fallo fatal de red) → report_zone_search() NO propaga, se loggea con console.error', async () => {
    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const mock_insert = jest
      .fn()
      .mockReturnValue(make_rejecting_insert_builder(new Error('network fatal')));
    const mock_supabase = { from: jest.fn().mockReturnValue({ insert: mock_insert }) };

    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await expect(
      act(async () => {
        await result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
      })
    ).resolves.toBeUndefined();

    expect(console_error_spy).toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  // ── (EC-14) mark_seen ANTES del await insert — protección de concurrencia ─

  it('(EC-14) mark_seen_antes_del_insert_dos_llamadas_sin_await_una_sola_insercion: 2 llamadas a report_zone_search() con la MISMA zona SIN await entre ellas (dos taps rápidos del pill) → UNA sola fila zone_search', async () => {
    const mock_supabase = make_mock_supabase_events();
    const { result } = await renderHook(() =>
      useZoneSearchEvent({ session_id: TEST_SESSION_ID, supabase: mock_supabase })
    );

    await act(async () => {
      const first = result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
      const second = result.current.report_zone_search(NEIGHBORHOOD_PAYLOAD);
      await Promise.all([first, second]);
    });

    expect(insert_calls_of_type(mock_supabase._mock_insert, 'zone_search')).toHaveLength(1);
  });

});
