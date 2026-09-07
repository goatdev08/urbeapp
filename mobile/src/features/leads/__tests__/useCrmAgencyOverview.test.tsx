/**
 * Tests fase RED — useCrmAgencyOverview (subtarea 269.5, CRM vista de
 * agencia, exploración 045 fase E).
 * Archivo SUT: mobile/src/features/leads/hooks/useCrmAgencyOverview.ts
 * (STUB que lanza 'not_implemented' — la implementación real es el GREEN).
 *
 * SEAM bajo test: la firma pública del hook —
 *   useCrmAgencyOverview(agency_id) → { agents, unmanaged, loading, error, refetch }
 * — y el contrato exacto de la RPC `crm_agency_overview`
 * (migración 20260906400001_crm_agency_overview.sql, subtarea 269.1):
 * param `p_agency_id`, filas con `kind: 'agent'|'unmanaged'` y los campos
 * del "otro" kind siempre NULL en cada fila (ver database.types.ts).
 *
 * DECISIONES DE DISEÑO DEL CONTRATO (D-XXX de esta subtarea):
 * - D-INITIAL: loading = Boolean(agency_id) en el primer render (sonda,
 *   molde useCrmFunnel D-INITIAL).
 * - D-FOCUS: molde useCrmFunnel (useFocusEffect + useCallback, deps
 *   [agency_id]).
 * - D-SPLIT: el hook separa las filas crudas por `kind` en DOS arreglos
 *   TIPADOS, sin arrastrar `kind` ni los campos NULL del otro kind
 *   (AgencyAgentRow / UnmanagedLeadRow, exportados por el propio hook —
 *   ver stub). Se preserva el ORDEN que la RPC ya devuelve (D-ORDER de la
 *   migración: kind asc, agent_name asc / temperature desc) — el hook NO
 *   reordena en cliente.
 * - D-BINDING (memoria supabase_js_metodo_desprendido — precedente #205/
 *   170.4, 36 tests verdes sobre una feature muerta): el doble de Supabase
 *   es SENSIBLE AL BINDING (`make_binding_sensitive_supabase_mock`,
 *   `@/test-utils/supabaseMock`, candado #233.3) — un GREEN que
 *   desprendiera `client.rpc(...)` (`const {rpc} = supabase; rpc(...)`)
 *   lanza y la suite deja de estar en verde. Nunca un objeto plano
 *   `{rpc: jest.fn()}` (ciego a ese bug).
 *
 * PATRÓN DE MOCK: 'expo-router'.useFocusEffect calcado de
 * useCrmFunnel.test.ts; '@/lib/supabase/client' con
 * mock_supabase_holder + getter que expone el `.client` del bundle
 * `make_binding_sensitive_supabase_mock`; renderHook/act con `await`;
 * unmount() dentro de act().
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) estado_inicial_antes_del_efecto_arreglos_vacios_loading_true_sin_error
 * - (EC-2) llama_crm_agency_overview_con_p_agency_id_exacto
 * - (EC-3) separa_filas_agent_y_unmanaged_en_arreglos_tipados_sin_campos_null_cruzados
 * - (EC-4) preserva_el_orden_de_la_rpc_sin_reordenar_en_cliente
 *
 * ### Refetch por foco
 * - (EC-5) refoco_real_redispara_la_rpc
 * - (EC-6) refetch_manual_redispara_la_rpc
 *
 * ### Seam de binding
 * - (EC-7) rpc_se_invoca_con_this_intacto_no_lanza_por_desprendimiento
 *
 * ### agency_id null
 * - (EC-8) agency_id_null_no_llama_rpc_arreglos_vacios_loading_false
 *
 * ### Deps por contenido / estabilidad
 * - (EC-9) rerender_con_el_mismo_agency_id_no_dispara_otra_llamada
 * - (EC-10) cambiar_agency_id_dispara_una_llamada_nueva_con_el_nuevo_valor
 *
 * ### Boundary / error
 * - (EC-11) rpc_sin_filas_arreglos_vacios_sin_error_0_filas_es_legitimo
 * - (EC-12) error_de_rpc_mensaje_legible_en_espanol_sin_pii_arreglos_vacios
 * - (EC-13) unmount_durante_llamada_en_vuelo_no_lanza_sin_warning_act
 */

import { act, renderHook } from '@testing-library/react-native';

import { make_binding_sensitive_supabase_mock } from '@/test-utils/supabaseMock';

import { useCrmAgencyOverview } from '../hooks/useCrmAgencyOverview';
import type { AgencyAgentRow, UnmanagedLeadRow } from '../hooks/useCrmAgencyOverview';

// ---------------------------------------------------------------------------
// Mock de useFocusEffect (expo-router) — calco de useCrmFunnel.test.ts
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
// Mock del cliente Supabase — sensible al binding (candado #233.3)
// ---------------------------------------------------------------------------

const mock_supabase_holder: { bundle: ReturnType<typeof make_binding_sensitive_supabase_mock> | null } = {
  bundle: null,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.bundle?.client;
  },
}));

