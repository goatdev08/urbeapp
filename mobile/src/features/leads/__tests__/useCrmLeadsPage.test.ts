/**
 * Tests fase RED — useCrmLeadsPage (subtarea 266.7, rediseño CRM #266)
 * Archivo SUT: mobile/src/features/leads/hooks/useCrmLeadsPage.ts (STUB que lanza
 * 'not_implemented' — la implementación real es el GREEN de esta subtarea).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useCrmLeadsPage(agentId, band, query) → {
 *     data, loading, error, hasMore, remaining, loadInitial, loadMore, refetch
 *   }
 * — y el contrato exacto de la RPC `crm_leads_page` (migración
 * 20260906100003_crm_leads_page_funnel.sql, subtarea 266.4): params
 * `p_agent_id/p_band/p_cursor/p_limit/p_query`, filas con `next_cursor`/
 * `remaining` REPETIDOS idénticos en cada fila de una misma página (el hook
 * los extrae UNA vez, no los expone por fila — ver types.ts/CrmLeadRow).
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea, no de la RPC):
 *
 * - D-INITIAL: loading arranca en `Boolean(agentId)` — true si hay agentId
 *   que consultar (arranca cargando de inmediato, sin agentId no hay nada
 *   que pedir). data=[], error=null, hasMore=false, remaining=null SIEMPRE
 *   en el primer render, verificado con una sonda ANTES de que el efecto
 *   resuelva (memoria tests_bomba_de_fecha_y_estado_inicial — nunca tras el
 *   efecto).
 * - D-FOCUS: la carga inicial viaja por `useFocusEffect` (molde
 *   useAgentProfile.ts) con deps `[agentId, band, query]` — el primer foco
 *   coincide con el mount (loadInitial NO hace falta llamarla a mano para la
 *   primera carga) y un refoco real (usuario vuelve a la pantalla)
 *   re-dispara la carga igual que un cambio de banda/query.
 * - D-LIMIT: `p_limit` es SIEMPRE 20, explícito en cada llamada — precedente
 *   266.5 (nunca mandar un límite indefinido).
 * - D-CURSOR-HOOK: `next_cursor`/`remaining` se leen de la ÚLTIMA fila
 *   devuelta (idéntico en todas, pero el hook lee una sola). Sin filas ⇒
 *   hasMore=false, remaining=null (no hay fila de la que leer).
 * - D-APPEND: `loadMore` APENDA al array existente; `loadInitial`/`refetch`/
 *   un cambio real de banda o query REEMPLAZAN data desde cero (`p_cursor:
 *   null`).
 *
 * PATRÓN DE MOCK:
 *   - '@/lib/supabase/client': mock_supabase_holder + getter, objeto plano
 *     `{ rpc: jest.fn() }` (el SUT llama `supabase.rpc(...)` directo, sin
 *     builder encadenado — igual que useLeadStats.test.ts).
 *   - 'expo-router'.useFocusEffect: calcado de useAgentProfile.test.tsx —
 *     captura el callback en `captured_focus_callback` y lo autoinvoca en
 *     mount vía un useEffect con dep [callback] (imita "el primer foco
 *     coincide con el mount"; un refoco real se simula invocando el
 *     callback capturado a mano).
 *   - renderHook/act SIEMPRE con `await` (RNTL 14, rntl14_renderhook_async);
 *     unmount() SIEMPRE dentro de act() (rntl_unmount_fuera_de_act).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_data_vacio_loading_true_sin_error
 * - (EC-2) llama_crm_leads_page_con_params_exactos_p_cursor_null_en_primera_pagina
 * - (EC-3) exito_mapea_filas_acumula_next_cursor_y_remaining_de_la_ultima_fila
 *
 * ### Paginación (molde useFeedProperties)
 * - (EC-4) load_more_manda_el_cursor_recibido_y_apenda_sin_reemplazar
 * - (EC-14) tercera_pagina_dos_load_more_consecutivos_mandan_el_cursor_de_CADA_pagina_previa_
 *   sin_duplicados: el mutante "solo actualizar el cursor cuando !append" sobrevive a EC-4
 *   (que solo hace UN loadMore) — con dos loadMore consecutivos, el segundo debe mandar el
 *   cursor que dejó la SEGUNDA página (no el de la primera); si no, en producción reenviaría
 *   el cursor de la página 1 para siempre y duplicaría filas sin fin.
 * - (EC-5) refetch_reinicia_desde_null_y_reemplaza_data_no_apenda
 * - (EC-6) cambiar_band_reinicia_desde_null_y_reemplaza_data
 * - (EC-7) cambiar_query_reinicia_desde_null_y_reemplaza_data
 *
 * ### Refetch por foco
 * - (EC-8) refoco_real_redispara_la_rpc_desde_cursor_null
 *
 * ### Deps por contenido / estabilidad
 * - (EC-9) rerender_con_los_mismos_agentId_band_query_no_dispara_otra_llamada
 *
 * ### Boundary / error
 * - (EC-10) sin_filas_hasMore_false_remaining_null_sin_error
 * - (EC-11) error_de_rpc_mensaje_neutro_en_espanol_data_vacio_loading_false
 * - (EC-12) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act
 * - (EC-13) agentId_null_o_undefined_no_llama_rpc_estado_vacio_sin_error
 */

