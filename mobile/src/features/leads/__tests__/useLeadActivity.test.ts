/**
 * Tests fase RED — useLeadActivity (subtarea 266.7, rediseño CRM #266)
 * Archivo SUT: mobile/src/features/leads/hooks/useLeadActivity.ts (STUB que
 * lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useLeadActivity(leadId) → { data, loading, error, hasMore, loadInitial, loadMore, refetch }
 * — y el contrato exacto de la RPC `lead_activity` (migración
 * 20260906100004_crm_lead_detail_activity.sql, subtarea 266.5): params
 * `p_lead_id/p_limit/p_cursor`, filas `{occurred_at, kind, detail}`, y la
 * regla D-CURSOR de la migración: "la página puede traer MÁS filas que
 * p_limit" (expansión del empate en la frontera) — el hook NUNCA recorta lo
 * que la RPC ya decidió devolver.
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-INITIAL: loading = Boolean(leadId) en el primer render (sonda, memoria
 *   tests_bomba_de_fecha_y_estado_inicial). Sin useFocusEffect — este hook
 *   NO se suscribe a foco (solo useCrmLeadsPage/useCrmFunnel lo hacen, PLAN
 *   266.7): un useEffect plano con dep [leadId] basta.
 * - D-LIMIT: `p_limit` es SIEMPRE 20, explícito — precedente 266.5.
 * - D-CURSOR-HOOK: el cursor de la SIGUIENTE página es el `occurred_at` de
 *   la ÚLTIMA fila devuelta (NO un campo aparte de la RPC — lead_activity no
 *   expone next_cursor/remaining, a diferencia de crm_leads_page).
 * - D-NOTRUNC: si la RPC devuelve MÁS filas que las pedidas (empate de
 *   frontera, D-CURSOR de la migración), el hook conserva TODAS — nunca
 *   `.slice(0, p_limit)`.
 * - D-HASMORE: hasMore=false SOLO cuando una llamada resuelve con 0 filas;
 *   con >0 filas se asume que puede haber más (lead_activity no da un total).
 *
 * PATRÓN DE MOCK: idéntico a useCrmLeadsPage.test.ts (mock_supabase_holder +
 * getter, objeto plano `{ rpc: jest.fn() }`); renderHook/act con `await`;
 * unmount() dentro de act().
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_data_vacio_loading_true_sin_error
 * - (EC-2) llama_lead_activity_con_params_exactos_p_cursor_null_en_primera_pagina
 * - (EC-3) exito_mapea_filas_cursor_siguiente_es_occurred_at_de_la_ultima_fila
 *
 * ### Paginación
 * - (EC-4) load_more_manda_el_occurred_at_de_la_ultima_fila_como_cursor_y_apenda
 * - (EC-13) tercera_pagina_dos_load_more_consecutivos_mandan_el_occurred_at_de_CADA_pagina_
 *   previa_sin_duplicados: el mutante "solo actualizar el cursor cuando !append" sobrevive a
 *   EC-4 (un solo loadMore) — con dos loadMore consecutivos, el segundo debe mandar el
 *   occurred_at que dejó la SEGUNDA página, no repetir el de la primera (si no, en producción
 *   reenviaría el mismo cursor para siempre y duplicaría filas sin fin).
 * - (EC-5) refetch_reinicia_desde_null_y_reemplaza_data
 * - (EC-6) cambiar_leadId_reinicia_y_reemplaza_data
 * - (EC-7) rerender_con_el_mismo_leadId_no_dispara_otra_llamada
 *
 * ### Regla no obvia: empate de frontera (D-CURSOR de la migración 266.5)
 * - (EC-8) pagina_con_mas_filas_que_el_limite_se_conserva_completa_sin_recortar
 *
 * ### Boundary / error
 * - (EC-9) sin_filas_hasMore_false_sin_error
 * - (EC-10) error_de_rpc_mensaje_neutro_en_espanol_data_vacio_loading_false
 * - (EC-11) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act
 * - (EC-12) leadId_null_o_undefined_no_llama_rpc_estado_vacio_sin_error
 */

import { renderHook, act } from '@testing-library/react-native';

import { useLeadActivity } from '../hooks/useLeadActivity';
import type { LeadActivityEntry } from '../types';

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
// Fixtures
// ---------------------------------------------------------------------------

const LEAD_ID = 'lead-uuid-266-7-activity';

