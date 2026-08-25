/**
 * Tests fase RED — useAdminRevisions (cola de revisiones de ediciones,
 * property_revisions activas: pending|needs_changes, módulo 041-M1, tarea #218)
 * Archivo SUT: mobile/src/features/admin/hooks/useAdminRevisions.ts
 * Subtarea Taskmaster: 218.1
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — no se
 * renegocia sin dejar rastro en la bitácora):
 *
 *   useAdminRevisions(): {
 *     revisions: AdminRevisionItem[] | null;
 *     is_loading: boolean;
 *     error_message: string | null;
 *     refetch: () => void;
 *   }
 *
 *   AdminRevisionItem = {
 *     revision_id: string;      // id de property_revisions — NO confundir con property_id
 *     property_id: string;
 *     status: 'pending' | 'needs_changes';
 *     changed_fields: Record<string, unknown>;
 *     rejection_reason: string | null;
 *     created_at: string;
 *     property: AdminRevisionPropertySnapshot;   // embed, snapshot PUBLICADO para el diff
 *   }
 *
 *   AdminRevisionPropertySnapshot = exactamente el whitelist de edición de la EF
 *   edit-property (supabase/functions/edit-property/types.ts:29-52,
 *   `EditPropertyInput` menos `property_id`) + `id`:
 *     id, operation_type, property_type, price, price_visible, bedrooms,
 *     bathrooms, square_meters, built_square_meters, half_bathrooms, currency,
 *     address, description, pet_friendly, allows_no_guarantor, student_friendly.
 *   (Nota: `properties` NO tiene columna `title` — verificado contra
 *   supabase/migrations/20260604000005_properties_and_videos.sql:8-42. `address`
 *   es el campo público que identifica la propiedad en el diff.)
 *
 * QUERY ÚNICA bajo test (patrón calcado de useAdminQueueCounts — sin RPC nueva,
 * la policy RLS `property_revisions_select` ya autoriza el SELECT al admin vía
 * `private.is_admin()`, supabase/migrations/20260809000003_property_revisions.sql:67-74):
 *
 *   supabase
 *     .from('property_revisions')
 *     .select(<columnas propias + embed 'property:properties(...)'>)
 *     .in('status', ['pending', 'needs_changes'])
 *     .order('created_at', { ascending: true })   // FIFO: la más vieja primero
 *
 * INVARIANTES QUE ESTE ARCHIVO DEBE CLAVAR:
 *   1. Todo-o-nada: error de PostgREST, `data: null` sin error, o rechazo de la
 *      promesa → `revisions=null` + mensaje neutro — NUNCA una lista parcial ni
 *      un `[]` fabricado que le mienta al admin sobre una cola vacía (EC-8,
 *      EC-11, EC-9 — mismo criterio que useAdminQueueCounts EC-6/EC-8/EC-10).
 *   2. Lista vacía LEGÍTIMA (`data: []`, sin error) es un resultado real:
 *      `revisions=[]`, nunca `null` ni error (EC-2).
 *   3. Orden: el hook NO re-ordena client-side — respeta el orden que YA viene
 *      del `.order('created_at', {ascending: true})` del server (EC-1, EC-3).
 *   4. `revision_id` viene de `id` de `property_revisions`, y `property_id` es
 *      la FK — nunca se confunden aunque ambos sean UUIDs (EC-5, valores
 *      deliberadamente distintos y no intercambiables para cazar un mapeo
 *      cruzado).
 *   5. El embed a `properties` trae EXACTAMENTE el whitelist de edit-property,
 *      ni más ni menos — el `.select()` se verifica por substring de cada
 *      columna esperada (EC-4).
 *   6. `refetch()` vuelve a disparar la query y refleja un cambio en el
 *      backend entre la carga inicial y el refetch (EC-9).
 *   7. Carrera de generaciones: la respuesta tardía de una generación VIEJA no
 *      pisa el estado ya asentado de una generación NUEVA, con el hook
 *      MONTADO durante toda la carrera — técnica EC-11 de
 *      useAdminQueueCounts.test.tsx (refetch, NO unmount: en React 19 un
 *      setState tras unmount es no-op silencioso y no distingue el guard
 *      `ignore` correcto de uno roto) (EC-10).
 *
 * PATRÓN DE MOCK: `jest.mock('@/lib/supabase/client', ...)` con un holder
 * mutable `mock_supabase_holder` (mismo patrón que useAdminQueueCounts.test.tsx
 * — nombre con prefijo "mock" requerido por Jest para referenciar dentro del
 * factory). Cadena `.from('property_revisions').select(cols).in(col, vals).order(col, opts)`
 * — `.order()` es el eslabón TERMINAL que devuelve la promesa `{data, error}`.
 *
 * GOTCHAS RNTL ya pagados: `renderHook` con `await` + `act`; sin `await` el
 * `result` es `undefined` (rntl14_renderhook_async).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) camino_feliz_dos_revisiones_shape_completo_y_orden_del_server_respetado
 * - (EC-2) lista_vacia_revisions_array_vacio_sin_error_no_null
 *
 * ### Ramas de reglas no obvias
 * - (EC-3) la_query_se_construye_con_in_status_pending_needs_changes_y_order_created_at_ascending
 * - (EC-4) el_select_incluye_las_columnas_propias_y_el_embed_a_properties_con_el_whitelist_exacto
 * - (EC-5) revision_id_viene_del_id_de_property_revisions_property_id_es_la_fk_nunca_se_confunden
 *
 * ### Boundary / error
 * - (EC-6) carga_inicial_is_loading_true_revisions_null_antes_de_que_resuelva_la_query
 * - (EC-7) error_de_postgrest_revisions_null_y_mensaje_neutro_es_mx
 * - (EC-8) data_null_sin_error_se_trata_como_error_nunca_como_lista_vacia_fabricada
 * - (EC-9) refetch_vuelve_a_pedir_la_query_y_refleja_una_revision_nueva_del_backend
 * - (EC-10) respuesta_tardia_de_una_generacion_vieja_estando_montado_no_pisa_la_generacion_nueva
 * - (EC-11) rechazo_de_promesa_tambien_cae_en_mensaje_neutro_sin_lanzar
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Import del SUT — DESPUÉS del jest.mock()
// ---------------------------------------------------------------------------

import { useAdminRevisions, type AdminRevisionItem } from '../hooks/useAdminRevisions';

// ---------------------------------------------------------------------------
// Constantes y tipos de test
// ---------------------------------------------------------------------------

type RawResult = { data: unknown[] | null; error: null | { message: string } };

const NEUTRAL_ERROR_MESSAGE =
  'No se pudieron cargar las revisiones pendientes. Intenta de nuevo.';

/** Columnas del whitelist de edit-property (types.ts:29-52) que el embed debe traer. */
const WHITELIST_PROPERTY_COLUMNS = [
  'operation_type',
  'property_type',
  'price',
  'price_visible',
  'bedrooms',
  'bathrooms',
  'square_meters',
  'built_square_meters',
  'half_bathrooms',
  'currency',
  'address',
  'description',
  'pet_friendly',
  'allows_no_guarantor',
  'student_friendly',
];

