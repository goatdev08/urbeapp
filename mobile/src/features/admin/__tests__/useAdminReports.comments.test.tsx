/**
 * Tests fase RED — useAdminReports, EXTENSIÓN para comentarios (289.6/289.7,
 * tarea #289). Archivo NUEVO — el archivo hermano useAdminReports.test.tsx
 * (220.4, property) NO SE TOCA y debe seguir verde.
 * SUT: mobile/src/features/admin/hooks/useAdminReports.ts
 *
 * SEAM BAJO TEST — CONTRATO NUEVO fijado por el test-author (prompt 289.6,
 * decisión de Abraham: UNA lista mezclada por fecha, no dos colas separadas):
 *
 *   useAdminReports(): {
 *     reports: AdminReportQueueItem[] | null;   // 🔴 el CAMPO se queda
 *                                                // llamado `reports` (NO se
 *                                                // renombra a `items`) — es
 *                                                // la migración mínima: los
 *                                                // 14 tests existentes de
 *                                                // useAdminReports.test.tsx
 *                                                // siguen leyendo
 *                                                // `result.current.reports`
 *                                                // sin tocarse.
 *     is_loading: boolean;
 *     error_message: string | null;
 *     refetch: () => void;
 *   }
 *
 *   AdminReportQueueItem =
 *     | AdminPropertyReportQueueItem   // EXACTAMENTE los campos vigentes
 *                                      // (property_id, property, reports,
 *                                      // report_count) + gana `kind:'property'`
 *                                      // (campo ADITIVO — los 14 tests
 *                                      // existentes no comprueban su
 *                                      // ausencia, así que añadirlo no los
 *                                      // rompe; smoke de esto en EC-11).
 *     | AdminCommentReportQueueItem    // NUEVO — ver shape abajo.
 *
 *   AdminCommentReportQueueItem = {
 *     kind: 'comment';
 *     id: string;                 // comment_reports.id del reporte MÁS
 *                                  // RECIENTE del grupo (NUNCA comment_id)
 *     comment_id: string;
 *     body: string;               // comments.body
 *     status: string;             // comments.status ('hidden' — la cola
 *                                  // solo trae reportes 'new', que solo
 *                                  // existen sobre comentarios ya ocultos
 *                                  // por el trigger de auto-ocultar, pero el
 *                                  // hook NO filtra por status de comments,
 *                                  // solo refleja el que venga)
 *     author_display_name: string;
 *     property_id: string;
 *     property_title: string;     // properties.address (no existe columna
 *                                  // "title" — mismo criterio que
 *                                  // AdminReportPropertySnapshot.address)
 *     reason: string;              // del reporte MÁS RECIENTE del grupo
 *     reason_text: string | null;  // ídem
 *     created_at: string;          // ídem — es la clave de MERGE con los
 *                                  // items 'property' (ver abajo)
 *     report_count: number;
 *   }
 *
 * DOS QUERYS NUEVAS (paralelas a la ya existente de property_reports):
 *
 *   1) supabase
 *        .from('comment_reports')
 *        .select(<id,comment_id,reason,reason_text,created_at +
 *                 embed comment:comments(id,body,status,user_id,property_id
 *                 + nested property:properties(id,address))>)
 *        .eq('status', 'new')             // EXPLÍCITO (igual que property)
 *        .order('created_at', { ascending: false })
 *
 *   2) supabase
 *        .from('agent_public_profiles')
 *        .select('user_id, full_name')
 *        .in('user_id', <user_id DISTINTOS de los comentarios traídos>)
 *      — mismo patrón de identidad que usePropertyDetail.identity.test.tsx
 *        (consulta SEPARADA a la vista, NUNCA un embed a `users`/
 *        `user_preferences` — la RLS de esas tablas oculta filas ajenas).
 *      — 🔴 si la query (1) NO trae ningún comentario, la query (2) NUNCA se
 *        dispara (evita `.in('user_id', [])`, EC-10).
 *      — sin fila de perfil o `full_name` null → fallback `'Agente Urbea'`
 *        (mismo default que ProfileHeader.tsx:110).
 *
 * AGRUPACIÓN de comment_reports: idéntica a property_reports — filas con el
 * mismo `comment_id` colapsan en UN item, orden de GRUPOS = primera
 * aparición en el orden ya-ordenado del server (NO se reordena por conteo).
 *
 * MERGE final (`reports`): los items 'property' y 'comment' se intercalan por
 * fecha DESC — clave de fecha: `property` → `reports[0].created_at` (el
 * reporte más reciente del grupo); `comment` → `created_at` propio (mismo
 * significado). Un item más reciente de cualquier kind precede a uno más
 * viejo del otro kind.
 *
 * 🔴 FAIL-SOFT CRUZADO (lección 269.5, DISTINTO del "todo-o-nada" de una sola
 * query): un error en CUALQUIERA de las dos fuentes (property_reports o
 * comment_reports) setea `error_message` y dobla `is_loading` a `false`, pero
 * la OTRA fuente SIGUE APORTANDO sus items al array `reports` — NUNCA se
 * descarta la lista completa por el fallo de una sola fuente (try/catch por
 * fuente, EC-13/EC-14). Si AMBAS fuentes fallan, `reports` es `[]` (nunca
 * `null` — cada fuente fallida simplemente no aporta items, no es un estado
 * de error total sin datos como en la query única de antes).
 *
 * GOTCHAS RNTL ya pagados: `renderHook`/`act` con `await`; sin `await` el
 * `result` es `undefined` (rntl14_renderhook_async).
 *
 * 🔴 tsc: este archivo importa SOLO `useAdminReports` (sin tipos nuevos del
 * SUT) — los shapes nuevos (`AdminCommentReportQueueItem`, etc.) se declaran
 * LOCALMENTE en este archivo (mismo patrón que
 * moderate-property/report_resolution.test.ts con su `Deps` local). `pnpm
 * tsc --noEmit` fallará hasta GREEN porque el hook real no expone `kind` ni
 * consulta `comment_reports`/`agent_public_profiles` — esperado en RED.
 *
 * EDGE CASES (RED) — 289.6/289.7:
 *
 * ### Happy path — agrupación y forma del item 'comment'
 * - (EC-1) dos_reportes_del_mismo_comment_id_se_agrupan_en_un_item_comment_con_report_count_dos
 * - (EC-2) reportes_de_dos_comment_id_distintos_producen_dos_items_comment_en_orden_de_primera_aparicion
 * - (EC-3) el_item_comment_expone_id_del_reporte_mas_reciente_nunca_el_comment_id
 * - (EC-4) property_title_sale_del_address_de_la_propiedad_embebida
 *
 * ### Query exacta — comment_reports
 * - (EC-5) eq_status_new_explicito_y_order_created_at_descending_en_comment_reports
 * - (EC-6) el_select_de_comment_reports_incluye_columnas_propias_y_el_embed_anidado_a_comments_y_properties
 *
 * ### Identidad — agent_public_profiles
 * - (EC-7) se_consulta_agent_public_profiles_con_in_user_id_batcheando_los_distintos
 * - (EC-8) author_display_name_usa_el_full_name_de_la_vista_cuando_existe
 * - (EC-9) sin_fila_de_perfil_o_full_name_null_cae_a_agente_urbea
 * - (EC-10) sin_comentarios_reportados_la_query_a_agent_public_profiles_nunca_se_dispara
 *
 * ### Mezcla (merge) por fecha
 * - (EC-11) items_property_y_comment_se_intercalan_por_created_at_desc_en_un_solo_array_reports
 * - (EC-12) item_property_conserva_kind_property_y_sus_campos_vigentes_intactos
 *
 * ### Fail-soft cruzado (lección 269.5)
 * - (EC-13) error_en_comment_reports_no_descarta_los_items_property_ya_cargados
 * - (EC-14) error_en_property_reports_no_descarta_los_items_comment_ya_cargados
 * - (EC-15) ambas_fuentes_fallan_reports_es_arreglo_vacio_nunca_null_con_error_message_seteado
 * - (EC-16) comment_reports_RECHAZA_la_promesa_red_caida_no_cuelga_loading_y_property_sigue
 *   (guardian 289.6: sin este caso el try/catch de fetch_comment_items era un mutante vivo —
 *   EC-13 solo cubría el envelope {data:null,error}, no el reject)
 */

