/**
 * Tests fase RED — useAdminQueueCounts hook (counts vivos del home del panel
 * admin, tarea #217; 6ª cola advertising_requests añadida por #246)
 * Archivo SUT: mobile/src/features/admin/hooks/useAdminQueueCounts.ts
 * Subtarea Taskmaster: 217.2
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — no se
 * renegocia sin dejar rastro en la bitácora):
 *
 *   useAdminQueueCounts(): {
 *     counts: AdminQueueCounts | null;
 *     is_loading: boolean;
 *     error_message: string | null;
 *     refetch: () => void;
 *   }
 *
 *   AdminQueueCounts = {
 *     ads_pending: number;
 *     revisions_pending: number;
 *     reports_new: number;
 *     agent_applications_pending: number;
 *     agencies_pending: number;
 *     advertising_requests_pending: number;   // #246
 *   }
 *
 * 6 queries EN PARALELO, cada una `supabase.from(<tabla>).select('*', {
 * count: 'exact', head: true }).eq('status', <valor>)` (patrón calcado de
 * useAgentStats/usePendingAds — sin RPC nueva, las policies RLS con
 * `private.is_admin()` ya permiten el SELECT al admin):
 *   - ads                .eq('status', 'pending_review')
 *   - property_revisions .eq('status', 'pending')
 *   - property_reports   .eq('status', 'new')
 *   - agent_applications .eq('status', 'pending')
 *   - agencies           .eq('status', 'pending_approval')
 *   - advertising_requests .eq('status', 'pending')          // #246
 *
 * Los 6 valores de `status` están VERIFICADOS contra las migraciones (no
 * inventados ni copiados a ciegas del prompt):
 *   - ads.status default            → supabase/migrations/20260816000005_ads_schema.sql:45,98
 *     (enum ad_status incluye 'pending_review'; ya usado por usePendingAds.ts:89)
 *   - property_revisions.status     → supabase/migrations/20260809000003_property_revisions.sql:30
 *     (`status property_revision_status not null default 'pending'`)
 *   - property_reports.status       → supabase/migrations/20260604000007_analytics_moderation_audit.sql:34
 *     (`status property_report_status not null default 'new'`) — enum en
 *     supabase/migrations/20260604000001_extensions_and_enums.sql:81
 *     (`'new', 'reviewing', 'resolved', 'dismissed'`)
 *   - agent_applications.status     → supabase/migrations/20260604000003_agencies_and_agents.sql:114
 *     (`status agent_application_status not null default 'pending'`)
 *   - agencies.status                → supabase/migrations/20260604000003_agencies_and_agents.sql:18
 *     (`status agency_status not null default 'pending_approval'`)
 *   - advertising_requests.status → supabase/migrations/20260902100001_advertising_requests.sql:52
 *     (`status text not null default 'pending'` + CHECK in
 *     ('pending','approved','rejected')) — la 6ª cola, añadida por #246: el
 *     canal «Quiero anunciar» (#221.1) existía sin contador en el home.
 * Los 5 valores propuestos por el prompt del orquestador coincidieron
 * exactamente con la migración real — no hubo que corregir ninguno.
 *
 * INVARIANTES QUE ESTE ARCHIVO DEBE CLAVAR:
 *   1. Todo-o-nada: si UNA de las 6 queries falla (error o count null sin
 *      error, o la promesa RECHAZA), `counts` es `null` y `error_message` se
 *      llena — NUNCA un objeto con 4 números reales y una mentira (EC-6,
 *      EC-8, EC-10).
 *   2. `is_loading` no se apaga hasta que las 6 queries se asienten, aunque
 *      solo falte una (EC-7) — un spinner apagado con 5/6 muestra un
 *      dashboard incompleto como si fuera completo.
 *   3. Cero filas es un resultado LEGÍTIMO — `counts` con puros ceros, NUNCA
 *      `null` ni error (EC-2). Confundir "cola vacía" con "no pude leer la
 *      cola" es peor que un 0 real: el admin cree que no hay trabajo cuando
 *      en realidad la lectura falló.
 *   4. `count: null` sin `error` (respuesta rara de PostgREST) se trata como
 *      ERROR, no como 0 (EC-8) — decisión de este RED: un 0 fabricado le
 *      miente al admin sobre el tamaño real de la cola.
 *   5. Respuesta tardía tras `unmount()` no debe hacer `setState` ni lanzar
 *      (EC-9 — cobertura parcial, ver su comentario in situ).
 *   6. `refetch()` vuelve a disparar las 6 queries y refleja un count que
 *      cambió entre la carga inicial y el refetch (EC-5).
 *   7. El flag `ignore` también descarta la respuesta tardía de una
 *      generación VIEJA cuando el hook sigue MONTADO y ya hay una generación
 *      NUEVA asentada — la vieja no puede pisar el estado de la nueva (EC-11,
 *      hardening post-guardian: el mutante "borrar los 3 `if (ignore)
 *      return;`" sobrevivía porque EC-9 solo prueba el caso desmontado, que
 *      React 19 ya no-opea por sí solo).
 *
 * PATRÓN DE MOCK: `jest.mock('@/lib/supabase/client', ...)` con un holder
 * mutable `mock_supabase_holder` (mismo patrón que
 * useAgentStats.test.ts/usePendingAds — nombre con prefijo "mock" requerido
 * por Jest para referenciar dentro del factory). El mock distingue las 5
 * tablas por el argumento de `.from(<tabla>)`, NO por las columnas del
 * `.select()` (las 6 usan `'*'`).
 *
 * GOTCHAS RNTL ya pagados: `renderHook` con `await` + `act`; sin `await` el
 * `result` es `undefined` (rntl14_renderhook_async). `unmount()` SIEMPRE
 * dentro de `act` (rntl_unmount_fuera_de_act).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) camino_feliz_las_6_queries_resuelven_counts_poblado_con_los_6_valores_reales
 * - (EC-2) cero_filas_en_las_6_tablas_counts_todo_en_cero_no_null_no_error
 *
 * ### Ramas de reglas no obvias
 * - (EC-3) cada_tabla_se_filtra_por_el_status_real_verificado_en_las_migraciones
 * - (EC-4) las_6_queries_se_disparan_en_paralelo_no_secuencial
 * - (EC-5) refetch_vuelve_a_pedir_las_6_queries_y_refleja_un_count_que_cambio
 *
 * ### Boundary / error
 * - (EC-6) error_en_una_sola_de_las_5_queries_error_message_poblado_y_counts_null_todo_o_nada
 * - (EC-7) is_loading_permanece_true_con_5_de_6_resueltas_y_1_pendiente
 * - (EC-8) count_null_sin_error_se_trata_como_error_nunca_como_cero_fabricado
 * - (EC-9) respuesta_tardia_tras_unmount_no_hace_setstate_ni_lanza
 * - (EC-10) rechazo_de_promesa_en_una_query_tambien_cae_en_mensaje_neutro_sin_lanzar
 * - (EC-11) respuesta_tardia_de_una_generacion_vieja_estando_montado_no_pisa_la_generacion_nueva
 *   (hardening post-guardian, mutante M5 — ver comentario en el test)
 * - (EC-12) error_en_la_cola_nueva_advertising_requests_tambien_invalida_las_otras_cinco
 *   (#246: la 6ª cola entra al MISMO todo-o-nada, no como un contador aparte
 *   que pueda mentir por su cuenta)
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Import del SUT — DESPUÉS del jest.mock()
// ---------------------------------------------------------------------------

import { useAdminQueueCounts } from '../hooks/useAdminQueueCounts';

// ---------------------------------------------------------------------------
// Constantes y tipos de test
// ---------------------------------------------------------------------------

type CountResult = { count: number | null; error: null | { message: string } };

const QUEUE_TABLES = [
  'ads',
  'property_revisions',
  'property_reports',
  'agent_applications',
  'agencies',
  'advertising_requests',
] as const;
type QueueTable = (typeof QUEUE_TABLES)[number];

/** status real por tabla, verificado contra las migraciones (ver docblock). */
const STATUS_BY_TABLE: Record<QueueTable, string> = {
  ads: 'pending_review',
  property_revisions: 'pending',
  property_reports: 'new',
  agent_applications: 'pending',
  agencies: 'pending_approval',
  advertising_requests: 'pending',
};

