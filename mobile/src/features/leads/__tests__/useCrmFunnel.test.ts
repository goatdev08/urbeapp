/**
 * Tests fase RED — useCrmFunnel (subtarea 266.7, rediseño CRM #266)
 * Archivo SUT: mobile/src/features/leads/hooks/useCrmFunnel.ts (STUB que
 * lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useCrmFunnel(agentId, days) → { data, loading, error, refetch }
 * — y el contrato exacto de la RPC `crm_funnel` (migración
 * 20260906100003_crm_leads_page_funnel.sql, subtarea 266.4): params
 * `p_agent_id/p_days`, UNA sola fila con los 5 KPIs (vieron/volvieron/
 * guardaron/contactaron/agendaron), SIEMPRE conteos enteros.
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-INITIAL: loading = Boolean(agentId) en el primer render (sonda).
 * - D-FOCUS: molde useAgentProfile.ts (useFocusEffect + useCallback con deps
 *   [agentId, days]) — el primer foco coincide con el mount; PLAN 266.7:
 *   useCrmFunnel SÍ se suscribe a foco (a diferencia de leadDetail/activity/
 *   radarAnon).
 * - D-DAYS-EXPLICIT: `p_days` viaja SIEMPRE explícito (nunca undefined) —
 *   mismo precedente que p_limit en 266.5.
 * - Molde useLeadStats: UNA sola llamada `supabase.rpc` por carga, error
 *   neutro en español, deps por contenido.
 *
 * PATRÓN DE MOCK: 'expo-router'.useFocusEffect calcado de
 * useCrmLeadsPage.test.ts/useAgentProfile.test.tsx; '@/lib/supabase/client'
 * con mock_supabase_holder + getter; renderHook/act con `await`; unmount()
 * dentro de act().
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_data_null_loading_true_sin_error
 * - (EC-2) llama_crm_funnel_con_params_exactos_p_days_explicito
 * - (EC-3) exito_mapea_la_fila_unica_a_los_5_kpis_1_a_1
 *
 * ### Refetch por foco
 * - (EC-4) refoco_real_redispara_la_rpc
 * - (EC-5) refetch_manual_redispara_la_rpc
 *
 * ### Deps por contenido / estabilidad
 * - (EC-6) rerender_con_el_mismo_agentId_days_no_dispara_otra_llamada
 * - (EC-7) cambiar_days_dispara_una_llamada_nueva_con_el_nuevo_valor
 *
 * ### Boundary / error
 * - (EC-8) error_de_rpc_mensaje_neutro_en_espanol_data_null
 * - (EC-9) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act
 * - (EC-10) agentId_null_o_undefined_no_llama_rpc_data_null_sin_error
 *
 * ### Extensión RED (subtarea 275.4, tarea #275 "hardening(267.6)",
 * 2026-09-07, AMPLIACIÓN DE ALCANCE): D-SEQ + try/catch, molde
 * useCrmLeadDetail.ts/useLeadRawFields.ts. Hoy el hook NO tiene seq_ref ni
 * try/catch — estos casos DEBEN fallar hasta el GREEN. La carrera que
 * importa aquí es un cambio de `days` (no de agentId) y un refoco disparado
 * mientras una petición anterior sigue en vuelo.
 * - (EC-11) carrera_de_days_la_respuesta_tardia_del_days_anterior_no_pisa_el_embudo_del_days_actual_D_SEQ
 * - (EC-12) rechazo_real_de_red_desde_estado_poblado_error_neutro_y_data_null_no_vacuo
 * - (EC-13) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_repuebla_data
 * - (EC-14) refoco_disparado_durante_una_peticion_anterior_en_vuelo_no_pisa_el_resultado_del_refoco_D_SEQ
 *
 * ### Extensión RED (275.4, frente B): barrido del guard de argumento
 * faltante — el guard `if (!agentId)` no se prueba en TRANSICIÓN (solo en el
 * primer render, donde useState ya nace vacío) y no bumpea seq_ref.
 * - (EC-15) agentId_pasa_a_null_tras_estar_poblado_reinicia_data_a_null_sin_error_loading_false
 * - (EC-16) peticion_en_vuelo_del_agentId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_D_SEQ
 */

import { renderHook, act } from '@testing-library/react-native';

import { useCrmFunnel } from '../hooks/useCrmFunnel';
import type { CrmFunnel } from '../types';