import { renderHook } from '@testing-library/react-native';

import { useAdminReports } from '../hooks/useAdminReports';

// ---------------------------------------------------------------------------
// Tipos LOCALES del contrato nuevo (NO importados del SUT — ver nota tsc arriba)
// ---------------------------------------------------------------------------

interface LocalCommentQueueItem {
  kind: 'comment';
  id: string;
  comment_id: string;
  body: string;
  status: string;
  author_display_name: string;
  property_id: string;
  property_title: string;
  reason: string;
  reason_text: string | null;
  created_at: string;
  report_count: number;
}

interface LocalPropertyQueueItem {
  kind: 'property';
  property_id: string;
  property: { id: string; address: string; status: string };
  reports: { report_id: string; created_at: string }[];
  report_count: number;
}

type LocalQueueItem = LocalPropertyQueueItem | LocalCommentQueueItem;

// ---------------------------------------------------------------------------
// Fixtures crudos
// ---------------------------------------------------------------------------

function make_raw_property_report_row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'preport-uuid-1',
    property_id: 'property-uuid-aaa',
    reason: 'misleading',
    reason_text: null,
    reported_by_user_id: 'user-uuid-1',
    created_at: '2026-09-01T10:00:00.000Z',
    property: {
      id: 'property-uuid-aaa',
      address: 'Av. Chapultepec 123, Guadalajara',
      operation_type: 'rent',
      property_type: 'departamento',
      price: 15000,
      status: 'suspended',
    },
    ...overrides,
  };
}