/** counts por defecto — todos distintos entre sí para detectar un mapeo cruzado. */
const DEFAULT_COUNTS: Record<QueueTable, CountResult> = {
  ads: { count: 3, error: null },
  property_revisions: { count: 1, error: null },
  property_reports: { count: 2, error: null },
  agent_applications: { count: 0, error: null },
  agencies: { count: 4, error: null },
  advertising_requests: { count: 5, error: null },
};

const EXPECTED_DEFAULT_COUNTS = {
  ads_pending: 3,
  revisions_pending: 1,
  reports_new: 2,
  agent_applications_pending: 0,
  agencies_pending: 4,
  advertising_requests_pending: 5,
};

const NEUTRAL_ERROR_MESSAGE = 'No se pudieron cargar los contadores del panel. Intenta de nuevo.';

// ---------------------------------------------------------------------------
// Factory del mock de cliente — jest.mock del módulo (NO DI), distingue por
// el argumento de `.from(<tabla>)`.
// ---------------------------------------------------------------------------

// Function overrides (usadas para promesas RECHAZADAS, p.ej. EC-10) se
// construyen LAZY, solo cuando `.eq()` realmente se invoca — construir un
// `Promise.reject` de una vez en el módulo del test deja una rejection sin
// handler flotando si el SUT (stub RED) nunca llega a consumirla.
type TableOverride = CountResult | Promise<CountResult> | (() => Promise<CountResult>);

