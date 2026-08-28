/**
 * Tests fase RED — useAdminReports (cola de reportes de propiedad,
 * property_reports con status='new', AGRUPADA POR PROPIEDAD, módulo 041-M2,
 * tarea #220, subtarea 220.4)
 * Archivo SUT: mobile/src/features/admin/hooks/useAdminReports.ts
 * Subtarea Taskmaster: 220.4
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — no se
 * renegocia sin dejar rastro en la bitácora):
 *
 *   useAdminReports(): {
 *     reports: AdminReportQueueItem[] | null;
 *     is_loading: boolean;
 *     error_message: string | null;
 *     refetch: () => void;
 *   }
 *
 *   AdminReportQueueItem = {
 *     property_id: string;
 *     property: AdminReportPropertySnapshot;   // snapshot de display, NO el
 *                                               // whitelist de edición (esto
 *                                               // no es un diff de edición)
 *     reports: AdminReportEntry[];             // los reportes 'new' de ESA
 *                                               // propiedad, orden del server
 *     report_count: number;                    // reports.length
 *   }
 *
 *   AdminReportPropertySnapshot = { id, address, operation_type,
 *     property_type, price, status }  — `status` es necesario porque las 4
 *     acciones de resolución (220.3, ver useResolveReport) SOLO aplican si la
 *     propiedad está 'suspended'; la pantalla decide qué botones habilitar con
 *     este campo (fuera de alcance de este RED, pero el shape debe traerlo).
 *
 *   AdminReportEntry = { report_id, reason, reason_text, reported_by_user_id,
 *     created_at }
 *   (Nota: `report_id` viene de `property_reports.id` — NUNCA se confunde con
 *   `property_id`, la FK. `reason` es el valor crudo del enum
 *   property_report_reason — supabase/migrations/20260604000001_extensions_and_enums.sql:76-78
 *   — la traducción a español, si aplica, es responsabilidad de la pantalla,
 *   no del hook.)
 *
 * QUERY ÚNICA bajo test (sin RPC nueva — la policy RLS `reports_select` ya
 * autoriza el SELECT al admin vía `public.is_admin()`,
 * supabase/migrations/20260604000008_rls_helpers_and_policies.sql:357-359:
 *   using (reported_by_user_id = auth.uid() or public.is_admin())
 * — el hook NO debe restringir con `.eq('reported_by_user_id', ...)`: esta es
 * la cola del ADMIN, no "mis reportes". Esa policy ya cubre ambos casos por
 * el OR; filtrar por usuario aquí ocultaría reportes ajenos al admin, que es
 * justo lo que necesita ver — gotcha invertido de la memoria
 * flatlist_numcolumns_row_keys ("mis X siempre filtra .eq(user_id)"): aquí es
 * al revés, la cola de ADMIN nunca debe llevar ese filtro):
 *
 *   supabase
 *     .from('property_reports')
 *     .select(<columnas propias + embed 'property:properties(...)'>)
 *     .eq('status', 'new')
 *     .order('created_at', { ascending: false })   // property_reports_queue_idx
 *                                                   // es (status, created_at desc)
 *                                                   — 20260604000007:46-47
 *
 * INVARIANTES QUE ESTE ARCHIVO DEBE CLAVAR:
 *   1. Todo-o-nada: error de PostgREST, `data: null` sin error, o rechazo de la
 *      promesa → `reports=null` + mensaje neutro — NUNCA una lista parcial ni
 *      un `[]` fabricado (EC-10, EC-11, EC-14 — mismo criterio que
 *      useAdminRevisions EC-7/EC-8/EC-11).
 *   2. Lista vacía LEGÍTIMA (`data: []`, sin error) es un resultado real:
 *      `reports=[]`, nunca `null` ni error (EC-3).
 *   3. AGRUPACIÓN: filas con el mismo `property_id` colapsan en UN solo
 *      `AdminReportQueueItem`, con `report_count` = número de reportes y
 *      `reports` = el array de esos reportes (EC-1).
 *   4. El orden de los GRUPOS respeta la PRIMERA APARICIÓN de cada
 *      `property_id` en el orden ya-ordenado del server — el hook NO
 *      reordena por conteo, alfabéticamente ni de ninguna otra forma (EC-2).
 *   5. Dentro de un grupo, el orden de los reportes individuales es
 *      EXACTAMENTE el orden en que llegaron del server — tampoco se
 *      re-ordenan (EC-8).
 *   6. `report_id` viene de `id` de `property_reports`; `property_id` es la
 *      FK — nunca se confunden aunque ambos sean UUIDs (EC-6).
 *   7. El `.select()` trae las columnas propias + el embed a `properties`
 *      con los campos de display — ni un campo del whitelist de edición
 *      (bedrooms, currency, description, ...) se cuela aquí, esto no es un
 *      diff (EC-5).
 *   8. NUNCA se filtra por `reported_by_user_id` — la única condición `.eq()`
 *      es `status = 'new'` (EC-7).
 *   9. `refetch()` vuelve a disparar la query y refleja un reporte nuevo que
 *      CREA un grupo nuevo (EC-12).
 *   10. Carrera de generaciones: la respuesta tardía de una generación VIEJA
 *       no pisa el estado ya asentado de una generación NUEVA, con el hook
 *       MONTADO durante toda la carrera — técnica EC-10/EC-11 de
 *       useAdminQueueCounts.test.tsx / useAdminRevisions.test.tsx (refetch,
 *       NO unmount) (EC-13).
 *
 * PATRÓN DE MOCK: `jest.mock('@/lib/supabase/client', ...)` con un holder
 * mutable `mock_supabase_holder` (mismo patrón que useAdminRevisions.test.tsx
 * — nombre con prefijo "mock" requerido por Jest para referenciar dentro del
 * factory). Cadena `.from('property_reports').select(cols).eq(col, val).order(col, opts)`
 * — `.order()` es el eslabón TERMINAL que devuelve la promesa `{data, error}`.
 * `.eq()` se registra en `calls.eq` (plural, arreglo) para poder verificar
 * EC-7 (una sola llamada, con `status`/`new`, nunca con `reported_by_user_id`).
 *
 * GOTCHAS RNTL ya pagados: `renderHook` con `await` + `act`; sin `await` el
 * `result` es `undefined` (rntl14_renderhook_async).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path — agrupación
 * - (EC-1) dos_reportes_de_la_misma_propiedad_se_agrupan_en_un_solo_item_con_report_count_dos
 * - (EC-2) reportes_de_dos_propiedades_distintas_producen_dos_items_en_el_orden_de_primera_aparicion_del_server
 * - (EC-3) lista_vacia_reports_array_vacio_sin_error_no_null
 *
 * ### Ramas de reglas no obvias
 * - (EC-4) la_query_se_construye_con_eq_status_new_y_order_created_at_descending
 * - (EC-5) el_select_incluye_las_columnas_propias_y_el_embed_de_display_sin_el_whitelist_de_edicion
 * - (EC-6) report_id_viene_del_id_de_property_reports_property_id_es_la_fk_nunca_se_confunden
 * - (EC-7) no_se_filtra_por_reported_by_user_id_la_cola_es_de_admin_no_mis_reportes
 * - (EC-8) dentro_de_un_grupo_los_reportes_conservan_el_orden_del_server_sin_reordenarlos
 *
 * ### Boundary / error
 * - (EC-9) carga_inicial_is_loading_true_reports_null_antes_de_que_resuelva_la_query
 * - (EC-10) error_de_postgrest_reports_null_y_mensaje_neutro_es_mx
 * - (EC-11) data_null_sin_error_se_trata_como_error_nunca_como_lista_vacia_fabricada
 * - (EC-12) refetch_vuelve_a_pedir_la_query_y_un_reporte_nuevo_crea_un_grupo_nuevo
 * - (EC-13) respuesta_tardia_de_una_generacion_vieja_estando_montado_no_pisa_la_generacion_nueva
 * - (EC-14) rechazo_de_promesa_tambien_cae_en_mensaje_neutro_sin_lanzar
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Import del SUT — DESPUÉS del jest.mock()
// ---------------------------------------------------------------------------

import { useAdminReports, type AdminReportQueueItem } from '../hooks/useAdminReports';

// ---------------------------------------------------------------------------
// Constantes y tipos de test
// ---------------------------------------------------------------------------

type RawResult = { data: unknown[] | null; error: null | { message: string } };

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar los reportes pendientes. Intenta de nuevo.';

/** Campos de display del embed a properties (NO el whitelist de edición). */
const DISPLAY_PROPERTY_COLUMNS = ['address', 'operation_type', 'property_type', 'price', 'status'];

