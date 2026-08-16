/**
 * Tests — useAgentStats hook (counts del header de perfil)
 * Archivo SUT: mobile/src/features/profile/hooks/useAgentStats.ts
 * Subtarea Taskmaster: 23.1 (original) · 179.1 (rediseño estilo Instagram)
 *
 * ⚠️ CAMBIO DE CONTRATO EN 179.1 — el header de perfil dejó de mostrar
 * "Cerrados" y ahora muestra:
 *   - perfil propio: Publicaciones · Leads · Guardados
 *   - perfil ajeno:  Publicaciones · Guardados · Me gusta
 * Consecuencias en este archivo:
 *   1. `closed` SALE de AgentStats y su query desaparece. NO es un test
 *      debilitado: el dato ya no se pinta en ninguna superficie (el CRM tiene
 *      su propio RPC get_lead_stats, migración 20260808000002) y mantenerlo
 *      costaba una query por cada apertura de perfil. Por eso se borran los
 *      casos EC-6 y las aserciones de status closed_* de EC-3.
 *   2. Entra una 4ª query de SUMAS (save_count/like_count) — es la única que
 *      trae filas (sin head:true), por eso EC-3 ya no puede exigir
 *      count:'exact' en TODOS los select.
 *   3. `leads` es un dato PRIVADO: en un perfil ajeno la RLS devuelve 0 y el
 *      header pintaba "0 Leads" como si el agente no tuviera ninguno. El hook
 *      ahora acepta `{ include_leads }` y en false NI SIQUIERA consulta leads.
 *
 * FIRMA DEL HOOK:
 *   useAgentStats(agent_id: string, opts?: { include_leads?: boolean })
 *     → { loading: boolean; stats: AgentStats | null }
 *   AgentStats = { publications: number; leads: number; saves: number; likes: number }
 *
 * QUERIES ESPERADAS (Promise.all).
 * Orden REAL de supabase-js: .select() con las opciones de count va PRIMERO,
 * los filtros (.eq/.in/.is) van DESPUÉS (mismo patrón que usePropertiesGrid):
 *   1. publications = properties
 *        .select('id', { count: 'exact', head: true })
 *        .eq('owner_user_id', agent_id)
 *        .in('status', ['active', 'paused'])
 *        .is('deleted_at', null)
 *   2. sums = properties
 *        .select('save_count, like_count')     ← trae filas, sin head
 *        .eq('owner_user_id', agent_id)
 *        .in('status', ['active', 'paused'])
 *        .is('deleted_at', null)
 *      (suma en cliente: son las mismas pocas filas que ya cuenta la query 1;
 *      los contadores los mantiene el trigger de 20260701000001 — cero backend
 *      nuevo. Un RPC de agregación sería más caro de mantener que el reduce.)
 *   3. leads = leads
 *        .select('id', { count: 'exact', head: true })
 *        .eq('agent_id', agent_id)
 *        .is('deleted_at', null)
 *      SOLO si include_leads !== false.
 *
 * PATRÓN DE MOCK: igual que useAgentProfile.test.tsx — holder mutable
 * `mock_supabase_holder` con getter en @/lib/supabase/client (nombre con
 * prefijo "mock" requerido por Jest para referenciar dentro del factory).
 * Cadena builder encadenable: .select() devuelve el objeto encadenable,
 * .eq/.in() encadenan, y .is('deleted_at', null) — última llamada en TODAS
 * las queries — resuelve la promesa (awaitable). Las dos queries a
 * `properties` se distinguen por la columna del .select().
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - EC-1: estado_inicial_loading_true_stats_null
 * - EC-2: tras_resolver_expone_los_counts_correctos_y_loading_false
 *
 * ### Edge cases del PRD / reglas no obvias
 * - EC-3: queries_usan_filtros_correctos_status_y_deleted_at
 * - S-1:  suma_save_count_y_like_count_de_todas_las_filas
 * - S-2:  include_leads_false_no_consulta_la_tabla_leads
 *
 * ### Boundary / error
 * - EC-4: error_en_alguna_query_degrada_a_ceros_sin_throw
 * - S-3:  error_en_la_query_de_sumas_degrada_a_ceros
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
type RowsResult = {
  data: { save_count: number; like_count: number }[] | null;
  error: null | { message: string };
};

interface TableMockConfig {
  /** Query 1: count de publicaciones. */
  properties?: CountResult;
  /** Query 2: filas con save_count/like_count para sumar en cliente. */
  sums?: RowsResult;
  /** Query 3: count de leads (solo si include_leads). */
  leads_all?: CountResult;
}

/**
 * Crea un mock de `supabase.from(table)` que registra las llamadas a
 * .eq/.in/.is/.select y resuelve con el resultado correspondiente.
 *
 * Distingue las DOS queries de `properties` por la columna del `.select()`:
 * 'id' → count de publicaciones; 'save_count, like_count' → filas a sumar.
 */