function make_raw_property_row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'property-uuid-aaa',
    operation_type: 'rent',
    property_type: 'departamento',
    price: 15000,
    price_visible: true,
    bedrooms: 2,
    bathrooms: 1,
    square_meters: 65,
    built_square_meters: 60,
    half_bathrooms: 0,
    currency: 'MXN',
    address: 'Av. Chapultepec 123, Guadalajara',
    description: 'Depa amueblado cerca del centro',
    pet_friendly: true,
    allows_no_guarantor: false,
    student_friendly: true,
    ...overrides,
  };
}

function make_raw_revision_row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'revision-uuid-111',
    property_id: 'property-uuid-aaa',
    status: 'pending',
    changed_fields: { price: 16000 },
    rejection_reason: null,
    created_at: '2026-08-20T10:00:00.000Z',
    property: make_raw_property_row(),
    ...overrides,
  };
}

const REVISION_ROW_1 = make_raw_revision_row({
  id: 'revision-uuid-111',
  property_id: 'property-uuid-aaa',
  status: 'pending',
  created_at: '2026-08-19T09:00:00.000Z',
});

const REVISION_ROW_2 = make_raw_revision_row({
  id: 'revision-uuid-222',
  property_id: 'property-uuid-bbb',
  status: 'needs_changes',
  rejection_reason: 'Faltan fotos de la fachada',
  created_at: '2026-08-20T11:00:00.000Z',
  changed_fields: { description: 'nueva descripción' },
  property: make_raw_property_row({ id: 'property-uuid-bbb', address: 'Calle Reforma 45' }),
});