function make_raw_comment_report_row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'creport-uuid-1',
    comment_id: 'comment-uuid-1',
    reason: 'offensive',
    reason_text: null,
    created_at: '2026-09-10T12:00:00.000Z',
    comment: {
      id: 'comment-uuid-1',
      body: 'Contenido ofensivo',
      status: 'hidden',
      user_id: 'user-uuid-9',
      property_id: 'property-uuid-9',
      property: { id: 'property-uuid-9', address: 'Calle Reforma 45, Guadalajara' },
    },
    ...overrides,
  };
}

function make_raw_profile_row(overrides: Record<string, unknown> = {}) {
  return { user_id: 'user-uuid-9', full_name: 'Andrea Pérez', ...overrides };
}

// ---------------------------------------------------------------------------
// Mock multi-tabla — .from(table) devuelve una cadena distinta según la tabla
// ---------------------------------------------------------------------------

type RawResult = { data: unknown[] | null; error: null | { message: string } };
type Behavior = RawResult | Promise<RawResult> | (() => Promise<RawResult>);

function resolve_behavior(b: Behavior | undefined, fallback: RawResult): Promise<RawResult> {
  if (b === undefined) return Promise.resolve(fallback);
  if (typeof b === 'function') return b();
  return b instanceof Promise ? b : Promise.resolve(b);
}

interface Calls {
  from: string[];
  property_reports: { select: string[]; eq: [string, unknown][]; order: [string, unknown][] };
  comment_reports: { select: string[]; eq: [string, unknown][]; order: [string, unknown][] };
  agent_public_profiles: { select: string[]; in: [string, unknown[]][] };
}