import { renderHook, act } from '@testing-library/react-native';

import { useCrmLeadsPage } from '../hooks/useCrmLeadsPage';
import type { CrmLeadRow } from '../types';

// ---------------------------------------------------------------------------
// Mock de useFocusEffect (expo-router) — calcado de useAgentProfile.test.tsx
// ---------------------------------------------------------------------------

let captured_focus_callback: (() => void) | null = null;

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void) => {
    captured_focus_callback = callback;
    const React = require('react');
    React.useEffect(() => {
      callback();
    }, [callback]);
  },
}));

// ---------------------------------------------------------------------------
// Mock del cliente Supabase
// ---------------------------------------------------------------------------

type MockSupabaseClient = { rpc: jest.Mock };

const mock_supabase_holder: { client: MockSupabaseClient } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures — forma CRUDA de una fila de public.crm_leads_page (RPC), con
// next_cursor/remaining REPETIDOS en cada fila (mismo valor toda la página).
// ---------------------------------------------------------------------------

const AGENT_ID = 'agent-uuid-266-7-crmpage';

type RpcCursor = { as_of: string; temperature: number; lead_id: string };
type RpcRow = Omit<CrmLeadRow, never> & { next_cursor: RpcCursor | null; remaining: number | null };

const CURSOR_1: RpcCursor = { as_of: '2026-09-06T12:00:00Z', temperature: 70, lead_id: 'lead-b' };

const ROW_A: RpcRow = {
  lead_id: 'lead-a',
  user_id: 'user-a',
  full_name: 'Ana Pérez',
  avatar_url: null,
  temperature: 82,
  delta: 5,
  band: 'hot',
  signals: { video_completed: 2, video_views: 5, likes: 1, saves: 1 },
  sparkline: [10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 82],
  last_activity_at: '2026-09-05T10:00:00Z',
  origin_property: { property_id: 'prop-1', address: 'Av. Reforma 100', contacted_at: '2026-09-01T09:00:00Z' },
  status_projected: 'contactado',
  next_cursor: CURSOR_1,
  remaining: 1,
};

const ROW_B: RpcRow = {
  lead_id: 'lead-b',
  user_id: 'user-b',
  full_name: 'Bruno Ríos',
  avatar_url: 'https://storage.example/b.jpg',
  temperature: 70,
  delta: 0,
  band: 'silent',
  signals: { video_completed: 0, video_views: 1, likes: 0, saves: 0 },
  sparkline: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 70],
  last_activity_at: '2026-09-04T08:00:00Z',
  origin_property: null,
  status_projected: 'nuevo',
  next_cursor: CURSOR_1,
  remaining: 1,
};

const ROW_C_ULTIMA_PAGINA: RpcRow = {
  lead_id: 'lead-c',
  user_id: 'user-c',
  full_name: 'Carla Núñez',
  avatar_url: null,
  temperature: 40,
  delta: -3,
  band: 'cooling',
  signals: { video_completed: 1, video_views: 3, likes: 1, saves: 0 },
  sparkline: [40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40],
  last_activity_at: '2026-09-03T08:00:00Z',
  origin_property: { property_id: 'prop-2', address: 'Calle Sur 20', contacted_at: '2026-08-30T09:00:00Z' },
  status_projected: 'visita',
  next_cursor: null,
  remaining: 0,
};

// ---------------------------------------------------------------------------
// Fixtures — EC-14 (tercera página, 2 loadMore consecutivos). Cadena propia
// (3 páginas, 3 cursores distintos) para no compartir estado con ROW_A/B/C.
// ---------------------------------------------------------------------------

const CURSOR_P2: RpcCursor = { as_of: '2026-09-06T12:00:00Z', temperature: 60, lead_id: 'lead-p2' };
const CURSOR_P3: RpcCursor = { as_of: '2026-09-06T12:00:00Z', temperature: 30, lead_id: 'lead-p3' };