const ROW_1: LeadActivityEntry = {
  occurred_at: '2026-09-06T15:00:00Z',
  kind: 'video_view',
  detail: { property_id: 'prop-1', payload: { ms: 12000 } },
};
const ROW_2: LeadActivityEntry = {
  occurred_at: '2026-09-06T14:00:00Z',
  kind: 'like',
  detail: { property_id: 'prop-1' },
};
const ROW_3_ULTIMA_DE_PAGINA_1: LeadActivityEntry = {
  occurred_at: '2026-09-06T13:00:00Z',
  kind: 'save',
  detail: { property_id: 'prop-1' },
};
const ROW_4_SEGUNDA_PAGINA: LeadActivityEntry = {
  occurred_at: '2026-09-05T10:00:00Z',
  kind: 'status_change',
  detail: { old_status: 'new', new_status: 'contacted' },
};

// EC-13 (3ª página, 2 loadMore consecutivos) — cadena propia de 3 páginas
// con occurred_at ESTRICTAMENTE descendente entre páginas, para poder
// afirmar el cursor exacto que cada loadMore debe mandar.
const ROW_Q1: LeadActivityEntry = {
  occurred_at: '2026-09-06T12:00:00Z',
  kind: 'video_view',
  detail: { property_id: 'prop-q' },
};
const ROW_Q2: LeadActivityEntry = {
  occurred_at: '2026-09-05T09:00:00Z',
  kind: 'like',
  detail: { property_id: 'prop-q' },
};
const ROW_Q3_ULTIMA: LeadActivityEntry = {
  occurred_at: '2026-09-04T06:00:00Z',
  kind: 'save',
  detail: { property_id: 'prop-q' },
};

/** Genera N filas con occurred_at estrictamente descendente (empate de frontera). */
function make_rows(n: number): LeadActivityEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    occurred_at: `2026-09-06T${String(23 - i).padStart(2, '0')}:00:00Z`,
    kind: 'video_view',
    detail: { property_id: 'prop-1' },
  }));
}