/** Campos del whitelist de edición (edit-property/types.ts:29-52) que NUNCA deben colarse aquí. */
const EDIT_WHITELIST_ONLY_COLUMNS = [
  'bedrooms',
  'bathrooms',
  'square_meters',
  'built_square_meters',
  'half_bathrooms',
  'currency',
  'description',
  'pet_friendly',
  'allows_no_guarantor',
  'student_friendly',
];

function make_raw_property_row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'property-uuid-aaa',
    address: 'Av. Chapultepec 123, Guadalajara',
    operation_type: 'rent',
    property_type: 'departamento',
    price: 15000,
    status: 'suspended',
    ...overrides,
  };
}

function make_raw_report_row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'report-uuid-111',
    property_id: 'property-uuid-aaa',
    reason: 'misleading',
    reason_text: null,
    reported_by_user_id: 'user-uuid-1',
    created_at: '2026-08-20T10:00:00.000Z',
    property: make_raw_property_row(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Factory del mock de cliente — jest.mock del módulo (NO DI), cadena
// .from().select().eq().order() — `.order()` es el eslabón TERMINAL.
// ---------------------------------------------------------------------------

type Override = RawResult | Promise<RawResult> | (() => Promise<RawResult>);

interface MockCalls {
  from: string[];
  select: string[];
  eq: [string, unknown][];
  order: [string, unknown][];
}

function make_supabase_mock(override?: Override) {
  const calls: MockCalls = { from: [], select: [], eq: [], order: [] };

  function resolve_result(): Promise<RawResult> {
    if (override === undefined) {
      return Promise.resolve({ data: [make_raw_report_row()], error: null });
    }
    if (typeof override === 'function') return override();
    return override instanceof Promise ? override : Promise.resolve(override);
  }

  const chain: Record<string, unknown> = {};
  chain.select = jest.fn((cols: string) => {
    calls.select.push(cols);
    return chain;
  });
  chain.eq = jest.fn((col: string, val: unknown) => {
    calls.eq.push([col, val]);
    return chain;
  });
  chain.order = jest.fn((col: string, opts: unknown) => {
    calls.order.push([col, opts]);
    return resolve_result();
  });

  const mock_from = jest.fn().mockImplementation((table: string) => {
    calls.from.push(table);
    return chain;
  });

  return { from: mock_from, _calls: calls };
}

function make_pending_client() {
  const chain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn(() => new Promise<RawResult>(() => {})), // nunca resuelve
  };
  return { from: jest.fn().mockImplementation(() => chain), _chain: chain };
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

describe('useAdminReports', () => {
  // ── EC-1: agrupación básica ───────────────────────────────────────────────

  it('(EC-1) dos_reportes_de_la_misma_propiedad_se_agrupan_en_un_solo_item_con_report_count_dos: dos filas con el mismo property_id colapsan en un solo AdminReportQueueItem', async () => {
    const row_1 = make_raw_report_row({
      id: 'report-uuid-111',
      reason: 'misleading',
      created_at: '2026-08-20T11:00:00.000Z',
    });
    const row_2 = make_raw_report_row({
      id: 'report-uuid-222',
      reason: 'false_price',
      reason_text: null,
      reported_by_user_id: 'user-uuid-2',
      created_at: '2026-08-20T10:00:00.000Z',
    });
    mock_supabase_holder.client = make_supabase_mock({ data: [row_1, row_2], error: null });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
    expect(result.current.reports).toHaveLength(1);

    const item = (result.current.reports as AdminReportQueueItem[])[0]!;
    expect(item.property_id).toBe('property-uuid-aaa');
    expect(item.report_count).toBe(2);
    expect(item.reports).toHaveLength(2);
    expect(item.reports[0]!.report_id).toBe('report-uuid-111');
    expect(item.reports[0]!.reason).toBe('misleading');
    expect(item.reports[1]!.report_id).toBe('report-uuid-222');
    expect(item.reports[1]!.reason).toBe('false_price');
    expect(item.property.address).toBe('Av. Chapultepec 123, Guadalajara');
    expect(item.property.status).toBe('suspended');
  });

  // ── EC-2: orden de los grupos = primera aparición ─────────────────────────

  it('(EC-2) reportes_de_dos_propiedades_distintas_producen_dos_items_en_el_orden_de_primera_aparicion_del_server: el orden de los grupos sigue la primera aparición de cada property_id, sin reordenar por conteo', async () => {
    // Server ya viene ordenado created_at DESC. property-bbb aparece primero
    // (más reciente) con UN solo reporte; property-aaa aparece después con
    // DOS reportes. Si el hook reordenara "por conteo" (más reportes
    // primero), property-aaa saldría primero — este test lo prohíbe.
    const row_bbb = make_raw_report_row({
      id: 'report-uuid-bbb-1',
      property_id: 'property-uuid-bbb',
      created_at: '2026-08-20T12:00:00.000Z',
      property: make_raw_property_row({ id: 'property-uuid-bbb', address: 'Calle Reforma 45' }),
    });
    const row_aaa_1 = make_raw_report_row({
      id: 'report-uuid-aaa-1',
      property_id: 'property-uuid-aaa',
      created_at: '2026-08-20T11:00:00.000Z',
    });
    const row_aaa_2 = make_raw_report_row({
      id: 'report-uuid-aaa-2',
      property_id: 'property-uuid-aaa',
      created_at: '2026-08-20T10:00:00.000Z',
    });
    mock_supabase_holder.client = make_supabase_mock({
      data: [row_bbb, row_aaa_1, row_aaa_2],
      error: null,
    });

    const { result } = await renderHook(() => useAdminReports());

    const reports = result.current.reports as AdminReportQueueItem[];
    expect(reports).toHaveLength(2);
    expect(reports[0]!.property_id).toBe('property-uuid-bbb');
    expect(reports[0]!.report_count).toBe(1);
    expect(reports[1]!.property_id).toBe('property-uuid-aaa');
    expect(reports[1]!.report_count).toBe(2);
  });

  // ── EC-3: lista vacía legítima ────────────────────────────────────────────

  it('(EC-3) lista_vacia_reports_array_vacio_sin_error_no_null: una cola sin reportes nuevos es un resultado legítimo, no un error', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: [], error: null });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.error_message).toBeNull();
    expect(result.current.reports).toEqual([]);
  });

  // ── EC-4: construcción exacta de la query ─────────────────────────────────

  it('(EC-4) la_query_se_construye_con_eq_status_new_y_order_created_at_descending: .eq() y .order() reciben los argumentos exactos (property_reports_queue_idx es (status, created_at desc))', async () => {
    await renderHook(() => useAdminReports());

    const calls = mock_supabase_holder.client._calls;

    expect(calls.from).toEqual(['property_reports']);
    expect(calls.eq).toHaveLength(1);
    expect(calls.eq[0]?.[0]).toBe('status');
    expect(calls.eq[0]?.[1]).toBe('new');

    expect(calls.order).toHaveLength(1);
    expect(calls.order[0]?.[0]).toBe('created_at');
    expect(calls.order[0]?.[1]).toEqual({ ascending: false });
  });

  // ── EC-5: select trae columnas de display, no el whitelist de edición ────

  it('(EC-5) el_select_incluye_las_columnas_propias_y_el_embed_de_display_sin_el_whitelist_de_edicion: el string de .select() trae las columnas propias + el embed de display, sin ningún campo del whitelist de edit-property', async () => {
    await renderHook(() => useAdminReports());

    const calls = mock_supabase_holder.client._calls;
    expect(calls.select).toHaveLength(1);
    const select_arg = calls.select[0] ?? '';

    // Columnas propias de property_reports.
    expect(select_arg).toContain('reason_text');
    expect(select_arg).toContain('reported_by_user_id');
    expect(select_arg).toContain('created_at');
    expect(select_arg).toContain('property_id');

    // El embed a properties debe existir.
    expect(select_arg).toContain('properties');
    for (const col of DISPLAY_PROPERTY_COLUMNS) {
      expect(select_arg).toContain(col);
    }

    // Esto NO es un diff de edición — el whitelist de edit-property no se cuela.
    for (const col of EDIT_WHITELIST_ONLY_COLUMNS) {
      expect(select_arg).not.toContain(col);
    }
  });

  // ── EC-6: report_id vs property_id, sin cruzarse ──────────────────────────

  it('(EC-6) report_id_viene_del_id_de_property_reports_property_id_es_la_fk_nunca_se_confunden: los dos UUIDs distintos de la fila se mapean a su campo correcto', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: [
        make_raw_report_row({
          id: 'REPORT-ID-DISTINTO',
          property_id: 'PROP-ID-DISTINTO',
        }),
      ],
      error: null,
    });

    const { result } = await renderHook(() => useAdminReports());

    const item = (result.current.reports as AdminReportQueueItem[])[0]!;
    expect(item.property_id).toBe('PROP-ID-DISTINTO');
    expect(item.reports[0]!.report_id).toBe('REPORT-ID-DISTINTO');
    expect(item.reports[0]!.report_id).not.toBe(item.property_id);
  });

  // ── EC-7: nunca se filtra por reported_by_user_id ─────────────────────────

  it('(EC-7) no_se_filtra_por_reported_by_user_id_la_cola_es_de_admin_no_mis_reportes: la única llamada .eq() es status/new — jamás reported_by_user_id', async () => {
    await renderHook(() => useAdminReports());

    const calls = mock_supabase_holder.client._calls;
    // Si el hook agregara un segundo .eq('reported_by_user_id', ...) (patrón
    // "mis X" aplicado por error a una cola de ADMIN), esta lista tendría
    // longitud 2 y ocultaría reportes de otros usuarios al admin.
    expect(calls.eq).toHaveLength(1);
    expect(calls.eq.some(([col]) => col === 'reported_by_user_id')).toBe(false);
  });

  // ── EC-8: orden interno del grupo, sin reordenar ──────────────────────────

  it('(EC-8) dentro_de_un_grupo_los_reportes_conservan_el_orden_del_server_sin_reordenarlos: el array reports de un item respeta el orden exacto de llegada, no se re-ordena por fecha ni por razón', async () => {
    // Fechas deliberadamente NO monótonas (el server pudo entregarlas así en
    // un caso límite) — si el hook las re-ordenara internamente (ascendente,
    // descendente o alfabético por `reason`), este test lo cazaría.
    const row_a = make_raw_report_row({
      id: 'report-uuid-a',
      reason: 'duplicate',
      created_at: '2026-08-20T09:00:00.000Z',
    });
    const row_b = make_raw_report_row({
      id: 'report-uuid-b',
      reason: 'inappropriate',
      created_at: '2026-08-20T11:00:00.000Z',
    });
    const row_c = make_raw_report_row({
      id: 'report-uuid-c',
      reason: 'duplicate',
      created_at: '2026-08-20T10:00:00.000Z',
    });
    mock_supabase_holder.client = make_supabase_mock({
      data: [row_a, row_b, row_c],
      error: null,
    });

    const { result } = await renderHook(() => useAdminReports());

    const item = (result.current.reports as AdminReportQueueItem[])[0]!;
    expect(item.reports.map((r) => r.report_id)).toEqual([
      'report-uuid-a',
      'report-uuid-b',
      'report-uuid-c',
    ]);
  });

  // ── EC-9: carga inicial ────────────────────────────────────────────────────

  it('(EC-9) carga_inicial_is_loading_true_reports_null_antes_de_que_resuelva_la_query: mientras la query nunca resuelve, is_loading sigue true y reports sigue null', async () => {
    mock_supabase_holder.client = make_pending_client() as unknown as ReturnType<
      typeof make_supabase_mock
    >;

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.is_loading).toBe(true);
    expect(result.current.reports).toBeNull();
    expect(result.current.error_message).toBeNull();
  });

  // ── EC-10: error de PostgREST ──────────────────────────────────────────────

  it('(EC-10) error_de_postgrest_reports_null_y_mensaje_neutro_es_mx: un error de la query deja reports null y un mensaje neutro en español', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: null,
      error: { message: 'RLS denied' },
    });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.reports).toBeNull();
  });

  // ── EC-11: data null sin error ─────────────────────────────────────────────

  it('(EC-11) data_null_sin_error_se_trata_como_error_nunca_como_lista_vacia_fabricada: data null sin error produce error_message, no un array vacío silencioso', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: null, error: null });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.reports).toBeNull();
  });

  // ── EC-12: refetch crea un grupo nuevo ─────────────────────────────────────

  it('(EC-12) refetch_vuelve_a_pedir_la_query_y_un_reporte_nuevo_crea_un_grupo_nuevo: tras refetch, un reporte de una propiedad no vista antes aparece como un nuevo item', async () => {
    const { result } = await renderHook(() => useAdminReports());
    expect(result.current.reports).toHaveLength(1);

    const row_original = make_raw_report_row();
    const row_new_property = make_raw_report_row({
      id: 'report-uuid-nueva',
      property_id: 'property-uuid-nueva',
      created_at: '2026-08-21T08:00:00.000Z',
      property: make_raw_property_row({ id: 'property-uuid-nueva', address: 'Calle Nueva 99' }),
    });
    mock_supabase_holder.client = make_supabase_mock({
      data: [row_new_property, row_original],
      error: null,
    });

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.reports).toHaveLength(2);
    expect(result.current.reports?.[0]?.property_id).toBe('property-uuid-nueva');
  });

  // ── EC-13: carrera entre generaciones, hook MONTADO ───────────────────────

  it('(EC-13) respuesta_tardia_de_una_generacion_vieja_estando_montado_no_pisa_la_generacion_nueva: la generación vieja no puede sobrescribir el estado ya asentado de la generación nueva', async () => {
    let resolve_gen1!: (v: RawResult) => void;
    const pending_gen1 = new Promise<RawResult>((resolve) => {
      resolve_gen1 = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(pending_gen1);

    const { result } = await renderHook(() => useAdminReports());
    expect(result.current.is_loading).toBe(true);
    expect(result.current.reports).toBeNull();

    // gen2: swap del cliente ANTES del refetch — la nueva generación resuelve
    // de inmediato con un reporte de una propiedad distinta de gen1.
    const row_gen2 = make_raw_report_row({
      id: 'report-uuid-gen2',
      property_id: 'property-uuid-gen2',
      property: make_raw_property_row({ id: 'property-uuid-gen2' }),
    });
    mock_supabase_holder.client = make_supabase_mock({ data: [row_gen2], error: null });

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
    expect(result.current.reports).toHaveLength(1);
    expect(result.current.reports?.[0]?.property_id).toBe('property-uuid-gen2');

    // Recién ahora resuelve la promesa tardía de gen1 — hook sigue montado.
    await act(async () => {
      resolve_gen1({ data: [make_raw_report_row()], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Invariante: gen1 (vieja) no puede pisar el estado de gen2 (nueva).
    expect(result.current.reports).toHaveLength(1);
    expect(result.current.reports?.[0]?.property_id).toBe('property-uuid-gen2');
    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
  });

  // ── EC-14: rechazo de promesa ───────────────────────────────────────────────

  it('(EC-14) rechazo_de_promesa_tambien_cae_en_mensaje_neutro_sin_lanzar: un reject (no un {error}) de la query no tumba el hook y produce el mismo mensaje neutro', async () => {
    mock_supabase_holder.client = make_supabase_mock(() => Promise.reject(new Error('network down')));

    let thrown: unknown = null;
    let final_state: { reports: unknown; error_message: string | null } | undefined;
    try {
      const rendered = await renderHook(() => useAdminReports());
      final_state = rendered.result.current;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(final_state?.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(final_state?.reports).toBeNull();
  });
});
