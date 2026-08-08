/**
 * Tests fase RED — useLeadStatusHistory hook (NUEVO)
 * Archivo SUT: mobile/src/features/leads/hooks/useLeadStatusHistory.ts
 * Subtarea Taskmaster: 75.6 (tramo móvil) — timeline de solo lectura del embudo
 *
 * SUT: useLeadStatusHistory(leadId) → { history, loading, error, refetch }
 *
 * SEAM: la firma pública exportada del hook (mismo criterio que useAgentLeads/
 * useAgencyRole — no se testea contra la tabla directo por otro canal).
 *
 * Contrato asumido (ver header del stub — el GREEN debe respetarlo):
 *   Query: from('lead_status_history').select('*').eq('lead_id', leadId)
 *     .order('changed_at', { ascending: false })
 *   - RLS (can_view_lead) filtra qué leads puede ver el caller — sin filtro
 *     de agente explícito aquí.
 *   - Lista vacía NO es error.
 *   - Error de query → mensaje NEUTRO en español (nunca el texto crudo de
 *     Postgres/PostgREST) — mismo criterio que useAgentLeads (punto 1/3).
 *
 * Estado del SUT en RED: stub que LANZA 'not_implemented' (hook nuevo, sin
 * comportamiento previo que preservar) — todos los casos fallan por excepción
 * en el render, no por import.
 *
 * EDGE CASES (RED):
 *
 * ### Happy path
 * - (H-1) trae_filas_del_lead_ordenadas_mas_reciente_primero: el hook llama
 *   .eq('lead_id', leadId) y .order('changed_at', {ascending:false}); history
 *   mapea 1:1 las filas del mock EN EL ORDEN que la query devuelve (no
 *   re-ordena client-side).
 *
 * ### Edge cases del PRD (§19.8 — timeline append-only del embudo)
 * - (H-2) lista_vacia_no_es_error: lead sin cambios de estado registrados aún
 *   → history=[], error=null (NO se trata como fallo).
 *
 * ### Ramas de reglas no obvias
 * - (H-4) no_se_piden_filas_de_otro_lead: el filtro .eq('lead_id', ...) usa
 *   EXACTAMENTE el leadId pasado al hook — dos leadId distintos producen dos
 *   llamadas con el argumento correcto cada una (guard contra un id
 *   hardcodeado o filtrado de otra fuente).
 *
 * ### Boundary / error
 * - (H-3) error_de_query_mensaje_en_espanol_no_crudo: la query falla → error
 *   es un mensaje en español (literal fijo, no el texto crudo de Postgres),
 *   history=[], no crashea.
 * - (H-5) estado_loading_inicial_true: loading=true mientras el fetch está
 *   pendiente (mismo patrón que useAgentLeads EC-8 / useAgencyRole EC-5).
 */

import { renderHook } from '@testing-library/react-native';