function make_supabase_mock(
  rpc_impl: jest.Mock = jest.fn().mockResolvedValue({ data: [], error: null }),
): MockSupabaseClient {
  return { rpc: rpc_impl };
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLeadActivity', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_data_vacio_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useLeadActivity>[] = [];
    function useProbe() {
      const state = useLeadActivity(LEAD_ID);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.data).toEqual([]);
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
    expect(first.hasMore).toBe(false);
  });

  it('(EC-2) llama_lead_activity_con_params_exactos_p_cursor_null_en_primera_pagina', async () => {
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: [ROW_1, ROW_2, ROW_3_ULTIMA_DE_PAGINA_1], error: null }),
    );

    await renderHook(() => useLeadActivity(LEAD_ID));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('lead_activity', {
      p_lead_id: LEAD_ID,
      p_limit: 20,
      p_cursor: null,
    });
  });

  it('(EC-3) exito_mapea_filas_cursor_siguiente_es_occurred_at_de_la_ultima_fila', async () => {
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: [ROW_1, ROW_2, ROW_3_ULTIMA_DE_PAGINA_1], error: null }),
    );

    const { result } = await renderHook(() => useLeadActivity(LEAD_ID));

    expect(result.current.data).toEqual([ROW_1, ROW_2, ROW_3_ULTIMA_DE_PAGINA_1]);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-4) load_more_manda_el_occurred_at_de_la_ultima_fila_como_cursor_y_apenda', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_1, ROW_2, ROW_3_ULTIMA_DE_PAGINA_1], error: null })
      .mockResolvedValueOnce({ data: [ROW_4_SEGUNDA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useLeadActivity(LEAD_ID));
    expect(result.current.data).toHaveLength(3);

    await act(async () => {
      await result.current.loadMore();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('lead_activity', {
      p_lead_id: LEAD_ID,
      p_limit: 20,
      p_cursor: ROW_3_ULTIMA_DE_PAGINA_1.occurred_at,
    });
    expect(result.current.data).toEqual([ROW_1, ROW_2, ROW_3_ULTIMA_DE_PAGINA_1, ROW_4_SEGUNDA_PAGINA]);
  });

  it('(EC-13) tercera_pagina_dos_load_more_consecutivos_mandan_el_occurred_at_de_CADA_pagina_previa_sin_duplicados', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_Q1], error: null })
      .mockResolvedValueOnce({ data: [ROW_Q2], error: null })
      .mockResolvedValueOnce({ data: [ROW_Q3_ULTIMA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useLeadActivity(LEAD_ID));
    expect(result.current.data).toEqual([ROW_Q1]);

    await act(async () => {
      await result.current.loadMore();
    });
    expect(rpc).toHaveBeenNthCalledWith(2, 'lead_activity', {
      p_lead_id: LEAD_ID,
      p_limit: 20,
      p_cursor: ROW_Q1.occurred_at,
    });
    expect(result.current.data).toEqual([ROW_Q1, ROW_Q2]);

    // El SEGUNDO loadMore es la clave del candado: debe mandar el
    // occurred_at que dejó la SEGUNDA página (ROW_Q2), NUNCA repetir el de
    // la primera (el mutante "solo actualizar el cursor cuando !append"
    // congela el ref en el valor de la carga inicial y este assert lo
    // destapa).
    await act(async () => {
      await result.current.loadMore();
    });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(3, 'lead_activity', {
      p_lead_id: LEAD_ID,
      p_limit: 20,
      p_cursor: ROW_Q2.occurred_at,
    });

    // Las 3 páginas acumuladas, sin duplicados.
    expect(result.current.data).toEqual([ROW_Q1, ROW_Q2, ROW_Q3_ULTIMA]);
    expect(result.current.hasMore).toBe(true);
  });

  it('(EC-5) refetch_reinicia_desde_null_y_reemplaza_data', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_1, ROW_2, ROW_3_ULTIMA_DE_PAGINA_1], error: null })
      .mockResolvedValueOnce({ data: [ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useLeadActivity(LEAD_ID));
    expect(result.current.data).toHaveLength(3);

    await act(async () => {
      await result.current.refetch();
    });

    expect(rpc).toHaveBeenLastCalledWith('lead_activity', {
      p_lead_id: LEAD_ID,
      p_limit: 20,
      p_cursor: null,
    });
    expect(result.current.data).toEqual([ROW_1]);
  });

  it('(EC-6) cambiar_leadId_reinicia_y_reemplaza_data', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [ROW_1, ROW_2], error: null })
      .mockResolvedValueOnce({ data: [ROW_4_SEGUNDA_PAGINA], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadActivity(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.data).toHaveLength(2);

    await rerender({ leadId: 'lead-uuid-266-7-otro' });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('lead_activity', {
      p_lead_id: 'lead-uuid-266-7-otro',
      p_limit: 20,
      p_cursor: null,
    });
    expect(result.current.data).toEqual([ROW_4_SEGUNDA_PAGINA]);
  });

  it('(EC-7) rerender_con_el_mismo_leadId_no_dispara_otra_llamada', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(({ leadId }: { leadId: string }) => useLeadActivity(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await rerender({ leadId: LEAD_ID });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-8) pagina_con_mas_filas_que_el_limite_se_conserva_completa_sin_recortar', async () => {
    const filas_de_empate = make_rows(22); // más que p_limit=20
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: filas_de_empate, error: null }),
    );

    const { result } = await renderHook(() => useLeadActivity(LEAD_ID));

    expect(result.current.data).toHaveLength(22);
    expect(result.current.data).toEqual(filas_de_empate);
  });

  it('(EC-9) sin_filas_hasMore_false_sin_error', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: [], error: null }));

    const { result } = await renderHook(() => useLeadActivity(LEAD_ID));

    expect(result.current.data).toEqual([]);
    expect(result.current.hasMore).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-10) error_de_rpc_mensaje_neutro_en_espanol_data_vacio_loading_false', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function lead_activity';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useLeadActivity(LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar la actividad del lead. Intenta de nuevo.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.hasMore).toBe(false);
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
  it('(EC-11) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act', async () => {
    let resolve_rpc!: (value: { data: LeadActivityEntry[]; error: null }) => void;
    const pending = new Promise<{ data: LeadActivityEntry[]; error: null }>((resolve) => {
      resolve_rpc = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useLeadActivity(LEAD_ID));

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
      resolve_rpc({ data: [ROW_1], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-12) leadId_null_o_undefined_no_llama_rpc_estado_vacio_sin_error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result: result_null } = await renderHook(() => useLeadActivity(null));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_null.current.data).toEqual([]);
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useLeadActivity(undefined));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_undefined.current.data).toEqual([]);
  });
});