// ---------------------------------------------------------------------------
// Fixtures — literales, fuente independiente del código (no recomputados).
// Shape crudo EXACTO de la RPC (database.types.ts crm_agency_overview).
// ---------------------------------------------------------------------------

const AGENCY_ID = 'agencia-uuid-269-5-overview';

interface RawOverviewRow {
  kind: string;
  agent_id: string | null;
  agent_name: string | null;
  lead_id: string | null;
  untouched_count: number | null;
  response_hours: number | null;
  avg_temperature: number | null;
  flag: string | null;
  temperature: number | null;
  first_contact_at: string | null;
  lead_display_name: string | null;
}

const AGENT_ROW_1: RawOverviewRow = {
  kind: 'agent',
  agent_id: 'agent-uuid-1',
  agent_name: 'Laura Gómez',
  lead_id: null,
  untouched_count: 4,
  response_hours: 18.5,
  avg_temperature: 62,
  flag: 'pierde_leads',
  temperature: null,
  first_contact_at: null,
  lead_display_name: null,
};

const AGENT_ROW_2: RawOverviewRow = {
  kind: 'agent',
  agent_id: 'agent-uuid-2',
  agent_name: 'Marco Díaz',
  lead_id: null,
  untouched_count: 1,
  response_hours: null,
  avg_temperature: 40,
  flag: null,
  temperature: null,
  first_contact_at: null,
  lead_display_name: null,
};

const UNMANAGED_ROW_1: RawOverviewRow = {
  kind: 'unmanaged',
  agent_id: null,
  agent_name: null,
  lead_id: 'lead-uuid-1',
  untouched_count: null,
  response_hours: null,
  avg_temperature: null,
  flag: null,
  temperature: 71,
  first_contact_at: '2026-09-01T10:00:00.000Z',
  lead_display_name: 'Juan Pérez',
};

const EXPECTED_AGENT_1: AgencyAgentRow = {
  agent_id: 'agent-uuid-1',
  agent_name: 'Laura Gómez',
  untouched_count: 4,
  response_hours: 18.5,
  avg_temperature: 62,
  flag: 'pierde_leads',
};

const EXPECTED_AGENT_2: AgencyAgentRow = {
  agent_id: 'agent-uuid-2',
  agent_name: 'Marco Díaz',
  untouched_count: 1,
  response_hours: null,
  avg_temperature: 40,
  flag: null,
};

const EXPECTED_UNMANAGED_1: UnmanagedLeadRow = {
  lead_id: 'lead-uuid-1',
  lead_display_name: 'Juan Pérez',
  temperature: 71,
  first_contact_at: '2026-09-01T10:00:00.000Z',
};

function make_bundle(
  rpc_impl: () => Promise<{ data: RawOverviewRow[] | null; error: { message: string } | null }> = () =>
    Promise.resolve({ data: [AGENT_ROW_1, AGENT_ROW_2, UNMANAGED_ROW_1], error: null }),
) {
  return make_binding_sensitive_supabase_mock({ rpc: rpc_impl });
}

