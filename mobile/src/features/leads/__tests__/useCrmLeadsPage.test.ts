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
 *
 * ### Extensión RED (subtarea 275.4, tarea #275 "hardening(267.6)",
 * 2026-09-07, AMPLIACIÓN DE ALCANCE): D-SEQ + try/catch, molde
 * useCrmLeadDetail.ts/useLeadActivity.ts. Hoy el hook NO tiene seq_ref ni
 * try/catch — estos casos DEBEN fallar hasta el GREEN. La carrera que
 * importa aquí es un cambio de `query` (búsqueda), una página tardía de
 * `loadMore` y un refoco disparado mientras una petición anterior sigue en
 * vuelo — NUNCA el agentId (ver frente B para esa transición).
 * - (EC-15) carrera_de_busqueda_la_respuesta_tardia_de_la_query_anterior_no_repuebla_una_lista_ya_vaciada_D_SEQ
 * - (EC-16) rechazo_real_de_red_desde_estado_poblado_error_neutro_y_data_vacia_no_vacuo
 * - (EC-17) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_repuebla_data
 * - (EC-18) pagina_tardia_de_loadMore_en_modo_append_no_concatena_ni_pisa_el_cursor_de_la_siguiente_llamada_D_SEQ
 * - (EC-19) refoco_disparado_durante_una_peticion_anterior_en_vuelo_no_pisa_el_resultado_del_refoco_D_SEQ
 *
 * ### Extensión RED (275.4, frente B): barrido del guard de argumento
 * faltante — el guard `if (!agentId)` no se prueba en TRANSICIÓN (solo en el
 * primer render, donde useState ya nace vacío) y no bumpea seq_ref ni
 * observa el reset del cursor de paginación.
 * - (EC-20) agentId_pasa_a_null_tras_estar_poblado_reinicia_data_hasmore_remaining_y_el_cursor_de_paginacion
 * - (EC-21) peticion_en_vuelo_del_agentId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_ni_pisa_el_cursor_D_SEQ
 *
 * ### Extensión RED (subtarea 271.2, tarea #271 "crm-hoja-filtros"): el hook
 * acepta dos parámetros nuevos — `status: ProjectedStatus[] | null` (4
 * estados proyectados, 271.1) y `followUp: boolean | null` — que viajan a la
 * RPC como `p_status`/`p_follow_up` con el MISMO molde de identidad de
 * petición que ya tienen `band`/`query` (reset de paginación, D-SEQ, deps
 * por contenido). SUT hoy: STUB — los acepta pero los IGNORA (no llegan a la
 * RPC, no entran en las deps de fetch_page) — estos casos DEBEN fallar hasta
 * el GREEN.
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (271.2, D-XXX nuevas):
 *
 * - D-STATUSNULL: si el llamador NO pasa `status`/`followUp` (arg
 *   `undefined` — llamadores viejos sin hoja de filtros, p.ej. CRMScreen.tsx
 *   antes de 271.3) la clave correspondiente (`p_status`/`p_follow_up`) se
 *   OMITE del objeto de args — retrocompatible con EC-2..EC-21, escritos
 *   antes de que estos filtros existieran, que asumen exactamente 5 claves.
 *   Si el llamador pasa explícitamente `null` (la hoja de filtros en estado
 *   "sin filtro") la clave SÍ viaja, con valor `null` — nunca `undefined`,
 *   nunca omitida. Las dos rutas (omitir vs. null explícito) son la MISMA
 *   distinción que ya existe en JS entre "argumento no provisto" y
 *   "argumento provisto como null"; el hook las trata distinto a propósito.
 * - D-STATUSEMPTY: `p_status: []` (arreglo vacío EXPLÍCITO, "ningún estado
 *   marcado" en la hoja) se manda TAL CUAL — el hook NO normaliza `[]` a
 *   `null`. La RPC ya trata `'{}'` como 0 filas (D-STATUSARRAY, 271.1); la
 *   distinción semántica "sin filtro" (null) vs. "cero estados elegidos"
 *   (array vacío) la controla el LLAMADOR (la hoja de 271.3), no el hook.
 *
 * ### Filtros nuevos — contrato exacto con la RPC
 * - (EC-22) status_y_follow_up_con_valor_viajan_exactos_a_la_rpc_como_array_y_boolean
 * - (EC-23) status_y_follow_up_explicitos_en_null_viajan_como_null_nunca_undefined_ni_se_omiten_D_STATUSNULL
 * - (EC-24) status_y_follow_up_omitidos_por_completo_omiten_la_clave_retrocompat_con_llamador_sin_hoja_de_filtros_D_STATUSNULL
 * - (EC-29) p_status_arreglo_vacio_explicito_se_manda_tal_cual_sin_normalizar_a_null_D_STATUSEMPTY
 *
 * ### Filtros nuevos — reinician la paginación (molde EC-6/EC-7, regla
 * memoria reset_solo_se_prueba_desde_estado_poblado: se puebla con 2 páginas
 * ANTES de cambiar el filtro)
 * - (EC-25) cambiar_status_reinicia_la_paginacion_solo_la_primera_pagina_del_filtro_nuevo_y_el_cursor_de_la_siguiente_llamada
 * - (EC-26) cambiar_follow_up_reinicia_la_paginacion_solo_la_primera_pagina_del_filtro_nuevo_y_el_cursor_de_la_siguiente_llamada
 *
 * ### Filtros nuevos — carrera (molde EC-15, D-SEQ)
 * - (EC-27) carrera_con_status_nuevo_la_respuesta_tardia_del_status_anterior_no_repuebla_una_lista_ya_reemplazada_D_SEQ
 *
 * ### Filtros nuevos — estabilidad por contenido del array (🔴 memoria
 * hook_array_prop_reference_loop: un array inline en el padre con igual
 * CONTENIDO pero nueva referencia no debe disparar refetch en bucle). Nota:
 * el STUB ignora `status` por completo (no entra en ninguna dep), así que
 * esta sonda puede pasar VACUAMENTE hoy (nada se dispara nunca) — el
 * candado real es que discrimine el mutante "deps por referencia" en el
 * GREEN (instrucción explícita de la subtarea: "debe fallar hoy O en cuanto
 * se implemente mal").
 * - (EC-28) array_de_status_estable_por_contenido_con_referencia_nueva_en_cada_render_no_hace_crecer_las_llamadas_a_la_rpc
 */

import { renderHook, act } from '@testing-library/react-native';

import { useCrmLeadsPage } from '../hooks/useCrmLeadsPage';
import type { CrmLeadRow, ProjectedStatus } from '../types';

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

  // -------------------------------------------------------------------------
  // Extensión RED (subtarea 275.4): D-SEQ + try/catch, molde
  // useCrmLeadDetail.ts/useLeadActivity.ts. El hook hoy NO tiene seq_ref ni
  // try/catch — deben fallar hasta el GREEN.
  // -------------------------------------------------------------------------

  it('(EC-15) carrera_de_busqueda_la_respuesta_tardia_de_la_query_anterior_no_repuebla_una_lista_ya_vaciada_D_SEQ', async () => {
    // Escribir 'juan' (lenta) y luego limpiar la búsqueda (rápida): la
    // respuesta tardía de 'juan' NO debe repoblar la lista que el usuario ya
    // vació.
    const ROW_SIN_QUERY_275_4: RpcRow = { ...ROW_B, lead_id: 'lead-sin-query-275-4', next_cursor: null, remaining: 0 };
    const ROW_JUAN_TARDIO_275_4: RpcRow = { ...ROW_A, lead_id: 'lead-juan-tardio-275-4', next_cursor: null, remaining: 0 };

    let resolve_juan!: (value: { data: RpcRow[]; error: null }) => void;
    const pending_juan = new Promise<{ data: RpcRow[]; error: null }>((resolve) => {
      resolve_juan = resolve;
    });
    const rpc = jest
      .fn()
      .mockReturnValueOnce(pending_juan) // query='juan' — LENTA
      .mockResolvedValueOnce({ data: [ROW_SIN_QUERY_275_4], error: null }); // query=null — RÁPIDA
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ query }: { query: string | null }) => useCrmLeadsPage(AGENT_ID, null, query),
      { initialProps: { query: 'juan' } },
    );

    await rerender({ query: null });
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-sin-query-275-4']);

    await act(async () => {
      resolve_juan({ data: [ROW_JUAN_TARDIO_275_4], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-sin-query-275-4']);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-16) rechazo_real_de_red_desde_estado_poblado_error_neutro_y_data_vacia_no_vacuo', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A, ROW_B], error: null })
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBe('No se pudo cargar el pipeline de leads. Intenta de nuevo.');
    expect(result.current.data).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-17) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_repuebla_data', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A], error: null })
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ data: [ROW_C_ULTIMA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe('No se pudo cargar el pipeline de leads. Intenta de nuevo.');

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-c']);
  });

  it('(EC-18) pagina_tardia_de_loadMore_en_modo_append_no_concatena_ni_pisa_el_cursor_de_la_siguiente_llamada_D_SEQ', async () => {
    const CURSOR_REFETCH_275_4: RpcCursor = { as_of: '2026-09-07T09:00:00Z', temperature: 55, lead_id: 'lead-refetch-275-4' };
    const CURSOR_LATE_275_4: RpcCursor = { as_of: '2026-09-01T09:00:00Z', temperature: 10, lead_id: 'lead-late-275-4' };
    const ROW_REFETCH_275_4: RpcRow = { ...ROW_A, lead_id: 'lead-refetch-275-4', next_cursor: CURSOR_REFETCH_275_4, remaining: 1 };
    const ROW_LATE_APPEND_275_4: RpcRow = { ...ROW_B, lead_id: 'lead-late-append-275-4', next_cursor: CURSOR_LATE_275_4, remaining: 3 };

    let resolve_load_more!: (value: { data: RpcRow[]; error: null }) => void;
    const pending_load_more = new Promise<{ data: RpcRow[]; error: null }>((resolve) => {
      resolve_load_more = resolve;
    });
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A], error: null }) // carga inicial
      .mockReturnValueOnce(pending_load_more) // loadMore — LENTO
      .mockResolvedValueOnce({ data: [ROW_REFETCH_275_4], error: null }) // refetch — RÁPIDO, reemplaza
      .mockResolvedValueOnce({ data: [], error: null }); // siguiente loadMore (probe del cursor)
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-a']);

    // loadMore lento — awaited (RNTL v14, memoria rntl14_renderhook_async):
    // `await Promise.resolve()` deja que fetch_page llegue hasta su propio
    // await (la llamada #2 a rpc) sin esperar a que esa promesa resuelva.
    let load_more_promise!: Promise<void>;
    await act(async () => {
      load_more_promise = result.current.loadMore();
      await Promise.resolve();
    });

    // El refetch resuelve RÁPIDO — reemplaza data y avanza el token.
    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-refetch-275-4']);

    // Ahora resuelve el loadMore lento y obsoleto.
    await act(async () => {
      resolve_load_more({ data: [ROW_LATE_APPEND_275_4], error: null });
      await load_more_promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    // (a) La página tardía NO se concatenó.
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-refetch-275-4']);

    // (b) El cursor NO quedó pisado por la página tardía: el siguiente
    // loadMore debe mandar CURSOR_REFETCH_275_4 (el del refetch), NUNCA
    // CURSOR_LATE_275_4.
    await act(async () => {
      await result.current.loadMore();
    });
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: CURSOR_REFETCH_275_4,
      p_limit: 20,
      p_query: null,
    });
  });

  it('(EC-19) refoco_disparado_durante_una_peticion_anterior_en_vuelo_no_pisa_el_resultado_del_refoco_D_SEQ', async () => {
    const ROW_MOUNT_STALE_275_4: RpcRow = { ...ROW_A, lead_id: 'lead-mount-stale-275-4', next_cursor: null, remaining: 0 };
    const ROW_REFOCO_275_4: RpcRow = { ...ROW_B, lead_id: 'lead-refoco-275-4', next_cursor: null, remaining: 0 };

    let resolve_mount!: (value: { data: RpcRow[]; error: null }) => void;
    const pending_mount = new Promise<{ data: RpcRow[]; error: null }>((resolve) => {
      resolve_mount = resolve;
    });
    const rpc = jest
      .fn()
      .mockReturnValueOnce(pending_mount) // carga inicial (mount) — LENTA
      .mockResolvedValueOnce({ data: [ROW_REFOCO_275_4], error: null }); // refoco — RÁPIDO
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));
    expect(captured_focus_callback).not.toBeNull();

    // Refoco disparado ANTES de que la carga inicial resuelva.
    await act(async () => {
      captured_focus_callback!();
    });
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-refoco-275-4']);

    // La carga inicial (obsoleta) resuelve tarde — no debe pisar el refoco.
    await act(async () => {
      resolve_mount({ data: [ROW_MOUNT_STALE_275_4], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-refoco-275-4']);
    expect(result.current.loading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Extensión RED (subtarea 275.4): barrido del guard de argumento faltante.
  // El guard `if (!agentId)` hoy resetea data/loading/error/hasMore/remaining
  // y next_cursor_ref, pero NO bumpea seq_ref — deben fallar hasta el GREEN.
  // -------------------------------------------------------------------------

  it('(EC-20) agentId_pasa_a_null_tras_estar_poblado_reinicia_data_hasmore_remaining_y_el_cursor_de_paginacion', async () => {
    const AGENT_ID_2_275_4 = 'agent-uuid-275-4-otro';
    const ROW_TRAS_TRANSICION_275_4: RpcRow = { ...ROW_C_ULTIMA_PAGINA, lead_id: 'lead-tras-transicion-275-4' };
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_A], error: null }) // agentId inicial
      .mockResolvedValueOnce({ data: [ROW_TRAS_TRANSICION_275_4], error: null }); // agentId nuevo tras null
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ agentId }: { agentId: string | null }) => useCrmLeadsPage(agentId, null, null),
      { initialProps: { agentId: AGENT_ID } },
    );
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-a']);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.remaining).toBe(1);

    await rerender({ agentId: null });

    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBeNull();

    // El cursor de paginación también debe reiniciarse: al volver a un
    // agentId válido, la llamada debe mandar p_cursor null, NUNCA
    // CURSOR_1 (rancio del agentId anterior).
    await rerender({ agentId: AGENT_ID_2_275_4 });

    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID_2_275_4,
      p_band: null,
      p_cursor: null,
      p_limit: 20,
      p_query: null,
    });
  });

  it('(EC-21) peticion_en_vuelo_del_agentId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_ni_pisa_el_cursor_D_SEQ', async () => {
    // Segundo aspecto del guard (guardian 275.3, hallazgo diferido a 275.4):
    // el branch `if (!agentId)` NO incrementa seq_ref. Una página en vuelo
    // del agentId ANTERIOR que resuelve DESPUÉS de la transición a null (y
    // MIENTRAS SIGUE en null — sin otra petición real de por medio que
    // adelante el token por su cuenta) pasa el guard del token y repuebla el
    // estado (data Y el cursor) que el guard acababa de limpiar.
    const CURSOR_A_LATE_275_4: RpcCursor = { as_of: '2026-09-01T09:00:00Z', temperature: 5, lead_id: 'lead-a-late-275-4' };
    const ROW_A_LATE_275_4: RpcRow = { ...ROW_A, lead_id: 'lead-a-late-275-4', next_cursor: CURSOR_A_LATE_275_4, remaining: 5 };

    let resolve_a!: (value: { data: RpcRow[]; error: null }) => void;
    const pending_a = new Promise<{ data: RpcRow[]; error: null }>((resolve) => {
      resolve_a = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending_a));

    const { result, rerender } = await renderHook(
      ({ agentId }: { agentId: string | null }) => useCrmLeadsPage(agentId, null, null),
      { initialProps: { agentId: 'agent-a-275-4' } },
    );

    await rerender({ agentId: null });
    expect(result.current.data).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBeNull();

    await act(async () => {
      resolve_a({ data: [ROW_A_LATE_275_4], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.remaining).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Extensión RED (subtarea 271.2, tarea #271 "crm-hoja-filtros"): status y
  // follow_up. SUT hoy: STUB — los acepta pero los IGNORA. Deben fallar hasta
  // el GREEN.
  // -------------------------------------------------------------------------

  it('(EC-22) status_y_follow_up_con_valor_viajan_exactos_a_la_rpc_como_array_y_boolean', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: [], error: null }));

    await renderHook(() =>
      useCrmLeadsPage(AGENT_ID, 'hot', 'ana', ['nuevo', 'contactado'], true),
    );

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: 'hot',
      p_cursor: null,
      p_limit: 20,
      p_query: 'ana',
      p_status: ['nuevo', 'contactado'],
      p_follow_up: true,
    });
  });

  it('(EC-23) status_y_follow_up_explicitos_en_null_viajan_como_null_nunca_undefined_ni_se_omiten_D_STATUSNULL', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: [], error: null }));

    await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null, null, null));

    const call_args = mock_supabase_holder.client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    // La clave debe EXISTIR (no estar omitida) y su valor debe ser null, no undefined.
    expect('p_status' in call_args).toBe(true);
    expect('p_follow_up' in call_args).toBe(true);
    expect(call_args.p_status).toBeNull();
    expect(call_args.p_follow_up).toBeNull();
  });

  it('(EC-24) status_y_follow_up_omitidos_por_completo_omiten_la_clave_retrocompat_con_llamador_sin_hoja_de_filtros_D_STATUSNULL', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: [], error: null }));

    // Llamador viejo (p.ej. CRMScreen.tsx antes de 271.3): solo 3 args
    // posicionales — status/followUp quedan `undefined`, NO `null`.
    await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null));

    const call_args = mock_supabase_holder.client.rpc.mock.calls[0]![1] as Record<string, unknown>;
    expect('p_status' in call_args).toBe(false);
    expect('p_follow_up' in call_args).toBe(false);
  });

  it('(EC-29) p_status_arreglo_vacio_explicito_se_manda_tal_cual_sin_normalizar_a_null_D_STATUSEMPTY', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: [], error: null }));

    await renderHook(() => useCrmLeadsPage(AGENT_ID, null, null, []));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: null,
      p_limit: 20,
      p_query: null,
      p_status: [],
    });
  });

  it('(EC-25) cambiar_status_reinicia_la_paginacion_solo_la_primera_pagina_del_filtro_nuevo_y_el_cursor_de_la_siguiente_llamada', async () => {
    const CURSOR_STATUS_1_271_2: RpcCursor = { as_of: '2026-09-07T10:00:00Z', temperature: 65, lead_id: 'lead-status-p1-271-2' };
    const CURSOR_STATUS_NUEVO_271_2: RpcCursor = { as_of: '2026-09-07T11:00:00Z', temperature: 50, lead_id: 'lead-status-nuevo-p2-271-2' };
    const ROW_STATUS_P1_271_2: RpcRow = { ...ROW_A, lead_id: 'lead-status-p1-271-2', status_projected: 'nuevo', next_cursor: CURSOR_STATUS_1_271_2, remaining: 1 };
    const ROW_STATUS_P2_ULTIMA_271_2: RpcRow = { ...ROW_B, lead_id: 'lead-status-p2-271-2', status_projected: 'nuevo', next_cursor: null, remaining: 0 };
    const ROW_STATUS_NUEVO_FILTRO_271_2: RpcRow = { ...ROW_A, lead_id: 'lead-status-nuevo-filtro-271-2', status_projected: 'contactado', next_cursor: CURSOR_STATUS_NUEVO_271_2, remaining: 1 };
    const ROW_STATUS_NUEVO_FILTRO_P2_271_2: RpcRow = { ...ROW_B, lead_id: 'lead-status-nuevo-filtro-p2-271-2', status_projected: 'contactado', next_cursor: null, remaining: 0 };

    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_STATUS_P1_271_2], error: null }) // página 1, status=['nuevo']
      .mockResolvedValueOnce({ data: [ROW_STATUS_P2_ULTIMA_271_2], error: null }) // loadMore, página 2
      .mockResolvedValueOnce({ data: [ROW_STATUS_NUEVO_FILTRO_271_2], error: null }) // status cambia a ['contactado']
      .mockResolvedValueOnce({ data: [ROW_STATUS_NUEVO_FILTRO_P2_271_2], error: null }); // loadMore del filtro nuevo
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ status }: { status: ProjectedStatus[] | null }) => useCrmLeadsPage(AGENT_ID, null, null, status),
      { initialProps: { status: ['nuevo'] as ProjectedStatus[] | null } },
    );
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-status-p1-271-2']);

    // Se puebla con 2 páginas ANTES de cambiar el filtro (memoria
    // reset_solo_se_prueba_desde_estado_poblado).
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-status-p1-271-2', 'lead-status-p2-271-2']);

    await rerender({ status: ['contactado'] });

    // Solo la primera página del filtro NUEVO — nunca concatenado sobre las
    // 2 páginas del filtro anterior.
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-status-nuevo-filtro-271-2']);
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: null,
      p_limit: 20,
      p_query: null,
      p_status: ['contactado'],
    });

    // El cursor de paginación también se reinició: el SIGUIENTE loadMore
    // debe mandar el cursor del filtro NUEVO (CURSOR_STATUS_NUEVO), nunca el
    // rancio del filtro anterior (CURSOR_STATUS_1) — verificado por el
    // p_cursor de la llamada siguiente, no leyendo el ref.
    await act(async () => {
      await result.current.loadMore();
    });
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: CURSOR_STATUS_NUEVO_271_2,
      p_limit: 20,
      p_query: null,
      p_status: ['contactado'],
    });
  });

  it('(EC-26) cambiar_follow_up_reinicia_la_paginacion_solo_la_primera_pagina_del_filtro_nuevo_y_el_cursor_de_la_siguiente_llamada', async () => {
    const CURSOR_FOLLOWUP_1_271_2: RpcCursor = { as_of: '2026-09-07T10:00:00Z', temperature: 60, lead_id: 'lead-followup-p1-271-2' };
    const CURSOR_FOLLOWUP_NUEVO_271_2: RpcCursor = { as_of: '2026-09-07T11:00:00Z', temperature: 45, lead_id: 'lead-followup-nuevo-p2-271-2' };
    const ROW_FOLLOWUP_P1_271_2: RpcRow = { ...ROW_A, lead_id: 'lead-followup-p1-271-2', next_cursor: CURSOR_FOLLOWUP_1_271_2, remaining: 1 };
    const ROW_FOLLOWUP_P2_ULTIMA_271_2: RpcRow = { ...ROW_B, lead_id: 'lead-followup-p2-271-2', next_cursor: null, remaining: 0 };
    const ROW_FOLLOWUP_NUEVO_FILTRO_271_2: RpcRow = { ...ROW_A, lead_id: 'lead-followup-nuevo-filtro-271-2', next_cursor: CURSOR_FOLLOWUP_NUEVO_271_2, remaining: 1 };

    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_FOLLOWUP_P1_271_2], error: null }) // página 1, followUp=true
      .mockResolvedValueOnce({ data: [ROW_FOLLOWUP_P2_ULTIMA_271_2], error: null }) // loadMore, página 2
      .mockResolvedValueOnce({ data: [ROW_FOLLOWUP_NUEVO_FILTRO_271_2], error: null }); // followUp cambia a false
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ followUp }: { followUp: boolean | null }) => useCrmLeadsPage(AGENT_ID, null, null, null, followUp),
      { initialProps: { followUp: true as boolean | null } },
    );
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-followup-p1-271-2']);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-followup-p1-271-2', 'lead-followup-p2-271-2']);

    await rerender({ followUp: false });

    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-followup-nuevo-filtro-271-2']);
    expect(rpc).toHaveBeenLastCalledWith('crm_leads_page', {
      p_agent_id: AGENT_ID,
      p_band: null,
      p_cursor: null,
      p_limit: 20,
      p_query: null,
      // CORRECCIÓN del orquestador (271.2, GREEN): la llamada de este caso pasa
      // `status` EXPLÍCITO como null (4º argumento), así que por D-STATUSNULL la
      // clave DEBE viajar. Omitirla aquí contradecía a EC-23, que asierta lo
      // contrario con exactamente el mismo escenario. Es un fallo de la
      // expectativa, no de la implementación: el arreglo la hace más estricta.
      p_status: null,
      p_follow_up: false,
    });
  });

  it('(EC-27) carrera_con_status_nuevo_la_respuesta_tardia_del_status_anterior_no_repuebla_una_lista_ya_reemplazada_D_SEQ', async () => {
    const ROW_STATUS_A_TARDIO_271_2: RpcRow = { ...ROW_A, lead_id: 'lead-status-a-tardio-271-2', status_projected: 'nuevo', next_cursor: null, remaining: 0 };
    const ROW_STATUS_B_RAPIDO_271_2: RpcRow = { ...ROW_B, lead_id: 'lead-status-b-rapido-271-2', status_projected: 'visita', next_cursor: null, remaining: 0 };

    let resolve_status_a!: (value: { data: RpcRow[]; error: null }) => void;
    const pending_status_a = new Promise<{ data: RpcRow[]; error: null }>((resolve) => {
      resolve_status_a = resolve;
    });
    const rpc = jest
      .fn()
      .mockReturnValueOnce(pending_status_a) // status=['nuevo'] — LENTA
      .mockResolvedValueOnce({ data: [ROW_STATUS_B_RAPIDO_271_2], error: null }); // status=['visita'] — RÁPIDA
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ status }: { status: ProjectedStatus[] | null }) => useCrmLeadsPage(AGENT_ID, null, null, status),
      { initialProps: { status: ['nuevo'] as ProjectedStatus[] | null } },
    );

    await rerender({ status: ['visita'] });
    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-status-b-rapido-271-2']);

    // La respuesta tardía de status=['nuevo'] resuelve DESPUÉS — no debe
    // repoblar la lista que ya quedó con el resultado de status=['visita'].
    await act(async () => {
      resolve_status_a({ data: [ROW_STATUS_A_TARDIO_271_2], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data.map((r) => r.lead_id)).toEqual(['lead-status-b-rapido-271-2']);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-28) array_de_status_estable_por_contenido_con_referencia_nueva_en_cada_render_no_hace_crecer_las_llamadas_a_la_rpc', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [ROW_A], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(
      ({ status }: { status: ProjectedStatus[] | null }) => useCrmLeadsPage(AGENT_ID, null, null, status),
      { initialProps: { status: ['nuevo', 'contactado'] as ProjectedStatus[] | null } },
    );
    const calls_after_mount = rpc.mock.calls.length;

    // Mismo CONTENIDO, referencia NUEVA en cada rerender (simula el padre
    // recreando el array inline — memoria hook_array_prop_reference_loop:
    // deps por referencia disparan refetch en bucle / heap OOM en Jest).
    await rerender({ status: ['nuevo', 'contactado'] });
    await rerender({ status: ['nuevo', 'contactado'] });
    await rerender({ status: ['nuevo', 'contactado'] });

    expect(rpc).toHaveBeenCalledTimes(calls_after_mount);
  });
});