interface MockCalls {
  from: string[];
  select: [string, string, unknown][];
  eq: [string, string, unknown][];
}

function make_supabase_mock(overrides: Partial<Record<QueueTable, TableOverride>> = {}) {
  const calls: MockCalls = { from: [], select: [], eq: [] };

  function resolve_for(table: QueueTable): Promise<CountResult> {
    const override = overrides[table];
    if (override === undefined) return Promise.resolve(DEFAULT_COUNTS[table]);
    if (typeof override === 'function') return override();
    return override instanceof Promise ? override : Promise.resolve(override);
  }

  function make_chain(table: QueueTable) {
    const chain: Record<string, unknown> = {};
    chain.select = jest.fn((cols: string, opts: unknown) => {
      calls.select.push([table, cols, opts]);
      return chain;
    });
    // `.eq()` es el eslabón TERMINAL (última llamada de las 5 queries) — el
    // patrón real de supabase-js: `.select()` primero, filtros después, y el
    // builder es awaitable en sí mismo (usePendingAds/useAgentStats).
    chain.eq = jest.fn((col: string, val: unknown) => {
      calls.eq.push([table, col, val]);
      return resolve_for(table);
    });
    return chain;
  }

  const mock_from = jest.fn().mockImplementation((table: QueueTable) => {
    calls.from.push(table);
    return make_chain(table);
  });

  return { from: mock_from, _calls: calls };
}

function make_pending_client() {
  return {
    from: jest.fn().mockImplementation((table: QueueTable) => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn(() => new Promise<CountResult>(() => {})), // nunca resuelve
    })),
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

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
});