// ---------------------------------------------------------------------------
// Mock de useFocusEffect (expo-router)
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
// Fixtures — literales, fuente independiente del código (no recomputados)
// ---------------------------------------------------------------------------

const AGENT_ID = 'agent-uuid-266-7-funnel';

const FUNNEL_ROW: CrmFunnel = {
  vieron: 42,
  volvieron: 17,
  guardaron: 9,
  contactaron: 5,
  agendaron: 2,
};

function make_supabase_mock(
  rpc_impl: jest.Mock = jest.fn().mockResolvedValue({ data: [FUNNEL_ROW], error: null }),
): MockSupabaseClient {
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

describe('useCrmFunnel', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_data_null_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useCrmFunnel>[] = [];
    function useProbe() {
      const state = useCrmFunnel(AGENT_ID, 30);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.data).toBeNull();
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
  });

  it('(EC-2) llama_crm_funnel_con_params_exactos_p_days_explicito', async () => {
    await renderHook(() => useCrmFunnel(AGENT_ID, 30));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_funnel', {
      p_agent_id: AGENT_ID,
      p_days: 30,
    });
  });

  it('(EC-3) exito_mapea_la_fila_unica_a_los_5_kpis_1_a_1', async () => {
    const { result } = await renderHook(() => useCrmFunnel(AGENT_ID, 30));

    expect(result.current.data).toEqual({
      vieron: 42,
      volvieron: 17,
      guardaron: 9,
      contactaron: 5,
      agendaron: 2,
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-4) refoco_real_redispara_la_rpc', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [FUNNEL_ROW], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    await renderHook(() => useCrmFunnel(AGENT_ID, 30));
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(captured_focus_callback).not.toBeNull();

    await act(async () => {
      captured_focus_callback!();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('(EC-5) refetch_manual_redispara_la_rpc', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [FUNNEL_ROW], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmFunnel(AGENT_ID, 30));
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('(EC-6) rerender_con_el_mismo_agentId_days_no_dispara_otra_llamada', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [FUNNEL_ROW], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(({ days }: { days: number }) => useCrmFunnel(AGENT_ID, days), {
      initialProps: { days: 30 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await rerender({ days: 30 });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-7) cambiar_days_dispara_una_llamada_nueva_con_el_nuevo_valor', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [FUNNEL_ROW], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(({ days }: { days: number }) => useCrmFunnel(AGENT_ID, days), {
      initialProps: { days: 30 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await rerender({ days: 7 });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_funnel', { p_agent_id: AGENT_ID, p_days: 7 });
  });

  it('(EC-8) error_de_rpc_mensaje_neutro_en_espanol_data_null', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function crm_funnel';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useCrmFunnel(AGENT_ID, 30));

    expect(result.current.error).toBe('No se pudo cargar el embudo del CRM. Intenta de nuevo.');
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
    let resolve_rpc!: (value: { data: CrmFunnel[]; error: null }) => void;
    const pending = new Promise<{ data: CrmFunnel[]; error: null }>((resolve) => {
      resolve_rpc = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useCrmFunnel(AGENT_ID, 30));

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
      resolve_rpc({ data: [FUNNEL_ROW], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-10) agentId_null_o_undefined_no_llama_rpc_data_null_sin_error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [FUNNEL_ROW], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result: result_null } = await renderHook(() => useCrmFunnel(null, 30));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_null.current.data).toBeNull();
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useCrmFunnel(undefined, 30));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_undefined.current.data).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Extensión RED (subtarea 275.4): D-SEQ + try/catch, molde
  // useCrmLeadDetail.ts. El hook hoy NO tiene seq_ref ni try/catch — deben
  // fallar hasta el GREEN.
  // -------------------------------------------------------------------------

  it('(EC-11) carrera_de_days_la_respuesta_tardia_del_days_anterior_no_pisa_el_embudo_del_days_actual_D_SEQ', async () => {
    const FUNNEL_30_DIAS_LENTO: CrmFunnel = {
      vieron: 999,
      volvieron: 999,
      guardaron: 999,
      contactaron: 999,
      agendaron: 999,
    };
    const FUNNEL_7_DIAS_RAPIDO: CrmFunnel = {
      vieron: 3,
      volvieron: 1,
      guardaron: 0,
      contactaron: 0,
      agendaron: 0,
    };
    let resolve_lento!: (value: { data: CrmFunnel[]; error: null }) => void;
    const pending_lento = new Promise<{ data: CrmFunnel[]; error: null }>((resolve) => {
      resolve_lento = resolve;
    });
    const rpc = jest
      .fn()
      .mockReturnValueOnce(pending_lento)
      .mockResolvedValueOnce({ data: [FUNNEL_7_DIAS_RAPIDO], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(({ days }: { days: number }) => useCrmFunnel(AGENT_ID, days), {
      initialProps: { days: 30 },
    });
    await rerender({ days: 7 });
    expect(result.current.data).toEqual(FUNNEL_7_DIAS_RAPIDO);

    await act(async () => {
      resolve_lento({ data: [FUNNEL_30_DIAS_LENTO], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toEqual(FUNNEL_7_DIAS_RAPIDO);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-12) rechazo_real_de_red_desde_estado_poblado_error_neutro_y_data_null_no_vacuo', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [FUNNEL_ROW], error: null })
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmFunnel(AGENT_ID, 30));
    expect(result.current.data).toEqual(FUNNEL_ROW);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBe('No se pudo cargar el embudo del CRM. Intenta de nuevo.');
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-13) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_repuebla_data', async () => {
    const OTRO_FUNNEL: CrmFunnel = { vieron: 2, volvieron: 1, guardaron: 1, contactaron: 0, agendaron: 0 };
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [FUNNEL_ROW], error: null })
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ data: [OTRO_FUNNEL], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmFunnel(AGENT_ID, 30));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe('No se pudo cargar el embudo del CRM. Intenta de nuevo.');

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(OTRO_FUNNEL);
  });

  it('(EC-14) refoco_disparado_durante_una_peticion_anterior_en_vuelo_no_pisa_el_resultado_del_refoco_D_SEQ', async () => {
    const FUNNEL_MOUNT_LENTO: CrmFunnel = {
      vieron: 111,
      volvieron: 111,
      guardaron: 111,
      contactaron: 111,
      agendaron: 111,
    };
    const FUNNEL_REFOCO_RAPIDO: CrmFunnel = { vieron: 5, volvieron: 2, guardaron: 1, contactaron: 1, agendaron: 0 };
    let resolve_mount!: (value: { data: CrmFunnel[]; error: null }) => void;
    const pending_mount = new Promise<{ data: CrmFunnel[]; error: null }>((resolve) => {
      resolve_mount = resolve;
    });
    const rpc = jest
      .fn()
      .mockReturnValueOnce(pending_mount) // carga inicial (mount) — LENTA
      .mockResolvedValueOnce({ data: [FUNNEL_REFOCO_RAPIDO], error: null }); // refoco — RÁPIDO
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmFunnel(AGENT_ID, 30));
    expect(captured_focus_callback).not.toBeNull();

    // Refoco disparado ANTES de que la carga inicial resuelva.
    await act(async () => {
      captured_focus_callback!();
    });
    expect(result.current.data).toEqual(FUNNEL_REFOCO_RAPIDO);

    // La carga inicial (obsoleta) resuelve tarde — no debe pisar el refoco.
    await act(async () => {
      resolve_mount({ data: [FUNNEL_MOUNT_LENTO], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toEqual(FUNNEL_REFOCO_RAPIDO);
    expect(result.current.loading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Extensión RED (subtarea 275.4): barrido del guard de argumento faltante.
  // El guard `if (!agentId)` hoy resetea data/loading/error pero NO bumpea
  // seq_ref — deben fallar hasta el GREEN.
  // -------------------------------------------------------------------------

  it('(EC-15) agentId_pasa_a_null_tras_estar_poblado_reinicia_data_a_null_sin_error_loading_false', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [FUNNEL_ROW], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ agentId }: { agentId: string | null }) => useCrmFunnel(agentId, 30),
      { initialProps: { agentId: AGENT_ID } },
    );
    expect(result.current.data).toEqual(FUNNEL_ROW);

    await rerender({ agentId: null });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-16) peticion_en_vuelo_del_agentId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_D_SEQ', async () => {
    let resolve_a!: (value: { data: CrmFunnel[]; error: null }) => void;
    const pending_a = new Promise<{ data: CrmFunnel[]; error: null }>((resolve) => {
      resolve_a = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending_a));

    const { result, rerender } = await renderHook(
      ({ agentId }: { agentId: string | null }) => useCrmFunnel(agentId, 30),
      { initialProps: { agentId: AGENT_ID } },
    );

    await rerender({ agentId: null });
    expect(result.current.data).toBeNull();

    await act(async () => {
      resolve_a({ data: [FUNNEL_ROW], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
