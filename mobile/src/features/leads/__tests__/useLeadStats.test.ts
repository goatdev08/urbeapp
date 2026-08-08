/**
 * Tests — useLeadStats hook
 * Archivo SUT: mobile/src/features/leads/hooks/useLeadStats.ts
 * Subtarea Taskmaster: 112.4 (hook nuevo dentro de features/leads/hooks/ → crítico por regla
 * determinista de CLAUDE.md §5, aunque la subtarea sea de UI)
 *
 * SUT: useLeadStats(leadIds: string[]) → { statsByLeadId, loading, error }
 *
 * Contrato (migración 20260808000002, subtarea 112.3 — RPC ya en producción del código,
 * ver header del hook):
 *   - UNA sola llamada `supabase.rpc('get_lead_stats', { p_lead_ids: leadIds })` por
 *     cambio de leadIds — NUNCA una llamada por lead (no-N+1, el requisito explícito
 *     de la subtarea).
 *   - leadIds=[] → NO dispara la RPC; statsByLeadId={}, loading=false de inmediato.
 *   - Cada fila del resultado se mapea a statsByLeadId[row.lead_id] = {vio_completo,
 *     veces_visto, guardo, ultima_actividad}.
 *   - Un lead_id pasado que NO aparece en el resultado (el RPC no le da like a la
 *     propiedad de origen) → AUSENTE del mapa (statsByLeadId[id] === undefined),
 *     nunca una fila con valores en falso/cero — la UI distingue "sin dato" de
 *     "dato en false".
 *   - Error de RPC → mensaje NEUTRO en español (nunca el texto crudo de Postgres/
 *     PostgREST), statsByLeadId={}.
 *   - loading=true de forma síncrona mientras la RPC (no vacía) está pendiente.
 *   - Cambiar leadIds (nueva referencia) redispara la RPC.
 *
 * PATRÓN DE MOCK: mock_supabase_holder + getter, idéntico a
 * useLeadStatusHistory.test.ts/useAgentLeads.test.ts. Como el SUT llama
 * `supabase.rpc(...)` directo (sin builder encadenado), el mock es un objeto
 * simple `{ rpc: jest.fn() }`.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) llama_rpc_una_sola_vez_con_todos_los_lead_ids_batch
 * - (EC-2) mapea_filas_del_resultado_a_statsByLeadId_por_lead_id
 *
 * ### Regla de negocio: ausencia = "sin señales", no error
 * - (EC-3) lead_id_sin_fila_en_el_resultado_queda_ausente_del_mapa
 *
 * ### Boundary
 * - (EC-4) leadIds_vacio_no_llama_rpc_y_resuelve_de_inmediato
 * - (EC-5) estado_loading_inicial_true_con_leadIds_no_vacio
 * - (EC-6) cambiar_leadIds_redispara_la_rpc_con_el_nuevo_array
 *
 * ### Error
 * - (EC-7) error_de_rpc_mensaje_en_espanol_no_crudo_stats_vacio
 */

import { renderHook } from '@testing-library/react-native';

import { useLeadStats } from '../hooks/useLeadStats';
import type { LeadStats } from '../types';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — patrón mock_supabase_holder con getter
// (idéntico a useLeadStatusHistory.test.ts). El SUT llama `supabase.rpc(...)`
// directo — el mock es un objeto plano `{ rpc: jest.fn() }`.
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
// Constantes de test
// ---------------------------------------------------------------------------

const LEAD_A = 'lead-uuid-112-4-a';
const LEAD_B = 'lead-uuid-112-4-b';
const LEAD_C_SIN_LIKE = 'lead-uuid-112-4-c-sin-like';

const ROW_A: LeadStats & { lead_id: string } = {
  lead_id: LEAD_A,
  vio_completo: true,
  veces_visto: 3,
  guardo: true,
  ultima_actividad: '2026-08-07T12:00:00Z',
};

const ROW_B: LeadStats & { lead_id: string } = {
  lead_id: LEAD_B,
  vio_completo: false,
  veces_visto: 1,
  guardo: false,
  ultima_actividad: '2026-08-06T09:00:00Z',
};

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
// ---------------------------------------------------------------------------