function make_supabase_mock(opts: {
  property_reports?: Behavior;
  comment_reports?: Behavior;
  agent_public_profiles?: Behavior;
} = {}) {
  const calls: Calls = {
    from: [],
    property_reports: { select: [], eq: [], order: [] },
    comment_reports: { select: [], eq: [], order: [] },
    agent_public_profiles: { select: [], in: [] },
  };

  function make_select_eq_order_chain(
    bucket: 'property_reports' | 'comment_reports',
    behavior: Behavior | undefined,
    fallback: RawResult,
  ) {
    const chain: Record<string, unknown> = {};
    chain.select = jest.fn((cols: string) => {
      calls[bucket].select.push(cols);
      return chain;
    });
    chain.eq = jest.fn((col: string, val: unknown) => {
      calls[bucket].eq.push([col, val]);
      return chain;
    });
    chain.order = jest.fn((col: string, o: unknown) => {
      calls[bucket].order.push([col, o]);
      return resolve_behavior(behavior, fallback);
    });
    return chain;
  }

  function make_select_in_chain(behavior: Behavior | undefined, fallback: RawResult) {
    const chain: Record<string, unknown> = {};
    chain.select = jest.fn((cols: string) => {
      calls.agent_public_profiles.select.push(cols);
      return chain;
    });
    chain.in = jest.fn((col: string, vals: unknown[]) => {
      calls.agent_public_profiles.in.push([col, vals as unknown[]]);
      return resolve_behavior(behavior, fallback);
    });
    return chain;
  }

  const property_chain = make_select_eq_order_chain('property_reports', opts.property_reports, {
    data: [],
    error: null,
  });
  const comment_chain = make_select_eq_order_chain('comment_reports', opts.comment_reports, {
    data: [make_raw_comment_report_row()],
    error: null,
  });
  const profiles_chain = make_select_in_chain(opts.agent_public_profiles, {
    data: [make_raw_profile_row()],
    error: null,
  });

  const from = jest.fn().mockImplementation((table: string) => {
    calls.from.push(table);
    if (table === 'property_reports') return property_chain;
    if (table === 'comment_reports') return comment_chain;
    if (table === 'agent_public_profiles') return profiles_chain;
    throw new Error(`tabla no mockeada en este test: ${table}`);
  });

  return { from, _calls: calls };
}

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

// ---------------------------------------------------------------------------
// Happy path — agrupación y forma del item 'comment'
// ---------------------------------------------------------------------------