function make_supabase_mock(config: TableMockConfig = {}) {
  const {
    properties = { count: 0, error: null },
    sums = { data: [], error: null },
    leads_all = { count: 0, error: null },
  } = config;

  const calls: {
    from: string[];
    eq: [string, unknown][];
    in: [string, unknown][];
    is: [string, unknown][];
    select: [string, unknown][];
  } = { from: [], eq: [], in: [], is: [], select: [] };

  function make_chain(table: string) {
    let selected_columns = '';

    const chain: Record<string, unknown> = {};

    // Orden real de supabase-js: .select() primero (encadenable), filtros
    // después. TODAS las queries del SUT terminan en .is('deleted_at', null)
    // — por eso .is() es el eslabón que resuelve (awaitable).
    chain.select = jest.fn((col: string, opts: unknown) => {
      calls.select.push([col, opts]);
      selected_columns = col;
      return chain;
    });
    chain.eq = jest.fn((col: string, val: unknown) => {
      calls.eq.push([col, val]);
      return chain;
    });
    chain.in = jest.fn((col: string, val: unknown) => {
      calls.in.push([col, val]);
      return chain;
    });
    chain.is = jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
      if (table === 'properties') {
        return Promise.resolve(selected_columns === 'id' ? properties : sums);
      }
      return Promise.resolve(leads_all);
    });

    return chain;
  }

  const mock_from = jest.fn().mockImplementation((table: string) => {
    calls.from.push(table);
    return make_chain(table);
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

  it('(EC-2) tras_resolver_expone_los_counts_correctos_y_loading_false: stats refleja publicaciones, leads y las sumas de guardados/me gusta', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      properties: { count: 7, error: null },
      leads_all: { count: 15, error: null },
      sums: {
        data: [
          { save_count: 3, like_count: 10 },
          { save_count: 5, like_count: 2 },
        ],
        error: null,
      },
    });

    const { result } = await renderHook(() => useAgentStats(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.stats).toEqual({
      publications: 7,
      leads: 15,
      saves: 8,
      likes: 12,
    });
  });

  // ── S-1: la suma recorre TODAS las filas ──────────────────────────────────

  it('(S-1) suma_save_count_y_like_count_de_todas_las_filas: con 4 propiedades suma los 4 contadores de cada columna', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      properties: { count: 4, error: null },
      sums: {
        data: [
          { save_count: 1, like_count: 0 },
          { save_count: 0, like_count: 7 },
          { save_count: 12, like_count: 3 },
          { save_count: 0, like_count: 0 },
        ],
        error: null,
      },
    });

    const { result } = await renderHook(() => useAgentStats(TEST_AGENT_ID));

    expect(result.current.stats?.saves).toBe(13);
    expect(result.current.stats?.likes).toBe(10);
  });

  // ── S-2: leads es privado — en perfil ajeno ni se consulta ────────────────
  //
  // La RLS de leads solo deja ver los propios: en un perfil ajeno la query
  // devuelve 0 y el header pintaba "0 Leads" como si el agente no tuviera
  // ninguno. Además de no pintarlo, no tiene sentido pagar la request.

  it('(S-2) include_leads_false_no_consulta_la_tabla_leads: no llama from("leads") y stats.leads queda en 0', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      properties: { count: 6, error: null },
      leads_all: { count: 99, error: null }, // no debe llegar a leerse
      sums: { data: [{ save_count: 2, like_count: 4 }], error: null },
    });

    const { result } = await renderHook(() =>
      useAgentStats(TEST_AGENT_ID, { include_leads: false }),
    );

    expect(mock_supabase_holder.client._calls.from).not.toContain('leads');
    expect(result.current.stats).toEqual({
      publications: 6,
      leads: 0,
      saves: 2,
      likes: 4,
    });
  });

  // ── EC-3: Filtros correctos por query ─────────────────────────────────────

  it('(EC-3) queries_usan_filtros_correctos_status_y_deleted_at: las 2 queries a properties filtran owner_user_id + status in active/paused + deleted_at null; leads filtra agent_id + deleted_at null (sin status); el count usa exact+head y la de sumas trae filas', async () => {
    await renderHook(() => useAgentStats(TEST_AGENT_ID));

    const calls = mock_supabase_holder.client._calls;

    // from() se llamó dos veces para properties (count + sumas) y una para leads
    expect(calls.from.filter((t) => t === 'properties').length).toBe(2);
    expect(calls.from.filter((t) => t === 'leads').length).toBe(1);

    // owner_user_id / agent_id correctos
    expect(calls.eq.filter(([col, val]) => col === 'owner_user_id' && val === TEST_AGENT_ID).length).toBe(2);
    expect(calls.eq).toContainEqual(['agent_id', TEST_AGENT_ID]);

    // Ambas queries de properties acotan a publicaciones visibles
    expect(calls.in.filter(([col, val]) => col === 'status' && Array.isArray(val) && (val as string[]).join() === 'active,paused').length).toBe(2);

    // deleted_at is null se usó en las 3 queries
    expect(calls.is.filter(([col, val]) => col === 'deleted_at' && val === null).length).toBe(3);

    // El count de publicaciones no trae filas; la query de sumas sí (sin head).
    expect(calls.select).toContainEqual(['id', { count: 'exact', head: true }]);
    const sums_select = calls.select.find(([col]) => col.includes('save_count'));
    expect(sums_select).toBeDefined();
    expect(sums_select?.[0]).toContain('like_count');
    expect(sums_select?.[1]).toBeUndefined();
  });

  // ── EC-4: Error en alguna query degrada a ceros ───────────────────────────

  it('(EC-4) error_en_alguna_query_degrada_a_ceros_sin_throw: si la query de properties falla, stats queda en ceros y no lanza', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      properties: { count: null, error: { message: 'RLS denied' } },
      leads_all: { count: 15, error: null },
      sums: { data: [{ save_count: 2, like_count: 4 }], error: null },
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
    expect(final_state?.stats).toEqual({ publications: 0, leads: 0, saves: 0, likes: 0 });
  });

  // ── S-3: el error de la query nueva degrada igual que las demás ───────────

  it('(S-3) error_en_la_query_de_sumas_degrada_a_ceros: si falla la query de save_count/like_count, stats queda en ceros y no lanza', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      properties: { count: 7, error: null },
      leads_all: { count: 15, error: null },
      sums: { data: null, error: { message: 'RLS denied' } },
    });

    const { result } = await renderHook(() => useAgentStats(TEST_AGENT_ID));

    expect(result.current.loading).toBe(false);
    expect(result.current.stats).toEqual({ publications: 0, leads: 0, saves: 0, likes: 0 });
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
