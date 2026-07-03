/**
 * Tests fase RED — useAgentStats hook (counts publicaciones/leads/cerrados)
 * Archivo SUT: mobile/src/features/profile/hooks/useAgentStats.ts
 * Subtarea Taskmaster: 23.1
 *
 * FIRMA DEL HOOK:
 *   useAgentStats(agent_id: string): { loading: boolean; stats: AgentStats | null }
 *   AgentStats = { publications: number; leads: number; closed: number }
 *
 * QUERIES ESPERADAS (Promise.all, count exact + head:true, sin traer filas).
 * Orden REAL de supabase-js: .select() con las opciones de count va PRIMERO,
 * los filtros (.eq/.in/.is) van DESPUÉS (mismo patrón que usePropertiesGrid):
 *   1. publications = properties
 *        .select('id', { count: 'exact', head: true })
 *        .eq('owner_user_id', agent_id)
 *        .in('status', ['active', 'paused'])
 *        .is('deleted_at', null)
 *   2. leads = leads
 *        .select('id', { count: 'exact', head: true })
 *        .eq('agent_id', agent_id)
 *        .is('deleted_at', null)
 *   3. closed = leads
 *        .select('id', { count: 'exact', head: true })
 *        .eq('agent_id', agent_id)
 *        .in('status', ['closed_won', 'closed_lost'])
 *        .is('deleted_at', null)
 *
 * PATRÓN DE MOCK: igual que useAgentProfile.test.tsx — holder mutable
 * `mock_supabase_holder` con getter en @/lib/supabase/client (nombre con
 * prefijo "mock" requerido por Jest para referenciar dentro del factory).
 * Cadena builder encadenable: .select() devuelve el objeto encadenable,
 * .eq/.in() encadenan, y .is('deleted_at', null) — última llamada en las 3
 * queries — resuelve la promesa con { count, error } (awaitable).
 *
 * EDGE CASES CUBIERTOS (5 casos):
 *
 * ### Happy path
 * - EC-1: estado_inicial_loading_true_stats_null
 * - EC-2: tras_resolver_expone_los_3_counts_correctos_y_loading_false
 *
 * ### Edge cases del PRD / reglas no obvias
 * - EC-3: queries_usan_filtros_correctos_status_y_deleted_at
 *     (publications: status in ['active','paused'] + deleted_at null;
 *      leads: solo deleted_at null, sin filtro de status;
 *      closed: status in ['closed_won','closed_lost'] + deleted_at null;
 *      las 3 queries usan count:'exact', head:true — no traen filas)
 *
 * ### Boundary / error
 * - EC-4: error_en_alguna_query_degrada_a_ceros_sin_throw
 * - EC-5: ignore_flag_evita_setState_tras_unmount
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Import del SUT — DESPUÉS del jest.mock()
// ---------------------------------------------------------------------------

import { useAgentStats } from '../hooks/useAgentStats';

// ---------------------------------------------------------------------------
// Mock del cliente Supabase — cadena builder encadenable por tabla.
// ---------------------------------------------------------------------------

type CountResult = { count: number | null; error: null | { message: string } };

interface TableMockConfig {
  properties?: CountResult;
  leads_all?: CountResult; // query 2: leads sin filtro de status
  leads_closed?: CountResult; // query 3: leads con status in closed_*
}

/**
 * Crea un mock de `supabase.from(table)` que registra las llamadas a
 * .eq/.in/.is/.select y resuelve con el CountResult correspondiente.
 *
 * Distingue entre las DOS queries de `leads` (todas vs. cerradas) por la
 * presencia de una llamada a `.in('status', [...])`: si se llama `.in`,
 * es la query de cerrados; si no, es la de leads totales.
 */
function make_supabase_mock(config: TableMockConfig = {}) {
  const {
    properties = { count: 0, error: null },
    leads_all = { count: 0, error: null },
    leads_closed = { count: 0, error: null },
  } = config;

  const calls: {
    from: string[];
    eq: [string, unknown][];
    in: [string, unknown][];
    is: [string, unknown][];
    select: [string, unknown][];
  } = { from: [], eq: [], in: [], is: [], select: [] };

  function make_chain(table: string, result_for_leads_all: CountResult, result_for_leads_closed: CountResult, result_for_properties: CountResult) {
    let saw_in = false;

    const chain: Record<string, unknown> = {};

    // Orden real de supabase-js: .select() primero (encadenable), filtros
    // después. Las 3 queries del SUT terminan siempre en .is('deleted_at',
    // null) — por eso .is() es el eslabón que resuelve (awaitable).
    chain.select = jest.fn((col: string, opts: unknown) => {
      calls.select.push([col, opts]);
      return chain;
    });
    chain.eq = jest.fn((col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return chain;
    });
    chain.in = jest.fn((col: string, val: unknown) => {
      calls.in.push([col, val]);
      saw_in = true;
      return chain;
    });
    chain.is = jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
      // Resuelve según tabla + si vio .in() (distingue leads-totales de leads-cerrados)
      if (table === 'properties') return Promise.resolve(result_for_properties);
      // table === 'leads'
      return Promise.resolve(saw_in ? result_for_leads_closed : result_for_leads_all);
    });

    return chain;
  }

  const mock_from = jest.fn().mockImplementation((table: string) => {
    calls.from.push(table);
    return make_chain(table, leads_all, leads_closed, properties);
  });

  return {
    from: mock_from,
    _calls: calls,
    _mock_from: mock_from,
  };
}

/** Holder mutable — beforeEach lo reemplaza con el mock apropiado por test. */
const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

const TEST_AGENT_ID = 'agente-uuid-test-stats-001';

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