const ROW_P1: RpcRow = {
  ...ROW_A,
  lead_id: 'lead-p1',
  user_id: 'user-p1',
  next_cursor: CURSOR_P2,
  remaining: 2,
};
const ROW_P2: RpcRow = {
  ...ROW_A,
  lead_id: 'lead-p2',
  user_id: 'user-p2',
  next_cursor: CURSOR_P3,
  remaining: 1,
};
const ROW_P3_ULTIMA: RpcRow = {
  ...ROW_A,
  lead_id: 'lead-p3',
  user_id: 'user-p3',
  next_cursor: null,
  remaining: 0,
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function make_supabase_mock(rpc_impl: jest.Mock = jest.fn().mockResolvedValue({ data: [], error: null })): MockSupabaseClient {
  return { rpc: rpc_impl };
}

beforeEach(() => {
  jest.clearAllMocks();
  captured_focus_callback = null;
  mock_supabase_holder.client = make_supabase_mock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCrmLeadsPage', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_data_vacio_loading_true_sin_error: sonda del primer render, antes de que el efecto resuelva', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useCrmLeadsPage>[] = [];
    function useProbe() {
      const state = useCrmLeadsPage(AGENT_ID, null, null);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.data).toEqual([]);
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
    expect(first.hasMore).toBe(false);
    expect(first.remaining).toBeNull();
  });

  it('(EC-2) llama_crm_leads_page_con_params_exactos_p_cursor_null_en_primera_pagina', async () => {
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: [ROW_A, ROW_B], error: null }),
    );

    await renderHook(() => useCrmLeadsPage(AGENT_ID, 'hot', 'ana'));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: 'hot',
      p_cursor: null,
      p_limit: 20,
      p_query: 'ana',
    });
  });

  it('(EC-3) exito_mapea_filas_acumula_next_cursor_y_remaining_de_la_ultima_fila', async () => {
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: [ROW_A, ROW_B], error: null }),
    );

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));

    expect(result.current.data).toEqual([
      {
        lead_id: 'lead-a',
        user_id: 'user-a',
        full_name: 'Ana Pérez',
        avatar_url: null,
        temperature: 82,
        delta: 5,
        band: 'hot',
        signals: { video_completed: 2, video_views: 5, likes: 1, saves: 1 },
        sparkline: [10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 82],
        last_activity_at: '2026-09-05T10:00:00Z',
        origin_property: { property_id: 'prop-1', address: 'Av. Reforma 100', contacted_at: '2026-09-01T09:00:00Z' },
        status_projected: 'contactado',
      },
      {
        lead_id: 'lead-b',
        user_id: 'user-b',
        full_name: 'Bruno Ríos',
        avatar_url: 'https://storage.example/b.jpg',
        temperature: 70,
        delta: 0,
        band: 'silent',
        signals: { video_completed: 0, video_views: 1, likes: 0, saves: 0 },
        sparkline: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 70],
        last_activity_at: '2026-09-04T08:00:00Z',
        origin_property: null,
        status_projected: 'nuevo',
      },
    ]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.remaining).toBe(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-4) load_more_manda_el_cursor_recibido_y_apenda_sin_reemplazar', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A, ROW_B], error: null })
      .mockResolvedValueOnce({ data: [ROW_C_ULTIMA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: CURSOR_1,
      p_limit: 20,
      p_query: null,
    });
    // Apenda: las 2 filas de la primera página siguen presentes + la nueva.
    expect(result.current.data).toHaveLength(3);
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-a', 'lead-b', 'lead-c']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it('(EC-14) tercera_pagina_dos_load_more_consecutivos_mandan_el_cursor_de_CADA_pagina_previa_sin_duplicados', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_P1], error: null })
      .mockResolvedValueOnce({ data: [ROW_P2], error: null })
      .mockResolvedValueOnce({ data: [ROW_P3_ULTIMA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-p1']);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: CURSOR_P2,
      p_limit: 20,
      p_query: null,
    });
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-p1', 'lead-p2']);

    // El SEGUNDO loadMore es la clave del candado: debe mandar el cursor que
    // dejó la SEGUNDA página (CURSOR_P3), NUNCA repetir CURSOR_P2 (el
    // mutante "solo actualizar el cursor cuando !append" congela el ref en
    // el valor de la PRIMERA página y este assert lo destapa).
    await act(async () => {
      await result.current.loadMore();
    });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(3, 'crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: CURSOR_P3,
      p_limit: 20,
      p_query: null,
    });

    // Las 3 páginas acumuladas, sin duplicados (un cursor repetido volvería
    // a traer lead-p2 dos veces).
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-p1', 'lead-p2', 'lead-p3']);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBe(0);
  });

  it('(EC-5) refetch_reinicia_desde_null_y_reemplaza_data_no_apenda', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A, ROW_B], error: null })
      .mockResolvedValueOnce({ data: [ROW_C_ULTIMA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.refetch();
    });

    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: null,
      p_limit: 20,
      p_query: null,
    });
    // Reemplaza, no apenda: solo queda la fila de la segunda respuesta.
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]!.lead_id).toBe('lead-c');
  });

  it('(EC-6) cambiar_band_reinicia_desde_null_y_reemplaza_data', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A, ROW_B], error: null })
      .mockResolvedValueOnce({ data: [ROW_C_ULTIMA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ band }: { band: 'hot' | 'cooling' | null }) => useCrmLeadsPage(AGENT_ID, band, null),
      { initialProps: { band: null } },
    );
    expect(result.current.data).toHaveLength(2);

    await rerender({ band: 'cooling' });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: 'cooling',
      p_cursor: null,
      p_limit: 20,
      p_query: null,
    });
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0]!.lead_id).toBe('lead-c');
  });

  it('(EC-7) cambiar_query_reinicia_desde_null_y_reemplaza_data', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A, ROW_B], error: null })
      .mockResolvedValueOnce({ data: [ROW_C_ULTIMA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ query }: { query: string | null }) => useCrmLeadsPage(AGENT_ID, null, query),
      { initialProps: { query: null } },
    );
    expect(result.current.data).toHaveLength(2);

    await rerender({ query: 'carla' });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: null,
      p_limit: 20,
      p_query: 'carla',
    });
    expect(result.current.data).toHaveLength(1);
  });

  it('(EC-8) refoco_real_redispara_la_rpc_desde_cursor_null', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A], error: null })
      .mockResolvedValueOnce({ data: [ROW_C_ULTIMA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(captured_focus_callback).not.toBeNull();

    await act(async () => {
      captured_focus_callback!();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: null,
      p_limit: 20,
      p_query: null,
    });
  });

  it('(EC-9) rerender_con_los_mismos_agentId_band_query_no_dispara_otra_llamada', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [ROW_A], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(
      ({ query }: { query: string | null }) => useCrmLeadsPage(AGENT_ID, 'hot', query),
      { initialProps: { query: 'ana' } },
    );
    expect(rpc).toHaveBeenCalledTimes(1);

    // Mismo agentId/band/query (idéntico contenido, sea la misma referencia
    // primitiva o no) — NO debe disparar una llamada nueva.
    await rerender({ query: 'ana' });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-10) sin_filas_hasMore_false_remaining_null_sin_error', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: [], error: null }));

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));

    expect(result.current.data).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-11) error_de_rpc_mensaje_neutro_en_espanol_data_vacio_loading_false', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function crm_leads_page';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));

    expect(result.current.error).toBe('No se pudo cargar el pipeline de leads. Intenta de nuevo.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  // 🔴 HALLAZGO (guardian, 266.7, 2026-09-06): se intentó fortalecer este
  // test para que discrimine el mutante "quitar mounted_ref/ignore" —
  // verificado EMPÍRICAMENTE (probe de render-count en useCrmFunnel Y
  // useCrmLeadsPage, con la bandera removida) que resolver la RPC DESPUÉS
  // de unmount() NO produce un re-render ni cambia `result.current`, CON o
  // SIN el guard: React 18+ detacha el fiber ya desmontado y silencia
  // cualquier setState posterior sin warning (el aviso clásico "Can't
  // perform a React state update on an unmounted component" se eliminó
  // del framework) — no hay señal de caja negra que discrimine ese mutante
  // específico en este entorno (RNTL/react-test-renderer). Se deja el
  // assert existente (no lanza + sin console.error) porque SÍ protege otra
  // regresión real (una excepción o un warning genuino al desmontar) — no
  // se fuerza un candado vacío para el guard mounted_ref (instrucción
  // explícita del guardian: "si no es discriminante, dilo y no fuerces").
  it('(EC-12) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act', async () => {
    let resolve_rpc!: (value: { data: RpcRow[]; error: null }) => void;
    const pending = new Promise<{ data: RpcRow[]; error: null }>((resolve) => {
      resolve_rpc = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));

    let unmount_threw = false;
    try {
      await act(async () => {
        unmount();
      });
    } catch {
      unmount_threw = true;
    }
    expect(unmount_threw).toBe(false);

    await act(async () => {
      resolve_rpc({ data: [ROW_A], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-13) agentId_null_o_undefined_no_llama_rpc_estado_vacio_sin_error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [ROW_A], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result: result_null } = await renderHook(() => useCrmLeadsPage(null, null, null));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_null.current.data).toEqual([]);
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useCrmLeadsPage(undefined, null, null));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_undefined.current.data).toEqual([]);
    expect(result_undefined.current.loading).toBe(false);
  });
});