describe('useAdminReports — items kind:"comment"', () => {
  it('(EC-1) dos reportes del mismo comment_id se agrupan en un item con report_count 2', async () => {
    const row_1 = make_raw_comment_report_row({
      id: 'creport-uuid-1',
      reason: 'offensive',
      created_at: '2026-09-10T12:00:00.000Z',
    });
    const row_2 = make_raw_comment_report_row({
      id: 'creport-uuid-2',
      reason: 'spam',
      reason_text: null,
      created_at: '2026-09-10T11:00:00.000Z',
    });
    mock_supabase_holder.client = make_supabase_mock({
      comment_reports: { data: [row_1, row_2], error: null },
    });

    const { result } = await renderHook(() => useAdminReports());

    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    const comment_items = items.filter((i): i is LocalCommentQueueItem => i.kind === 'comment');

    expect(comment_items).toHaveLength(1);
    expect(comment_items[0]?.comment_id).toBe('comment-uuid-1');
    expect(comment_items[0]?.report_count).toBe(2);
    // El reporte MÁS RECIENTE (row_1) fija id/reason/created_at del grupo.
    expect(comment_items[0]?.id).toBe('creport-uuid-1');
    expect(comment_items[0]?.reason).toBe('offensive');
  });

  it('(EC-2) reportes de dos comment_id distintos producen dos items comment en orden de primera aparición', async () => {
    const row_bbb = make_raw_comment_report_row({
      id: 'creport-bbb-1',
      comment_id: 'comment-uuid-bbb',
      created_at: '2026-09-10T13:00:00.000Z',
      comment: {
        id: 'comment-uuid-bbb',
        body: 'Otro comentario',
        status: 'hidden',
        user_id: 'user-uuid-9',
        property_id: 'property-uuid-9',
        property: { id: 'property-uuid-9', address: 'Calle Reforma 45, Guadalajara' },
      },
    });
    const row_aaa = make_raw_comment_report_row({
      id: 'creport-aaa-1',
      comment_id: 'comment-uuid-aaa',
      created_at: '2026-09-10T09:00:00.000Z',
    });
    mock_supabase_holder.client = make_supabase_mock({
      comment_reports: { data: [row_bbb, row_aaa], error: null },
    });

    const { result } = await renderHook(() => useAdminReports());
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    const comment_items = items.filter((i): i is LocalCommentQueueItem => i.kind === 'comment');

    expect(comment_items).toHaveLength(2);
    expect(comment_items[0]?.comment_id).toBe('comment-uuid-bbb');
    expect(comment_items[1]?.comment_id).toBe('comment-uuid-aaa');
  });

  it('(EC-3) el item comment expone id del reporte MÁS RECIENTE, nunca comment_id', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      comment_reports: {
        data: [make_raw_comment_report_row({ id: 'REPORT-ID-DISTINTO', comment_id: 'COMMENT-ID-DISTINTO' })],
        error: null,
      },
    });

    const { result } = await renderHook(() => useAdminReports());
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    const item = items.find((i): i is LocalCommentQueueItem => i.kind === 'comment')!;

    expect(item.id).toBe('REPORT-ID-DISTINTO');
    expect(item.comment_id).toBe('COMMENT-ID-DISTINTO');
    expect(item.id).not.toBe(item.comment_id);
  });

  it('(EC-4) property_title sale del address de la propiedad embebida', async () => {
    const { result } = await renderHook(() => useAdminReports());
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    const item = items.find((i): i is LocalCommentQueueItem => i.kind === 'comment')!;

    expect(item.property_title).toBe('Calle Reforma 45, Guadalajara');
    expect(item.property_id).toBe('property-uuid-9');
  });
});

// ---------------------------------------------------------------------------
// Query exacta — comment_reports
// ---------------------------------------------------------------------------

describe('useAdminReports — construcción exacta de la query comment_reports', () => {
  it('(EC-5) .eq(status,new) explícito y .order(created_at, desc) en comment_reports', async () => {
    await renderHook(() => useAdminReports());
    const calls = mock_supabase_holder.client._calls;

    expect(calls.from).toContain('comment_reports');
    expect(calls.comment_reports.eq).toHaveLength(1);
    expect(calls.comment_reports.eq[0]?.[0]).toBe('status');
    expect(calls.comment_reports.eq[0]?.[1]).toBe('new');
    expect(calls.comment_reports.order).toHaveLength(1);
    expect(calls.comment_reports.order[0]?.[0]).toBe('created_at');
    expect(calls.comment_reports.order[0]?.[1]).toEqual({ ascending: false });
  });

  it('(EC-6) el select de comment_reports incluye columnas propias + embed anidado a comments y properties', async () => {
    await renderHook(() => useAdminReports());
    const calls = mock_supabase_holder.client._calls;
    const select_arg = calls.comment_reports.select[0] ?? '';

    for (const col of ['comment_id', 'reason_text', 'created_at']) {
      expect(select_arg).toContain(col);
    }
    expect(select_arg).toContain('comments');
    for (const col of ['body', 'status', 'user_id', 'property_id']) {
      expect(select_arg).toContain(col);
    }
    expect(select_arg).toContain('properties');
    expect(select_arg).toContain('address');
  });
});

// ---------------------------------------------------------------------------
// Identidad — agent_public_profiles
// ---------------------------------------------------------------------------