describe('useAdminQueueCounts', () => {
  // ── EC-1: Camino feliz ──────────────────────────────────────────────────

  it('(EC-1) camino_feliz_las_6_queries_resuelven_counts_poblado_con_los_6_valores_reales: counts refleja los 6 números, is_loading false, error null', async () => {
    const { result } = await renderHook(() => useAdminQueueCounts());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
    expect(result.current.counts).toEqual(EXPECTED_DEFAULT_COUNTS);
  });

  // ── EC-2: Cero filas en todas ────────────────────────────────────────────

  it('(EC-2) cero_filas_en_las_6_tablas_counts_todo_en_cero_no_null_no_error: cola vacía en las 6 tablas es un resultado legítimo, no un error', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      ads: { count: 0, error: null },
      property_revisions: { count: 0, error: null },
      property_reports: { count: 0, error: null },
      agent_applications: { count: 0, error: null },
      agencies: { count: 0, error: null },
      advertising_requests: { count: 0, error: null },
    });

    const { result } = await renderHook(() => useAdminQueueCounts());

    expect(result.current.error_message).toBeNull();
    expect(result.current.counts).toEqual({
      ads_pending: 0,
      revisions_pending: 0,
      reports_new: 0,
      agent_applications_pending: 0,
      agencies_pending: 0,
      advertising_requests_pending: 0,
    });
  });

  // ── EC-3: status real por tabla ───────────────────────────────────────────

  it('(EC-3) cada_tabla_se_filtra_por_el_status_real_verificado_en_las_migraciones: .eq(status, ...) usa el valor exacto de cada tabla, y .select usa count exact + head true', async () => {
    await renderHook(() => useAdminQueueCounts());

    const calls = mock_supabase_holder.client._calls;

    expect(calls.from.sort()).toEqual([...QUEUE_TABLES].sort());

    for (const table of QUEUE_TABLES) {
      const eq_call = calls.eq.find(([t]) => t === table);
      expect(eq_call).toBeDefined();
      expect(eq_call?.[1]).toBe('status');
      expect(eq_call?.[2]).toBe(STATUS_BY_TABLE[table]);

      const select_call = calls.select.find(([t]) => t === table);
      expect(select_call).toBeDefined();
      expect(select_call?.[1]).toBe('*');
      expect(select_call?.[2]).toEqual({ count: 'exact', head: true });
    }
  });

  // ── EC-4: paralelo, no secuencial ────────────────────────────────────────

  it('(EC-4) las_6_queries_se_disparan_en_paralelo_no_secuencial: las 6 tablas se consultan aunque NINGUNA promesa haya resuelto todavía', async () => {
    mock_supabase_holder.client = make_pending_client() as unknown as ReturnType<
      typeof make_supabase_mock
    >;

    await renderHook(() => useAdminQueueCounts());

    const from_mock = mock_supabase_holder.client.from as unknown as jest.Mock;
    const tables_called = from_mock.mock.calls.map((args: unknown[]) => args[0]);
    expect(tables_called.sort()).toEqual([...QUEUE_TABLES].sort());
  });

  // ── EC-5: refetch ─────────────────────────────────────────────────────────

  it('(EC-5) refetch_vuelve_a_pedir_las_6_queries_y_refleja_un_count_que_cambio: tras refetch, un count que cambió en el backend se refleja en el estado', async () => {
    const { result } = await renderHook(() => useAdminQueueCounts());
    expect(result.current.counts?.reports_new).toBe(2);

    // Entre la carga inicial y el refetch llegó un reporte nuevo.
    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { count: 3, error: null },
    });

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.counts?.reports_new).toBe(3);
    expect(result.current.counts).toEqual({ ...EXPECTED_DEFAULT_COUNTS, reports_new: 3 });
  });

  // ── EC-6: error en una sola query → todo-o-nada ──────────────────────────

  it('(EC-6) error_en_una_sola_de_las_5_queries_error_message_poblado_y_counts_null_todo_o_nada: un error en property_reports invalida los 6 counts, no solo el suyo', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { count: null, error: { message: 'RLS denied' } },
    });

    const { result } = await renderHook(() => useAdminQueueCounts());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.counts).toBeNull();
  });

  // ── EC-7: is_loading no se apaga con 4/5 ─────────────────────────────────

  it('(EC-7) is_loading_permanece_true_con_5_de_6_resueltas_y_1_pendiente: con agencies pendiente para siempre, is_loading sigue true y counts sigue null', async () => {
    const never_resolves = new Promise<CountResult>(() => {});
    mock_supabase_holder.client = make_supabase_mock({
      agencies: never_resolves,
    });

    const { result } = await renderHook(() => useAdminQueueCounts());

    // Deja correr microtasks para que las 5 que SÍ resuelven se asienten.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.is_loading).toBe(true);
    expect(result.current.counts).toBeNull();
  });

  // ── EC-8: count null sin error ────────────────────────────────────────────

  it('(EC-8) count_null_sin_error_se_trata_como_error_nunca_como_cero_fabricado: count null en agent_applications produce error_message, no un 0 silencioso', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      agent_applications: { count: null, error: null },
    });

    const { result } = await renderHook(() => useAdminQueueCounts());

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.counts).toBeNull();
  });

  // ── EC-9: respuesta tardía tras unmount ──────────────────────────────────
  //
  // LÍMITE CONOCIDO (hardening post-guardian, mutante M5): tras unmount(),
  // `result.current` queda congelado en el último snapshot pre-unmount y
  // React 19 hace no-op silencioso ante un setState sobre un fiber
  // desmontado — con o sin el guard `if (ignore) return;`, este test pasa
  // igual, así que NO distingue el código correcto del mutante que borra los
  // 3 guards. Se conserva porque sí prueba algo real y barato: que la
  // respuesta tardía no LANZA tras unmount. El invariante fuerte del flag
  // `ignore` (que una generación vieja no pise el estado observable de una
  // nueva) lo cubre EC-11, con el hook MONTADO durante toda la carrera.

  it('(EC-9) respuesta_tardia_tras_unmount_no_hace_setstate_ni_lanza: una query lenta que resuelve después de unmount no actualiza el estado congelado', async () => {
    let resolve_agencies!: (v: CountResult) => void;
    const pending = new Promise<CountResult>((resolve) => {
      resolve_agencies = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock({ agencies: pending });

    const { result, unmount } = await renderHook(() => useAdminQueueCounts());
    expect(result.current.is_loading).toBe(true);

    await act(async () => {
      unmount();
    });

    let thrown: unknown = null;
    await act(async () => {
      try {
        resolve_agencies({ count: 4, error: null });
        await Promise.resolve();
        await Promise.resolve();
      } catch (e) {
        thrown = e;
      }
    });

    expect(thrown).toBeNull();
    // Estado congelado en su último valor pre-unmount.
    expect(result.current.is_loading).toBe(true);
    expect(result.current.counts).toBeNull();
  });

  // ── EC-10: rechazo de promesa ─────────────────────────────────────────────

  it('(EC-10) rechazo_de_promesa_en_una_query_tambien_cae_en_mensaje_neutro_sin_lanzar: un reject (no un {error}) de agent_applications no tumba el hook y produce el mismo mensaje neutro', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      agent_applications: () => Promise.reject(new Error('network down')),
    });

    let thrown: unknown = null;
    let final_state: { counts: unknown; error_message: string | null } | undefined;
    try {
      const rendered = await renderHook(() => useAdminQueueCounts());
      final_state = rendered.result.current;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(final_state?.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(final_state?.counts).toBeNull();
  });

  // ── EC-11: carrera entre generaciones, hook MONTADO ──────────────────────

  it('(EC-11) respuesta_tardia_de_una_generacion_vieja_estando_montado_no_pisa_la_generacion_nueva: la generación vieja no puede sobrescribir el estado ya asentado de la generación nueva', async () => {
    // gen1: 5 de 6 resuelven, agencies queda pendiente (guardamos el resolve).
    let resolve_agencies_gen1!: (v: CountResult) => void;
    const pending_gen1 = new Promise<CountResult>((resolve) => {
      resolve_agencies_gen1 = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock({ agencies: pending_gen1 });

    const { result } = await renderHook(() => useAdminQueueCounts());

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.is_loading).toBe(true);
    expect(result.current.counts).toBeNull();

    // gen2: swap del cliente ANTES del refetch — la nueva generación resuelve
    // las 6 de inmediato, agencies = 99.
    mock_supabase_holder.client = make_supabase_mock({ agencies: { count: 99, error: null } });

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
    expect(result.current.counts).toEqual({ ...EXPECTED_DEFAULT_COUNTS, agencies_pending: 99 });

    // Recién ahora resuelve la promesa tardía de gen1 — hook sigue montado.
    await act(async () => {
      resolve_agencies_gen1({ count: 4, error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Invariante: gen1 (vieja) no puede pisar el estado de gen2 (nueva).
    expect(result.current.counts?.agencies_pending).toBe(99);
    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
  });

  // ── EC-12: la 6ª cola entra al MISMO todo-o-nada (#246) ──────────────────

  it('(EC-12) error_en_la_cola_nueva_advertising_requests_tambien_invalida_las_otras_cinco: la cola de solicitudes comerciales no es un contador aparte que pueda fallar solo', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      advertising_requests: { count: null, error: { message: 'relation does not exist' } },
    });

    const { result } = await renderHook(() => useAdminQueueCounts());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.counts).toBeNull();
  });
});
