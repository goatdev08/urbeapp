/**
 * Tests fase RED — useCrmRadarAnon (subtarea 266.7, rediseño CRM #266)
 * Archivo SUT: mobile/src/features/leads/hooks/useCrmRadarAnon.ts (STUB que
 * lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useCrmRadarAnon(agentId, limit?) → { data, loading, error, refetch }
 * — y el contrato exacto de la RPC `crm_radar_anon` (migración
 * 20260906100005_crm_radar_anon.sql, subtarea 266.6): params
 * `p_agent_id/p_limit`, filas `{row_n, property_label, temperature, delta,
 * sparkline, signals, last_activity_at}` — 🔒 SIN NINGUNA columna capaz de
 * portar identidad (la pieza de mayor riesgo de privacidad de la épica,
 * §7.5/75.3).
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-INITIAL: loading = Boolean(agentId) en el primer render (sonda).
 * - Sin useFocusEffect — PLAN 266.7: useCrmRadarAnon NO se suscribe a foco.
 * - D-LIMIT-EXPLICIT: `p_limit` viaja SIEMPRE explícito, nunca undefined —
 *   precedente 266.5. `limit` ausente/null en la llamada al hook usa el
 *   default 20 ANTES de llamar la RPC (mismo criterio D-LIMIT-RADAR de la
 *   migración: 0 NO abre el pool completo, NULL usa el default).
 * - Molde useLeadStats: UNA sola llamada `supabase.rpc`, error neutro en
 *   español, deps por contenido.
 * - 🔒 D-SIN-IDENTIDAD: el tipo `CrmRadarRow` (types.ts) no declara
 *   user_id/lead_id — se afirma en runtime que las claves de cada fila
 *   mapeada son EXACTAMENTE las 7 esperadas, ninguna de más.
 *
 * PATRÓN DE MOCK: '@/lib/supabase/client' con mock_supabase_holder + getter;
 * renderHook/act con `await`; unmount() dentro de act().
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_data_vacio_loading_true_sin_error
 * - (EC-2) llama_crm_radar_anon_con_params_exactos_p_limit_explicito
 * - (EC-3) exito_mapea_las_filas_1_a_1
 *
 * ### 🔒 Privacidad — invariante de tipo (75.3/§7.5)
 * - (EC-4) las_filas_mapeadas_tienen_exactamente_las_7_claves_sin_identidad: la fila CRUDA
 *   que la RPC podría llegar a devolver (por un bug en el SQL, o un cambio futuro) trae
 *   `user_id`/`lead_id`/`email` contaminantes — el hook debe DESCARTARLAS explícitamente.
 *   Un mapeo por spread (`{ ...row }`) pasaría los demás 11 tests (las fixtures del resto
 *   ya vienen limpias) pero cae aquí: es el único test que ancla "mapeo explícito de 7
 *   claves", no "mapeo de lo que sea que llegue".
 *
 * ### Boundary — p_limit nunca undefined
 * - (EC-5) limit_ausente_usa_el_default_20_explicito_en_la_llamada
 * - (EC-6) limit_null_usa_el_default_20_explicito_en_la_llamada
 *
 * ### Deps por contenido / estabilidad
 * - (EC-7) rerender_con_el_mismo_agentId_limit_no_dispara_otra_llamada
 * - (EC-8) cambiar_limit_dispara_una_llamada_nueva_con_el_nuevo_valor
 *
 * ### Boundary / error
 * - (EC-9) error_de_rpc_mensaje_neutro_en_espanol_data_vacio
 * - (EC-10) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act
 * - (EC-11) agentId_null_o_undefined_no_llama_rpc_data_vacio_sin_error
 * - (EC-12) refetch_manual_redispara_la_rpc
 *
 * ### Extensión RED (subtarea 275.4, tarea #275 "hardening(267.6)",
 * 2026-09-07, AMPLIACIÓN DE ALCANCE): D-SEQ + try/catch, molde
 * useCrmLeadDetail.ts/useLeadRawFields.ts. Hoy el hook NO tiene seq_ref ni
 * try/catch — estos casos DEBEN fallar hasta el GREEN.
 * - (EC-13) rechazo_real_de_red_desde_estado_poblado_error_neutro_y_data_vacia_no_vacuo
 * - (EC-14) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_repuebla_data
 * - (EC-15) respuesta_tardia_de_un_agentId_anterior_no_pisa_el_radar_del_actual_D_SEQ
 *
 * ### Extensión RED (275.4, frente B): barrido del guard de argumento
 * faltante — el guard `if (!agentId)` no se prueba en TRANSICIÓN (solo en el
 * primer render, donde useState ya nace vacío) y no bumpea seq_ref.
 * - (EC-16) agentId_pasa_a_null_tras_estar_poblado_reinicia_data_a_vacio_sin_error_loading_false
 * - (EC-17) peticion_en_vuelo_del_agentId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_D_SEQ
 */