describe('useAdminReports — identidad del autor vía agent_public_profiles', () => {
  it('(EC-7) se consulta agent_public_profiles con .in(user_id, [...]) batcheando los distintos', async () => {
    const row_1 = make_raw_comment_report_row({ id: 'r1', comment_id: 'c1' });
    const row_2 = make_raw_comment_report_row({
      id: 'r2',
      comment_id: 'c2',
      comment: {
        id: 'c2',
        body: 'Otro',
        status: 'hidden',
        user_id: 'user-uuid-OTHER',
        property_id: 'property-uuid-9',
        property: { id: 'property-uuid-9', address: 'Calle Reforma 45, Guadalajara' },
      },
    });
    mock_supabase_holder.client = make_supabase_mock({
      comment_reports: { data: [row_1, row_2], error: null },
    });

    await renderHook(() => useAdminReports());
    const calls = mock_supabase_holder.client._calls;

    expect(calls.from).toContain('agent_public_profiles');
    expect(calls.agent_public_profiles.in).toHaveLength(1);
    expect(calls.agent_public_profiles.in[0]?.[0]).toBe('user_id');
    const ids = calls.agent_public_profiles.in[0]?.[1] as string[];
    expect(new Set(ids)).toEqual(new Set(['user-uuid-9', 'user-uuid-OTHER']));
  });

  it('(EC-8) author_display_name usa el full_name de la vista cuando existe', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      agent_public_profiles: { data: [make_raw_profile_row({ full_name: 'Andrea Pérez' })], error: null },
    });

    const { result } = await renderHook(() => useAdminReports());
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    const item = items.find((i): i is LocalCommentQueueItem => i.kind === 'comment')!;

    expect(item.author_display_name).toBe('Andrea Pérez');
  });

  it('(EC-9) sin fila de perfil o full_name null cae a "Agente Urbea"', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      agent_public_profiles: { data: [], error: null },
    });

    const { result } = await renderHook(() => useAdminReports());
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    const item = items.find((i): i is LocalCommentQueueItem => i.kind === 'comment')!;

    expect(item.author_display_name).toBe('Agente Urbea');
  });

  it('(EC-10) sin comentarios reportados, la query a agent_public_profiles NUNCA se dispara', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      comment_reports: { data: [], error: null },
    });

    await renderHook(() => useAdminReports());
    const calls = mock_supabase_holder.client._calls;

    // La query a comment_reports SÍ debe dispararse siempre (es la que decide
    // si hay algo que resolver); solo la de agent_public_profiles se salta.
    expect(calls.from).toContain('comment_reports');
    expect(calls.from).not.toContain('agent_public_profiles');
  });
});

// ---------------------------------------------------------------------------
// Mezcla (merge) por fecha
// ---------------------------------------------------------------------------