function make_supabase_mock(
  opts: {
    rpc_result?: { data: (LeadStats & { lead_id: string })[] | null; error: { message: string } | null };
  } = {},
): MockSupabaseClient {
  const { rpc_result = { data: [ROW_A, ROW_B], error: null } } = opts;
  return {
    rpc: jest.fn().mockResolvedValue(rpc_result),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLeadStats', () => {
  it('(EC-1) llama_rpc_una_sola_vez_con_todos_los_lead_ids_batch: 3 lead_ids visibles → UNA sola llamada a get_lead_stats con el array completo, nunca una por lead', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ROW_A, ROW_B], error: null },
    });

    await renderHook(() => useLeadStats([LEAD_A, LEAD_B, LEAD_C_SIN_LIKE]));

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('get_lead_stats', {
      p_lead_ids: [LEAD_A, LEAD_B, LEAD_C_SIN_LIKE],
    });
  });

  it('(EC-2) mapea_filas_del_resultado_a_statsByLeadId_por_lead_id: cada fila se mapea 1:1 a statsByLeadId[lead_id]', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ROW_A, ROW_B], error: null },
    });

    const { result } = await renderHook(() => useLeadStats([LEAD_A, LEAD_B]));

    expect(result.current.statsByLeadId[LEAD_A]).toEqual({
      vio_completo: true,
      veces_visto: 3,
      guardo: true,
      ultima_actividad: '2026-08-07T12:00:00Z',
    });
    expect(result.current.statsByLeadId[LEAD_B]).toEqual({
      vio_completo: false,
      veces_visto: 1,
      guardo: false,
      ultima_actividad: '2026-08-06T09:00:00Z',
    });
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(EC-3) lead_id_sin_fila_en_el_resultado_queda_ausente_del_mapa: LEAD_C sin like no viene en el resultado → statsByLeadId[LEAD_C] es undefined, no una fila con ceros/false', async () => {
    // El RPC solo devuelve A y B — C nunca dio like a su propiedad de origen.
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: [ROW_A, ROW_B], error: null },
    });

    const { result } = await renderHook(() =>
      useLeadStats([LEAD_A, LEAD_B, LEAD_C_SIN_LIKE]),
    );

    expect(result.current.statsByLeadId[LEAD_C_SIN_LIKE]).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.current.statsByLeadId, LEAD_C_SIN_LIKE)).toBe(
      false,
    );
    // A y B sí están presentes — la ausencia es específica de C, no un vaciado global.
    expect(result.current.statsByLeadId[LEAD_A]).toBeDefined();
    expect(result.current.statsByLeadId[LEAD_B]).toBeDefined();
  });

  it('(EC-4) leadIds_vacio_no_llama_rpc_y_resuelve_de_inmediato: sin leads visibles, no hay nada que consultar', async () => {
    const { result } = await renderHook(() => useLeadStats([]));

    expect(mock_supabase_holder.client.rpc).not.toHaveBeenCalled();
    expect(result.current.statsByLeadId).toEqual({});
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-5) estado_loading_inicial_true_con_leadIds_no_vacio: loading=true mientras la RPC (no vacía) está pendiente', async () => {
    const pending_rpc = new Promise<{ data: unknown[]; error: null }>(() => {});
    mock_supabase_holder.client = { rpc: jest.fn().mockReturnValue(pending_rpc) };

    const { result } = await renderHook(() => useLeadStats([LEAD_A]));

    expect(result.current.loading).toBe(true);
  });

  it('(EC-6) cambiar_leadIds_redispara_la_rpc_con_el_nuevo_array: una segunda lista de ids dispara una NUEVA llamada con esos ids', async () => {
    mock_supabase_holder.client = make_supabase_mock({ rpc_result: { data: [ROW_A], error: null } });
    const { rerender } = await renderHook(({ ids }: { ids: string[] }) => useLeadStats(ids), {
      initialProps: { ids: [LEAD_A] },
    });

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(1);
    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledWith('get_lead_stats', {
      p_lead_ids: [LEAD_A],
    });

    await rerender({ ids: [LEAD_A, LEAD_B] });

    expect(mock_supabase_holder.client.rpc).toHaveBeenCalledTimes(2);
    expect(mock_supabase_holder.client.rpc).toHaveBeenLastCalledWith('get_lead_stats', {
      p_lead_ids: [LEAD_A, LEAD_B],
    });
  });

  it('(EC-7) error_de_rpc_mensaje_en_espanol_no_crudo_stats_vacio: la RPC falla → mensaje neutro en español, statsByLeadId={}', async () => {
    const RAW_PG_MESSAGE = 'permission denied for function get_lead_stats';
    mock_supabase_holder.client = make_supabase_mock({
      rpc_result: { data: null, error: { message: RAW_PG_MESSAGE } },
    });

    const { result } = await renderHook(() => useLeadStats([LEAD_A]));

    expect(result.current.error).toBe(
      'No se pudieron cargar las estadísticas de actividad. Intenta de nuevo.',
    );
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.statsByLeadId).toEqual({});
    expect(result.current.loading).toBe(false);
  });
});