describe('useAgentStats', () => {
  // ── EC-1: Estado inicial ──────────────────────────────────────────────────
  //
  // Patrón (igual que useAgentLeads.test.ts EC-8): mock con promesa pendiente
  // que nunca resuelve en este test. act() de React 18 no espera promesas
  // arbitrarias iniciadas dentro de useEffect → await renderHook completa sin
  // que la promesa resuelva → loading queda en su valor inicial (true).

  it('(EC-1) estado_inicial_loading_true_stats_null: con el fetch pendiente (nunca resuelve), loading es true y stats es null', async () => {
    const pending = new Promise<CountResult>(() => {
      /* nunca resuelve en este test */
    });
    mock_supabase_holder.client = {
      from: jest.fn().mockImplementation(() => {
        const chain: Record<string, unknown> = {};
        chain.select = jest.fn().mockReturnValue(chain);
        chain.eq = jest.fn().mockReturnValue(chain);
        chain.in = jest.fn().mockReturnValue(chain);
        chain.is = jest.fn().mockReturnValue(pending);
        return chain;
      }),
    } as unknown as ReturnType<typeof make_supabase_mock>;

    const { result } = await renderHook(() => useAgentStats(TEST_AGENT_ID));

    expect(result.current.loading).toBe(true);
    expect(result.current.stats).toBeNull();
  });

  // ── EC-2: Counts correctos tras resolver ──────────────────────────────────

  it('(EC-2) tras_resolver_expone_los_3_counts_correctos_y_loading_false: stats.publications/leads/closed reflejan los counts de cada query', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      properties: { count: 7, error: null },
      leads_all: { count: 15, error: null },
      leads_closed: { count: 4, error: null },
    });

    const { result } = await renderHook(() => useAgentStats(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.stats).toEqual({ publications: 7, leads: 15, closed: 4 });
  });

  // ── EC-3: Filtros correctos por query ─────────────────────────────────────

  it('(EC-3) queries_usan_filtros_correctos_status_y_deleted_at: properties filtra owner_user_id + status in active/paused + deleted_at null; leads filtra agent_id + deleted_at null (sin status); closed agrega status in closed_won/closed_lost — las 3 con count exact head true', async () => {
    await renderHook(() => useAgentStats(TEST_AGENT_ID));

    const calls = mock_supabase_holder.client._calls;

    // from() se llamó para properties y (dos veces) para leads
    expect(calls.from).toContain('properties');
    expect(calls.from.filter((t) => t === 'leads').length).toBe(2);

    // owner_user_id / agent_id correctos
    expect(calls.eq).toContainEqual(['owner_user_id', TEST_AGENT_ID]);
    expect(calls.eq.filter(([col, val]) => col === 'agent_id' && val === TEST_AGENT_ID).length).toBe(2);

    // status in correctos (publications: active/paused; closed: closed_won/closed_lost)
    expect(calls.in).toContainEqual(['status', ['active', 'paused']]);
    expect(calls.in).toContainEqual(['status', ['closed_won', 'closed_lost']]);

    // deleted_at is null se usó en las 3 queries
    expect(calls.is.filter(([col, val]) => col === 'deleted_at' && val === null).length).toBe(3);

    // count exact + head true en las 3 queries
    for (const [, opts] of calls.select) {
      expect(opts).toEqual({ count: 'exact', head: true });
    }
    expect(calls.select.length).toBe(3);
  });

  // ── EC-4: Error en alguna query degrada a ceros ───────────────────────────

  it('(EC-4) error_en_alguna_query_degrada_a_ceros_sin_throw: si la query de properties falla, stats es {publications:0, leads:0, closed:0} y no lanza', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      properties: { count: null, error: { message: 'RLS denied' } },
      leads_all: { count: 15, error: null },
      leads_closed: { count: 4, error: null },
    });

    let thrown: unknown = null;
    let final_state: { loading: boolean; stats: unknown } | undefined;
    try {
      const rendered = await renderHook(() => useAgentStats(TEST_AGENT_ID));
      final_state = rendered.result.current;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(final_state?.loading).toBe(false);
    expect(final_state?.stats).toEqual({ publications: 0, leads: 0, closed: 0 });
  });

  // ── EC-5: ignore flag evita setState tras unmount ─────────────────────────

  it('(EC-5) ignore_flag_evita_setState_tras_unmount: si el componente se desmonta antes de que resuelvan las queries, no lanza al resolverlas después', async () => {
    // Query que resuelve en un microtask posterior controlado manualmente.
    let resolve_select!: (v: CountResult) => void;
    const pending = new Promise<CountResult>((resolve) => {
      resolve_select = resolve;
    });

    const slow_client = {
      from: jest.fn().mockImplementation(() => {
        const chain: Record<string, unknown> = {};
        chain.select = jest.fn().mockReturnValue(chain);
        chain.eq = jest.fn().mockReturnValue(chain);
        chain.in = jest.fn().mockReturnValue(chain);
        chain.is = jest.fn().mockReturnValue(pending);
        return chain;
      }),
    };
    mock_supabase_holder.client = slow_client as unknown as ReturnType<typeof make_supabase_mock>;

    const { result, unmount } = await renderHook(() => useAgentStats(TEST_AGENT_ID));
    expect(result.current.loading).toBe(true);

    // Desmonta ANTES de que la promesa resuelva.
    unmount();

    // Resuelve después del unmount — no debe lanzar "state update on unmounted component"
    // ni ninguna excepción (el flag `ignore` debe cortar el set_state).
    await act(async () => {
      resolve_select({ count: 9, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Tras el unmount el estado expuesto por `result.current` queda congelado
    // en su último valor pre-unmount (loading:true) — el hook NO debió
    // actualizarlo post-unmount.
    expect(result.current.loading).toBe(true);
    expect(result.current.stats).toBeNull();
  });
});