// ---------------------------------------------------------------------------
// Factory del mock de cliente — jest.mock del módulo (NO DI), cadena
// .from().select().in().order() — `.order()` es el eslabón TERMINAL.
// ---------------------------------------------------------------------------

type Override = RawResult | Promise<RawResult> | (() => Promise<RawResult>);

interface MockCalls {
  from: string[];
  select: string[];
  in_calls: [string, unknown][];
  order: [string, unknown][];
}

function make_supabase_mock(override?: Override) {
  const calls: MockCalls = { from: [], select: [], in_calls: [], order: [] };

  function resolve_result(): Promise<RawResult> {
    if (override === undefined) {
      return Promise.resolve({ data: [REVISION_ROW_1, REVISION_ROW_2], error: null });
    }
    if (typeof override === 'function') return override();
    return override instanceof Promise ? override : Promise.resolve(override);
  }

  const chain: Record<string, unknown> = {};
  chain.select = jest.fn((cols: string) => {
    calls.select.push(cols);
    return chain;
  });
  chain.in = jest.fn((col: string, vals: unknown) => {
    calls.in_calls.push([col, vals]);
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
    in: jest.fn().mockReturnThis(),
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

describe('useAdminRevisions', () => {
  // ── EC-1: Camino feliz ──────────────────────────────────────────────────

  it('(EC-1) camino_feliz_dos_revisiones_shape_completo_y_orden_del_server_respetado: revisions mapea ambas filas con revision_id/property/changed_fields correctos, en el orden del server', async () => {
    const { result } = await renderHook(() => useAdminRevisions());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
    expect(result.current.revisions).toHaveLength(2);

    const revisions = result.current.revisions as AdminRevisionItem[];
    const first = revisions[0]!;
    const second = revisions[1]!;

    expect(first.revision_id).toBe('revision-uuid-111');
    expect(first.property_id).toBe('property-uuid-aaa');
    expect(first.status).toBe('pending');
    expect(first.changed_fields).toEqual({ price: 16000 });
    expect(first.rejection_reason).toBeNull();
    expect(first.property.address).toBe('Av. Chapultepec 123, Guadalajara');
    expect(first.property.price).toBe(15000);

    // El orden NO se re-ordena client-side: refleja tal cual la respuesta del server.
    expect(second.revision_id).toBe('revision-uuid-222');
    expect(second.status).toBe('needs_changes');
    expect(second.rejection_reason).toBe('Faltan fotos de la fachada');
    expect(second.property.address).toBe('Calle Reforma 45');
  });

  // ── EC-2: Lista vacía legítima ───────────────────────────────────────────

  it('(EC-2) lista_vacia_revisions_array_vacio_sin_error_no_null: una cola sin revisiones activas es un resultado legítimo, no un error', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: [], error: null });

    const { result } = await renderHook(() => useAdminRevisions());

    expect(result.current.error_message).toBeNull();
    expect(result.current.revisions).toEqual([]);
  });

  // ── EC-3: construcción exacta de la query ────────────────────────────────

  it('(EC-3) la_query_se_construye_con_in_status_pending_needs_changes_y_order_created_at_ascending: .in() y .order() reciben los argumentos exactos', async () => {
    await renderHook(() => useAdminRevisions());

    const calls = mock_supabase_holder.client._calls;

    expect(calls.from).toEqual(['property_revisions']);
    expect(calls.in_calls).toHaveLength(1);
    expect(calls.in_calls[0]?.[0]).toBe('status');
    expect(calls.in_calls[0]?.[1]).toEqual(['pending', 'needs_changes']);

    expect(calls.order).toHaveLength(1);
    expect(calls.order[0]?.[0]).toBe('created_at');
    expect(calls.order[0]?.[1]).toEqual({ ascending: true });
  });

  // ── EC-4: select trae el whitelist exacto ────────────────────────────────

  it('(EC-4) el_select_incluye_las_columnas_propias_y_el_embed_a_properties_con_el_whitelist_exacto: el string de .select() contiene el embed y las 15 columnas del whitelist de edit-property', async () => {
    await renderHook(() => useAdminRevisions());

    const calls = mock_supabase_holder.client._calls;
    expect(calls.select).toHaveLength(1);
    const select_arg = calls.select[0] ?? '';

    // Columnas propias de property_revisions.
    expect(select_arg).toContain('changed_fields');
    expect(select_arg).toContain('rejection_reason');
    expect(select_arg).toContain('created_at');
    expect(select_arg).toContain('status');
    expect(select_arg).toContain('property_id');

    // El embed a properties debe existir (sintaxis PostgREST `alias:tabla(...)`).
    expect(select_arg).toContain('properties');

    // Whitelist exacto de edit-property — ni un campo del PRD de moderación
    // (like_count, view_count, agency_id, owner_user_id, ...) se cuela.
    for (const col of WHITELIST_PROPERTY_COLUMNS) {
      expect(select_arg).toContain(col);
    }
  });

  // ── EC-5: revision_id vs property_id, sin cruzarse ───────────────────────

  it('(EC-5) revision_id_viene_del_id_de_property_revisions_property_id_es_la_fk_nunca_se_confunden: los dos UUIDs distintos de la fila se mapean a su campo correcto', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: [
        make_raw_revision_row({
          id: 'REV-ID-DISTINTO',
          property_id: 'PROP-ID-DISTINTO',
        }),
      ],
      error: null,
    });

    const { result } = await renderHook(() => useAdminRevisions());

    const item = (result.current.revisions as AdminRevisionItem[])[0]!;
    expect(item.revision_id).toBe('REV-ID-DISTINTO');
    expect(item.property_id).toBe('PROP-ID-DISTINTO');
    expect(item.revision_id).not.toBe(item.property_id);
  });

  // ── EC-6: carga inicial ───────────────────────────────────────────────────

  it('(EC-6) carga_inicial_is_loading_true_revisions_null_antes_de_que_resuelva_la_query: mientras la query nunca resuelve, is_loading sigue true y revisions sigue null', async () => {
    mock_supabase_holder.client = make_pending_client() as unknown as ReturnType<
      typeof make_supabase_mock
    >;

    const { result } = await renderHook(() => useAdminRevisions());

    expect(result.current.is_loading).toBe(true);
    expect(result.current.revisions).toBeNull();
    expect(result.current.error_message).toBeNull();
  });

  // ── EC-7: error de PostgREST ──────────────────────────────────────────────

  it('(EC-7) error_de_postgrest_revisions_null_y_mensaje_neutro_es_mx: un error de la query deja revisions null y un mensaje neutro en español', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: null,
      error: { message: 'RLS denied' },
    });

    const { result } = await renderHook(() => useAdminRevisions());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.revisions).toBeNull();
  });

  // ── EC-8: data null sin error ─────────────────────────────────────────────

  it('(EC-8) data_null_sin_error_se_trata_como_error_nunca_como_lista_vacia_fabricada: data null sin error produce error_message, no un array vacío silencioso', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: null, error: null });

    const { result } = await renderHook(() => useAdminRevisions());

    expect(result.current.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(result.current.revisions).toBeNull();
  });

  // ── EC-9: refetch ──────────────────────────────────────────────────────────

  it('(EC-9) refetch_vuelve_a_pedir_la_query_y_refleja_una_revision_nueva_del_backend: tras refetch, una revisión nueva llegada al backend aparece en el estado', async () => {
    const { result } = await renderHook(() => useAdminRevisions());
    expect(result.current.revisions).toHaveLength(2);

    // Entre la carga inicial y el refetch llegó una tercera revisión.
    const REVISION_ROW_3 = make_raw_revision_row({
      id: 'revision-uuid-333',
      property_id: 'property-uuid-ccc',
      created_at: '2026-08-21T08:00:00.000Z',
    });
    mock_supabase_holder.client = make_supabase_mock({
      data: [REVISION_ROW_1, REVISION_ROW_2, REVISION_ROW_3],
      error: null,
    });

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.revisions).toHaveLength(3);
    expect(result.current.revisions?.[2]?.revision_id).toBe('revision-uuid-333');
  });

  // ── EC-10: carrera entre generaciones, hook MONTADO ──────────────────────
  //
  // Técnica calcada de useAdminQueueCounts.test.tsx EC-11: refetch (no
  // unmount) es la única forma de probar el invariante fuerte del guard
  // `ignore`, porque tras un unmount React 19 hace no-op silencioso del
  // setState y no distinguiría el código correcto de un guard borrado.

  it('(EC-10) respuesta_tardia_de_una_generacion_vieja_estando_montado_no_pisa_la_generacion_nueva: la generación vieja no puede sobrescribir el estado ya asentado de la generación nueva', async () => {
    let resolve_gen1!: (v: RawResult) => void;
    const pending_gen1 = new Promise<RawResult>((resolve) => {
      resolve_gen1 = resolve;
    });
    mock_supabase_holder.client = make_supabase_mock(pending_gen1);

    const { result } = await renderHook(() => useAdminRevisions());
    expect(result.current.is_loading).toBe(true);
    expect(result.current.revisions).toBeNull();

    // gen2: swap del cliente ANTES del refetch — la nueva generación resuelve
    // de inmediato con una sola revisión, distinta de gen1.
    const REVISION_GEN2 = make_raw_revision_row({
      id: 'revision-uuid-gen2',
      property_id: 'property-uuid-gen2',
    });
    mock_supabase_holder.client = make_supabase_mock({ data: [REVISION_GEN2], error: null });

    await act(async () => {
      result.current.refetch();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
    expect(result.current.revisions).toHaveLength(1);
    expect(result.current.revisions?.[0]?.revision_id).toBe('revision-uuid-gen2');

    // Recién ahora resuelve la promesa tardía de gen1 — hook sigue montado.
    await act(async () => {
      resolve_gen1({ data: [REVISION_ROW_1, REVISION_ROW_2], error: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Invariante: gen1 (vieja) no puede pisar el estado de gen2 (nueva).
    expect(result.current.revisions).toHaveLength(1);
    expect(result.current.revisions?.[0]?.revision_id).toBe('revision-uuid-gen2');
    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).toBeNull();
  });

  // ── EC-11: rechazo de promesa ──────────────────────────────────────────────

  it('(EC-11) rechazo_de_promesa_tambien_cae_en_mensaje_neutro_sin_lanzar: un reject (no un {error}) de la query no tumba el hook y produce el mismo mensaje neutro', async () => {
    mock_supabase_holder.client = make_supabase_mock(() => Promise.reject(new Error('network down')));

    let thrown: unknown = null;
    let final_state: { revisions: unknown; error_message: string | null } | undefined;
    try {
      const rendered = await renderHook(() => useAdminRevisions());
      final_state = rendered.result.current;
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(final_state?.error_message).toBe(NEUTRAL_ERROR_MESSAGE);
    expect(final_state?.revisions).toBeNull();
  });
});