import { renderHook, act } from '@testing-library/react-native';

import { useCrmRadarAnon } from '../hooks/useCrmRadarAnon';
import type { CrmRadarRow } from '../types';

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

const AGENT_ID = 'agent-uuid-266-7-radar';

const RADAR_ROW_1: CrmRadarRow = {
  row_n: 1,
  property_label: 'Av. Reforma 100',
  temperature: 65,
  delta: 20,
  sparkline: [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0],
  signals: { views: 4, completed: true, saved: false, liked: true },
  last_activity_at: '2026-09-06T09:00:00Z',
};

const RADAR_ROW_2: CrmRadarRow = {
  row_n: 2,
  property_label: 'Calle Sur 20',
  temperature: 30,
  delta: 10,
  sparkline: [0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1],
  signals: { views: 1, completed: false, saved: true, liked: false },
  last_activity_at: '2026-09-05T18:00:00Z',
};

/**
 * Fila CRUDA (tal como podría llegar de la RPC) con claves CONTAMINANTES de
 * identidad — `user_id`/`lead_id`/`email` — que 🔒 D-SIN-IDENTIDAD prohíbe
 * exponer. `unknown` a propósito: `CrmRadarRow` (types.ts) NO declara estas
 * claves, así que anclarla al tipo público ocultaría el propio caso que EC-4
 * quiere cazar (un `as CrmRadarRow` recortaría la forma en el mock antes de
 * que el hook tenga oportunidad de filtrarla).
 */
const RAW_ROW_CONTAMINADA: unknown = {
  row_n: 1,
  property_label: 'Av. Reforma 100',
  temperature: 65,
  delta: 20,
  sparkline: [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1, 0],
  signals: { views: 4, completed: true, saved: false, liked: true },
  last_activity_at: '2026-09-06T09:00:00Z',
  // Contaminantes — NUNCA deben sobrevivir al mapeo del hook.
  user_id: 'user-uuid-fuga-266-7',
  lead_id: 'lead-uuid-fuga-266-7',
  email: 'fuga@example.com',
};