beforeEach(() => {
  jest.clearAllMocks();
  captured_focus_callback = null;
  mock_supabase_holder.bundle = make_bundle();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCrmAgencyOverview', () => {
  it('(EC-1) estado_inicial_antes_del_efecto_arreglos_vacios_loading_true_sin_error', async () => {
    const pending = new Promise<never>(() => {});
    mock_supabase_holder.bundle = make_bundle(() => pending);

    const render_states: ReturnType<typeof useCrmAgencyOverview>[] = [];
    function useProbe() {
      const state = useCrmAgencyOverview(AGENCY_ID);
      render_states.push(state);
      return state;
    }

    await renderHook(() => useProbe());

    const first = render_states[0]!;
    expect(first.agents).toEqual([]);
    expect(first.unmanaged).toEqual([]);
    expect(first.loading).toBe(true);
    expect(first.error).toBeNull();
  });

  it('(EC-2) llama_crm_agency_overview_con_p_agency_id_exacto', async () => {
    await renderHook(() => useCrmAgencyOverview(AGENCY_ID));

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledWith('crm_agency_overview', {
      p_agency_id: AGENCY_ID,
    });
  });

  it('(EC-3) separa_filas_agent_y_unmanaged_en_arreglos_tipados_sin_campos_null_cruzados', async () => {
    const { result } = await renderHook(() => useCrmAgencyOverview(AGENCY_ID));

    expect(result.current.agents).toEqual([EXPECTED_AGENT_1, EXPECTED_AGENT_2]);
    expect(result.current.unmanaged).toEqual([EXPECTED_UNMANAGED_1]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    // Ningún objeto del arreglo agents lleva 'kind' ni campos de unmanaged.
    for (const row of result.current.agents) {
      expect(Object.keys(row).sort()).toEqual(
        ['agent_id', 'agent_name', 'avg_temperature', 'flag', 'response_hours', 'untouched_count'].sort(),
      );
    }
    // Ningún objeto del arreglo unmanaged lleva 'kind' ni campos de agent.
    for (const row of result.current.unmanaged) {
      expect(Object.keys(row).sort()).toEqual(
        ['first_contact_at', 'lead_display_name', 'lead_id', 'temperature'].sort(),
      );
    }
  });

  it('(EC-4) preserva_el_orden_de_la_rpc_sin_reordenar_en_cliente', async () => {
    // La RPC ya llega en un orden DISTINTO al alfabético (D-ORDER real:
    // kind asc, agent_name asc — pero el hook NO debe volver a ordenar).
    const shuffled = [AGENT_ROW_2, AGENT_ROW_1];
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: shuffled, error: null }),
    );

    const { result } = await renderHook(() => useCrmAgencyOverview(AGENCY_ID));

    expect(result.current.agents.map((a) => a.agent_id)).toEqual(['agent-uuid-2', 'agent-uuid-1']);
  });

  it('(EC-5) refoco_real_redispara_la_rpc', async () => {
    await renderHook(() => useCrmAgencyOverview(AGENCY_ID));
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);
    expect(captured_focus_callback).not.toBeNull();

    await act(async () => {
      captured_focus_callback!();
    });

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(2);
  });

  it('(EC-6) refetch_manual_redispara_la_rpc', async () => {
    const { result } = await renderHook(() => useCrmAgencyOverview(AGENCY_ID));
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(2);
  });

  it('(EC-7) rpc_se_invoca_con_this_intacto_no_lanza_por_desprendimiento', async () => {
    // El doble sensible al binding LANZA un TypeError si el SUT desprende
    // client.rpc del cliente (candado #233.3) — si el GREEN escribe
    // `const {rpc} = supabase; rpc(...)`, renderHook rechaza y este test
    // falla con el TypeError del guard, no con una aserción de negocio.
    const { result } = await renderHook(() => useCrmAgencyOverview(AGENCY_ID));
    expect(result.current.error).toBeNull();
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-8) agency_id_null_no_llama_rpc_arreglos_vacios_loading_false', async () => {
    const { result } = await renderHook(() => useCrmAgencyOverview(null));

    expect(mock_supabase_holder.bundle!._mock_rpc).not.toHaveBeenCalled();
    expect(result.current.agents).toEqual([]);
    expect(result.current.unmanaged).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-9) rerender_con_el_mismo_agency_id_no_dispara_otra_llamada', async () => {
    const { rerender } = await renderHook(
      ({ agency_id }: { agency_id: string }) => useCrmAgencyOverview(agency_id),
      { initialProps: { agency_id: AGENCY_ID } },
    );
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);

    await rerender({ agency_id: AGENCY_ID });

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);
  });

  it('(EC-10) cambiar_agency_id_dispara_una_llamada_nueva_con_el_nuevo_valor', async () => {
    const OTHER_AGENCY_ID = 'agencia-uuid-269-5-otra';
    const { rerender } = await renderHook(
      ({ agency_id }: { agency_id: string }) => useCrmAgencyOverview(agency_id),
      { initialProps: { agency_id: AGENCY_ID } },
    );
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(1);

    await rerender({ agency_id: OTHER_AGENCY_ID });

    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenCalledTimes(2);
    expect(mock_supabase_holder.bundle!._mock_rpc).toHaveBeenLastCalledWith('crm_agency_overview', {
      p_agency_id: OTHER_AGENCY_ID,
    });
  });

  it('(EC-11) rpc_sin_filas_arreglos_vacios_sin_error_0_filas_es_legitimo', async () => {
    // D-AUTZ fail-closed de la migración: quien no es owner/admin activo
    // recibe 0 filas SIN excepción — no es un error, es un resultado válido.
    mock_supabase_holder.bundle = make_bundle(() => Promise.resolve({ data: [], error: null }));

    const { result } = await renderHook(() => useCrmAgencyOverview(AGENCY_ID));

    expect(result.current.agents).toEqual([]);
    expect(result.current.unmanaged).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-12) error_de_rpc_mensaje_legible_en_espanol_sin_pii_arreglos_vacios', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function crm_agency_overview';
    mock_supabase_holder.bundle = make_bundle(() =>
      Promise.resolve({ data: null, error: { message: RAW_PG_MESSAGE } }),
    );

    const { result } = await renderHook(() => useCrmAgencyOverview(AGENCY_ID));

    expect(result.current.error).toBe('No se pudo cargar la vista de agencia del CRM. Intenta de nuevo.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.error).not.toMatch(/agent_name|lead_display_name|Laura|Marco|Juan/);
    expect(result.current.agents).toEqual([]);
    expect(result.current.unmanaged).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-13) unmount_durante_llamada_en_vuelo_no_lanza_sin_warning_act', async () => {
    let resolve_rpc!: (value: { data: RawOverviewRow[]; error: null }) => void;
    const pending = new Promise<{ data: RawOverviewRow[]; error: null }>((resolve) => {
      resolve_rpc = resolve;
    });
    mock_supabase_holder.bundle = make_bundle(() => pending);

    const console_error_spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderHook(() => useCrmAgencyOverview(AGENCY_ID));

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
      resolve_rpc({ data: [AGENT_ROW_1], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(console_error_spy).not.toHaveBeenCalled();
    console_error_spy.mockRestore();
  });
});