describe('useAdminReports — merge de items property + comment por created_at desc', () => {
  it('(EC-11) los items se intercalan por fecha, sin agrupar todo un kind antes que el otro', async () => {
    const property_row_recent = make_raw_property_report_row({
      id: 'preport-recent',
      property_id: 'property-recent',
      created_at: '2026-09-10T15:00:00.000Z', // más reciente que ambos comment
      property: {
        id: 'property-recent',
        address: 'Propiedad reciente',
        operation_type: 'rent',
        property_type: 'departamento',
        price: 10000,
        status: 'suspended',
      },
    });
    const property_row_old = make_raw_property_report_row({
      id: 'preport-old',
      property_id: 'property-old',
      created_at: '2026-09-10T08:00:00.000Z', // más vieja que ambos comment
      property: {
        id: 'property-old',
        address: 'Propiedad vieja',
        operation_type: 'rent',
        property_type: 'departamento',
        price: 10000,
        status: 'suspended',
      },
    });
    const comment_row_mid_1 = make_raw_comment_report_row({
      id: 'creport-mid-1',
      comment_id: 'comment-mid-1',
      created_at: '2026-09-10T12:00:00.000Z',
    });
    const comment_row_mid_2 = make_raw_comment_report_row({
      id: 'creport-mid-2',
      comment_id: 'comment-mid-2',
      created_at: '2026-09-10T10:00:00.000Z',
    });

    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { data: [property_row_recent, property_row_old], error: null },
      comment_reports: { data: [comment_row_mid_1, comment_row_mid_2], error: null },
    });

    const { result } = await renderHook(() => useAdminReports());
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];

    // Orden esperado desc: property-recent (15h) > comment-mid-1 (12h) >
    // comment-mid-2 (10h) > property-old (8h). Si el hook agrupara "primero
    // todo property, luego todo comment" (sin intercalar), este orden fallaría.
    expect(items).toHaveLength(4);
    expect(items[0]?.kind).toBe('property');
    expect((items[0] as LocalPropertyQueueItem).property_id).toBe('property-recent');
    expect(items[1]?.kind).toBe('comment');
    expect((items[1] as LocalCommentQueueItem).comment_id).toBe('comment-mid-1');
    expect(items[2]?.kind).toBe('comment');
    expect((items[2] as LocalCommentQueueItem).comment_id).toBe('comment-mid-2');
    expect(items[3]?.kind).toBe('property');
    expect((items[3] as LocalPropertyQueueItem).property_id).toBe('property-old');
  });

  it('(EC-12) un item property conserva kind:"property" y sus campos vigentes intactos', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { data: [make_raw_property_report_row()], error: null },
      comment_reports: { data: [], error: null },
    });

    const { result } = await renderHook(() => useAdminReports());
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];

    expect(items).toHaveLength(1);
    const item = items[0] as LocalPropertyQueueItem;
    expect(item.kind).toBe('property');
    expect(item.property_id).toBe('property-uuid-aaa');
    expect(item.report_count).toBe(1);
    expect(item.property.address).toBe('Av. Chapultepec 123, Guadalajara');
  });
});

// ---------------------------------------------------------------------------
// Fail-soft cruzado (lección 269.5)
// ---------------------------------------------------------------------------

describe('useAdminReports — fail-soft cruzado entre las dos fuentes', () => {
  it('(EC-13) error en comment_reports no descarta los items property ya cargados', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { data: [make_raw_property_report_row()], error: null },
      comment_reports: { data: null, error: { message: 'boom' } },
    });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.error_message).not.toBeNull();
    expect(result.current.is_loading).toBe(false);
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    expect(items.some((i) => i.kind === 'property')).toBe(true);
    expect(items.some((i) => i.kind === 'comment')).toBe(false);
  });

  it('(EC-14) error en property_reports no descarta los items comment ya cargados', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { data: null, error: { message: 'boom' } },
      comment_reports: { data: [make_raw_comment_report_row()], error: null },
    });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.error_message).not.toBeNull();
    expect(result.current.is_loading).toBe(false);
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    expect(items.some((i) => i.kind === 'comment')).toBe(true);
    expect(items.some((i) => i.kind === 'property')).toBe(false);
  });

  it('(EC-15) ambas fuentes fallan: reports es arreglo vacío (nunca null), error_message seteado', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { data: null, error: { message: 'boom-property' } },
      comment_reports: { data: null, error: { message: 'boom-comment' } },
    });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.error_message).not.toBeNull();
    expect(result.current.reports).toEqual([]);
  });

  it('(EC-16) comment_reports rechaza la promesa (red caída): loading no se cuelga y property sigue', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      property_reports: { data: [make_raw_property_report_row()], error: null },
      comment_reports: () => Promise.reject(new Error('network down')),
    });

    const { result } = await renderHook(() => useAdminReports());

    expect(result.current.is_loading).toBe(false);
    expect(result.current.error_message).not.toBeNull();
    const items = (result.current.reports ?? []) as unknown as LocalQueueItem[];
    expect(items.some((i) => i.kind === 'property')).toBe(true);
    expect(items.some((i) => i.kind === 'comment')).toBe(false);
  });
});