function make_supabase_mock(
  rpc_impl: jest.Mock = jest.fn().mockResolvedValue({ data: [RADAR_ROW_1, RADAR_ROW_2], error: null }),
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

describe('useCrmRadarAnon', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_data_vacio_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const render_states: ReturnType<typeof useCrmRadarAnon>[] = [];
    function useProbe() {
      const state = useCrmRadarAnon(AGENT_ID, 20);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.data).toEqual([]);
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
  });

  it('(EC-2) llama_crm_radar_anon_con_params_exactos_p_limit_explicito', async () => {
    await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_radar_anon', {
      p_agent_id: AGENT_ID,
      p_limit: 20,
    });
  });

  it('(EC-3) exito_mapea_las_filas_1_a_1', async () => {
    const { result } = await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));

    expect(result.current.data).toEqual([RADAR_ROW_1, RADAR_ROW_2]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-4) las_filas_mapeadas_tienen_exactamente_las_7_claves_sin_identidad', async () => {
    // La fila CRUDA que la RPC devuelve trae user_id/lead_id/email colados —
    // el hook debe descartarlas explícitamente (mapeo por spread las dejaría
    // pasar, ver el comentario de RAW_ROW_CONTAMINADA arriba).
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: [RAW_ROW_CONTAMINADA], error: null }),
    );

    const { result } = await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));

    const EXPECTED_KEYS = [
      'row_n',
      'property_label',
      'temperature',
      'delta',
      'sparkline',
      'signals',
      'last_activity_at',
    ].sort();

    expect(result.current.data).toHaveLength(1);
    for (const row of result.current.data) {
      expect(Object.keys(row).sort()).toEqual(EXPECTED_KEYS);
      expect(Object.prototype.hasOwnProperty.call(row, 'user_id')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row, 'lead_id')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(row, 'email')).toBe(false);
    }
    // La forma limpia esperada, byte a byte — no solo "sin esas 3 claves".
    expect(result.current.data[0]).toEqual(RADAR_ROW_1);
  });

  it('(EC-5) limit_ausente_usa_el_default_20_explicito_en_la_llamada', async () => {
    await renderHook(() => useCrmRadarAnon(AGENT_ID));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_radar_anon', {
      p_agent_id: AGENT_ID,
      p_limit: 20,
    });
  });

  it('(EC-6) limit_null_usa_el_default_20_explicito_en_la_llamada', async () => {
    await renderHook(() => useCrmRadarAnon(AGENT_ID, null));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('crm_radar_anon', {
      p_agent_id: AGENT_ID,
      p_limit: 20,
    });
  });

  it('(EC-7) rerender_con_el_mismo_agentId_limit_no_dispara_otra_llamada', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [RADAR_ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(({ limit }: { limit: number }) => useCrmRadarAnon(AGENT_ID, limit), {
      initialProps: { limit: 20 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await rerender({ limit: 20 });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-8) cambiar_limit_dispara_una_llamada_nueva_con_el_nuevo_valor', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [RADAR_ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { rerender } = await renderHook(({ limit }: { limit: number }) => useCrmRadarAnon(AGENT_ID, limit), {
      initialProps: { limit: 20 },
    });
    expect(rpc).toHaveBeenCalledTimes(1);

    await rerender({ limit: 5 });

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith('crm_radar_anon', { p_agent_id: AGENT_ID, p_limit: 5 });
  });

  it('(EC-9) error_de_rpc_mensaje_neutro_en_espanol_data_vacio', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function crm_radar_anon';
    mock_supabase_holder.client = make_supabase_mock(
      jest.fn().mockResolvedValue({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));

    expect(result.current.error).toBe('No se pudo cargar el radar de interesados. Intenta de nuevo.');
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
  it('(EC-10) unmount_durante_llamada_en_vuelo_no_aplica_estado_sin_warning_act', async () => {
    let resolve_rpc!: (value: { data: CrmRadarRow[]; error: null }) => void;
    const pending = new Promise<{ data: CrmRadarRow[]; error: null }>((resolve) => {
      resolve_rpc = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending));

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));

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
      resolve_rpc({ data: [RADAR_ROW_1], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });

  it('(EC-11) agentId_null_o_undefined_no_llama_rpc_data_vacio_sin_error', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [RADAR_ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result: result_null } = await renderHook(() => useCrmRadarAnon(null, 20));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_null.current.data).toEqual([]);
    expect(result_null.current.loading).toBe(false);
    expect(result_null.current.error).toBeNull();

    const { result: result_undefined } = await renderHook(() => useCrmRadarAnon(undefined, 20));
    expect(rpc).not.toHaveBeenCalled();
    expect(result_undefined.current.data).toEqual([]);
  });

  it('(EC-12) refetch_manual_redispara_la_rpc', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [RADAR_ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));
    expect(rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(rpc).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Extensión RED (subtarea 275.4): D-SEQ + try/catch, molde
  // useCrmLeadDetail.ts. El hook hoy NO tiene seq_ref ni try/catch — deben
  // fallar hasta el GREEN.
  // -------------------------------------------------------------------------

  it('(EC-13) rechazo_real_de_red_desde_estado_poblado_error_neutro_y_data_vacia_no_vacuo', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [RADAR_ROW_1, RADAR_ROW_2], error: null })
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));
    expect(result.current.data).toEqual([RADAR_ROW_1, RADAR_ROW_2]);

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBe('No se pudo cargar el radar de interesados. Intenta de nuevo.');
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-14) recuperacion_tras_error_un_refetch_exitoso_limpia_el_error_y_repuebla_data', async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [RADAR_ROW_1], error: null })
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce({ data: [RADAR_ROW_2], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result } = await renderHook(() => useCrmRadarAnon(AGENT_ID, 20));

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.error).toBe('No se pudo cargar el radar de interesados. Intenta de nuevo.');

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual([RADAR_ROW_2]);
  });

  it('(EC-15) respuesta_tardia_de_un_agentId_anterior_no_pisa_el_radar_del_actual_D_SEQ', async () => {
    let resolve_a!: (value: { data: CrmRadarRow[]; error: null }) => void;
    const pending_a = new Promise<{ data: CrmRadarRow[]; error: null }>((resolve) => {
      resolve_a = resolve;
    });
    const rpc = jest
      .fn()
      .mockReturnValueOnce(pending_a)
      .mockResolvedValueOnce({ data: [RADAR_ROW_2], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(({ agentId }: { agentId: string }) => useCrmRadarAnon(agentId, 20), {
      initialProps: { agentId: 'agent-a-275-4' },
    });
    await rerender({ agentId: 'agent-b-275-4' });
    expect(result.current.data).toEqual([RADAR_ROW_2]);

    await act(async () => {
      resolve_a({ data: [RADAR_ROW_1], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toEqual([RADAR_ROW_2]);
    expect(result.current.loading).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Extensión RED (subtarea 275.4): barrido del guard de argumento faltante.
  // El guard `if (!agentId)` hoy resetea data/loading/error pero NO bumpea
  // seq_ref — deben fallar hasta el GREEN.
  // -------------------------------------------------------------------------

  it('(EC-16) agentId_pasa_a_null_tras_estar_poblado_reinicia_data_a_vacio_sin_error_loading_false', async () => {
    const rpc = jest.fn().mockResolvedValue({ data: [RADAR_ROW_1], error: null });
    mock_supabase_holder.client = make_supabase_mock(rpc);

    const { result, rerender } = await renderHook(
      ({ agentId }: { agentId: string | null }) => useCrmRadarAnon(agentId, 20),
      { initialProps: { agentId: AGENT_ID } },
    );
    expect(result.current.data).toEqual([RADAR_ROW_1]);

    await rerender({ agentId: null });

    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-17) peticion_en_vuelo_del_agentId_anterior_resuelve_tras_la_transicion_a_null_y_no_repuebla_D_SEQ', async () => {
    let resolve_a!: (value: { data: CrmRadarRow[]; error: null }) => void;
    const pending_a = new Promise<{ data: CrmRadarRow[]; error: null }>((resolve) => {
      resolve_a = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(jest.fn().mockReturnValue(pending_a));

    const { result, rerender } = await renderHook(
      ({ agentId }: { agentId: string | null }) => useCrmRadarAnon(agentId, 20),
      { initialProps: { agentId: AGENT_ID } },
    );

    await rerender({ agentId: null });
    expect(result.current.data).toEqual([]);

    await act(async () => {
      resolve_a({ data: [RADAR_ROW_1], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});
