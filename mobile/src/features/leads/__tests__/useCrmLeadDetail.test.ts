/**
 * Tests fase RED — useCrmLeadDetail (subtarea 266.7, rediseño CRM #266)
 * Archivo SUT: mobile/src/features/leads/hooks/useCrmLeadDetail.ts (STUB que
 * lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useCrmLeadDetail(leadId) → { data, loading, error, refetch }
 * — y el contrato exacto de la RPC `crm_lead_detail` (migración
 * 20260906100004_crm_lead_detail_activity.sql, subtarea 266.5): param
 * `p_lead_id`, UNA sola fila `{origin_property, other_properties,
 * suggested_next_status}` (SELECT sin FROM → siempre 1 fila si autorizado;
 * D-AUTZ-SHARED fail-closed → 0 filas si no autorizado o lead borrado).
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-INITIAL: loading = Boolean(leadId) en el primer render (sonda).
 * - Sin useFocusEffect — PLAN 266.7: useCrmLeadDetail NO se suscribe a foco
 *   (solo useCrmLeadsPage/useCrmFunnel lo hacen). useEffect plano con dep
 *   [leadId].
 * - Molde useLeadStats: UNA sola llamada `supabase.rpc`, error neutro en
 *   español, deps por contenido.
 * - D-SINFILA: 0 filas (fail-closed de la RPC: no autorizado o lead
 *   deleted_at no null) → data=null SIN error (silencioso, igual que
 *   "agente sin agencia" en otras RPC de la épica — nunca se distingue "no
 *   existe" de "no es tuyo", anti-IDOR).
 *
 * PATRÓN DE MOCK: '@/lib/supabase/client' con mock_supabase_holder + getter;
 * renderHook/act con `await`; unmount() dentro de act().
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_data_null_loading_true_sin_error
 * - (EC-2) llama_crm_lead_detail_con_params_exactos
 * - (EC-3) exito_mapea_la_fila_unica_1_a_1
 *
 * ### Rama de regla no obvia: origin_property nulo (lead sin origen)
 * - (EC-4) origin_property_null_no_es_error_sigue_mapeando_el_resto
 *
 * ### Deps por contenido / estabilidad
 * - (EC-5) rerender_con_el_mismo_leadId_no_dispara_otra_llamada
 * - (EC-6) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_data
 *
 * ### Boundary / error
 * - (EC-7) sin_fila_fail_closed_data_null_sin_error
 * - (EC-8) error_de_rpc_mensaje_neutro_en_espanol_data_null
 * - (EC-9) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act
 * - (EC-10) leadId_null_o_undefined_no_llama_rpc_data_null_sin_error
 * - (EC-11) refetch_manual_redispara_la_rpc
 */

import { renderHook, act } from '@testing-library/react-native';

import { useCrmLeadDetail } from '../hooks/useCrmLeadDetail';
import type { CrmLeadDetail } from '../types';

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

const LEAD_ID = 'lead-uuid-266-7-detail';

const DETAIL_ROW_CON_ORIGEN: CrmLeadDetail = {
  origin_property: {
    property_id: 'prop-1',
    address: 'Av. Reforma 100',
    price: 2500000,
    thumbnail_url: 'https://storage.example/prop-1.jpg',
  },
  other_properties: 2,
  suggested_next_status: 'visit_scheduled',
};

const DETAIL_ROW_SIN_ORIGEN: CrmLeadDetail = {
  origin_property: null,
  other_properties: 0,
  suggested_next_status: 'contacted',
};

function make_supabase_mock(
  rpc_impl: jest.Mock = jest.fn().mockResolvedValue({ data: [DETAIL_ROW_CON_ORIGEN], error: null }),
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

describe('useCrmLeadDetail', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_data_null_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useCrmLeadDetail>[] = [];
    function useProbe() {
      const state = useCrmLeadDetail(LEAD_ID);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.data).toBeNull();
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
  });

  it('(EC-2) llama_crm_lead_detail_con_params_exactos', async () => {
    await renderHook(() => useCrmLeadDetail(LEAD_ID));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_lead_detail', {
      p_lead_id: LEAD_ID,
    });
  });

  it('(EC-3) exito_mapea_la_fila_unica_1_a_1', async () => {
    const { result } = await renderHook(() => useCrmLeadDetail(LEAD_ID));

    expect(result.current.data).toEqual({
      origin_property: {
        property_id: 'prop-1',
        address: 'Av. Reforma 100',
        price: 2500000,
        thumbnail_url: 'https://storage.example/prop-1.jpg',
      },
      other_properties: 2,
      suggested_next_status: 'visit_scheduled',
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-4) origin_property_null_no_es_error_sigue_mapeando_el_resto', async () => {
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: [DETAIL_ROW_SIN_ORIGEN], error: null }),
    );

    const { result } = await renderHook(() => useCrmLeadDetail(LEAD_ID));

    expect(result.current.data).toEqual({
      origin_property: null,
      other_properties: 0,
      suggested_next_status: 'contacted',
    });
    expect(result.current.error).toBeNull();
  });

  it('(EC-5) rerender_con_el_mismo_leadId_no_dispara_otra_llamada', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [DETAIL_ROW_CON_ORIGEN], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(({ leadId }: { leadId: string }) => useCrmLeadDetail(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await rerender({ leadId: LEAD_ID });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-6) cambiar_leadId_dispara_una_llamada_nueva_y_reinicia_data', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [DETAIL_ROW_CON_ORIGEN], error: null })
      .mockResolvedValueOnce({ data: [DETAIL_ROW_SIN_ORIGEN], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(({ leadId }: { leadId: string }) => useCrmLeadDetail(leadId), {
      initialProps: { leadId: LEAD_ID },
    });
    expect(result.current.data?.other_properties).toBe(2);

    await rerender({ leadId: 'lead-uuid-266-7-otro' });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_lead_detail', { p_lead_id: 'lead-uuid-266-7-otro' });
    expect(result.current.data).toEqual(DETAIL_ROW_SIN_ORIGEN);
  });

  it('(EC-7) sin_fila_fail_closed_data_null_sin_error', async () => {
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockResolvedValue({ data: [], error: null }));

    const { result } = await renderHook(() => useCrmLeadDetail(LEAD_ID));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-8) error_de_rpc_mensaje_neutro_en_espanol_data_null', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function crm_lead_detail';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useCrmLeadDetail(LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar la ficha del lead. Intenta de nuevo.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.data).toBeNull();
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
  it('(EC-9) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act', async () => {
    let resolve_rpc!: (value: { data: CrmLeadDetail[]; error: null }) => void;
    const pending = new Promise<{ data: CrmLeadDetail[]; error: null }>((resolve) => {
      resolve_rpc = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useCrmLeadDetail(LEAD_ID));

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
      resolve_rpc({ data: [DETAIL_ROW_CON_ORIGEN], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-10) leadId_null_o_undefined_no_llama_rpc_data_null_sin_error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [DETAIL_ROW_CON_ORIGEN], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result: result_null } = await renderHook(() => useCrmLeadDetail(null));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_null.current.data).toBeNull();
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useCrmLeadDetail(undefined));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_undefined.current.data).toBeNull();
  });

  it('(EC-11) refetch_manual_redispara_la_rpc', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [DETAIL_ROW_CON_ORIGEN], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmLeadDetail(LEAD_ID));
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