import { useLeadStatusHistory } from '../hooks/useLeadStatusHistory';
import type { LeadStatusHistoryEntry } from '../types';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — patrón mock_supabase_holder con getter
// (idéntico a useAgentLeads.test.ts / useAgencyRole.test.ts).
//
// Cadena de query esperada:
//   supabase.from('lead_status_history')
//     .select('*')
//     .eq('lead_id', leadId)
//     .order('changed_at', { ascending: false })
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock_history> } = {
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

const TEST_LEAD_ID = 'lead-uuid-history-75-6';
const OTHER_LEAD_ID = 'lead-uuid-history-otro-lead';

const RAW_ROW_RECIENTE: LeadStatusHistoryEntry = {
  id: 'history-row-002',
  lead_id: TEST_LEAD_ID,
  old_status: 'contacted',
  new_status: 'visit_scheduled',
  changed_by: 'agente-uuid-history-75',
  changed_at: '2026-08-07T12:00:00Z',
};

const RAW_ROW_ANTIGUA: LeadStatusHistoryEntry = {
  id: 'history-row-001',
  lead_id: TEST_LEAD_ID,
  old_status: null,
  new_status: 'whatsapp_opened',
  changed_by: 'agente-uuid-history-75',
  changed_at: '2026-08-01T09:00:00Z',
};

// ---------------------------------------------------------------------------
// Factory del mock de Supabase
// ---------------------------------------------------------------------------

function make_supabase_mock_history(
  opts: {
    query_result?: {
      data: LeadStatusHistoryEntry[] | null;
      error: { message: string } | null;
    };
  } = {},
) {
  const { query_result = { data: [RAW_ROW_RECIENTE, RAW_ROW_ANTIGUA], error: null } } = opts;

  const mock_order = jest.fn().mockResolvedValue(query_result);
  const mock_eq = jest.fn().mockReturnValue({ order: mock_order });
  const mock_select = jest.fn().mockReturnValue({ eq: mock_eq });
  const mock_from = jest.fn().mockReturnValue({ select: mock_select });

  return {
    from: mock_from,
    _mock_from: mock_from,
    _mock_select: mock_select,
    _mock_eq: mock_eq,
    _mock_order: mock_order,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock_history();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useLeadStatusHistory', () => {
  it('(H-1) trae_filas_del_lead_ordenadas_mas_reciente_primero: filtra por lead_id, ordena por changed_at desc y mapea las filas 1:1 en el orden del mock', async () => {
    mock_supabase_holder.client = make_supabase_mock_history({
      query_result: { data: [RAW_ROW_RECIENTE, RAW_ROW_ANTIGUA], error: null },
    });

    const { result } = await renderHook(() => useLeadStatusHistory(TEST_LEAD_ID));

    expect(mock_supabase_holder.client._mock_from).toHaveBeenCalledWith('lead_status_history');
    expect(mock_supabase_holder.client._mock_eq).toHaveBeenCalledWith('lead_id', TEST_LEAD_ID);
    expect(mock_supabase_holder.client._mock_order).toHaveBeenCalledWith('changed_at', {
      ascending: false,
    });

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[0]?.id).toBe('history-row-002');
    expect(result.current.history[0]?.new_status).toBe('visit_scheduled');
    expect(result.current.history[1]?.id).toBe('history-row-001');
    expect(result.current.history[1]?.old_status).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(H-2) lista_vacia_no_es_error: lead sin cambios de estado registrados → history=[] y error=null (no se trata como fallo)', async () => {
    mock_supabase_holder.client = make_supabase_mock_history({
      query_result: { data: [], error: null },
    });

    const { result } = await renderHook(() => useLeadStatusHistory(TEST_LEAD_ID));

    expect(result.current.history).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('(H-3) error_de_query_mensaje_en_espanol_no_crudo: la query falla → error es un mensaje neutro en español (no el texto crudo de Postgres), history=[]', async () => {
    const RAW_PG_MESSAGE = 'permission denied for table lead_status_history';
    mock_supabase_holder.client = make_supabase_mock_history({
      query_result: { data: null, error: { message: RAW_PG_MESSAGE } },
    });

    const { result } = await renderHook(() => useLeadStatusHistory(TEST_LEAD_ID));

    expect(result.current.error).toBe('No se pudo cargar el historial del lead. Intenta de nuevo.');
    expect(result.current.error).not.toBe(RAW_PG_MESSAGE);
    expect(result.current.history).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('(H-4) no_se_piden_filas_de_otro_lead: el filtro .eq("lead_id", …) usa exactamente el leadId pasado al hook, no uno hardcodeado', async () => {
    mock_supabase_holder.client = make_supabase_mock_history();
    await renderHook(() => useLeadStatusHistory(TEST_LEAD_ID));
    expect(mock_supabase_holder.client._mock_eq).toHaveBeenCalledWith('lead_id', TEST_LEAD_ID);
    expect(mock_supabase_holder.client._mock_eq).not.toHaveBeenCalledWith(
      'lead_id',
      OTHER_LEAD_ID,
    );

    jest.clearAllMocks();
    mock_supabase_holder.client = make_supabase_mock_history();
    await renderHook(() => useLeadStatusHistory(OTHER_LEAD_ID));
    expect(mock_supabase_holder.client._mock_eq).toHaveBeenCalledWith('lead_id', OTHER_LEAD_ID);
    expect(mock_supabase_holder.client._mock_eq).not.toHaveBeenCalledWith('lead_id', TEST_LEAD_ID);
  });

  it('(H-5) estado_loading_inicial_true: loading=true mientras el fetch async está pendiente', async () => {
    const pending_query = new Promise<{ data: LeadStatusHistoryEntry[]; error: null }>(() => {});

    mock_supabase_holder.client = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            order: jest.fn().mockReturnValue(pending_query),
          }),
        }),
      }),
      _mock_from: jest.fn(),
      _mock_select: jest.fn(),
      _mock_eq: jest.fn(),
      _mock_order: jest.fn(),
    } as unknown as ReturnType<typeof make_supabase_mock_history>;

    const { result } = await renderHook(() => useLeadStatusHistory(TEST_LEAD_ID));

    expect(result.current.loading).toBe(true);
  });
});
