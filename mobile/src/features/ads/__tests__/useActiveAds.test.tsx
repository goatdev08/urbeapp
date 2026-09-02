/**
 * Tests fase RED — useActiveAds (lista de anuncios ACTIVOS para el takedown de
 * emergencia del admin, tarea #210, subtarea 210.3)
 * Archivo SUT: mobile/src/features/ads/hooks/useActiveAds.ts
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — MISMO patrón que
 * usePendingAds (208.2), solo cambia el filtro/orden/columnas):
 *
 *   useActiveAds(): {
 *     ads: ActiveAd[];
 *     loading: boolean;
 *     error: string | null;
 *     refetch: () => Promise<void>;
 *   }
 *
 *   ActiveAd = { id, title, description, agency_id, starts_at, ends_at,
 *                paused_at: string | null, paused_by_suspension: boolean,
 *                agencies: { name: string } | null }
 *   (paused_at/paused_by_suspension: EXTENSIÓN 210.3, ver docblock de COLUMNAS)
 *
 * FLUJO — UNA sola consulta:
 *   supabase.from('ads')
 *     .select(<columnas + agencies(name)>)
 *     .in('status', ['active', 'paused'])
 *     .order('ends_at', { ascending: true })
 *
 * 🔴 EXTENSIÓN 210.3 (post-GREEN, decisión del orquestador): el contrato
 * ORIGINAL de este RED filtraba SOLO `status='active'`, y dejaba `resume`
 * (useModerateAd, EC-22) casi muerto — un anuncio pausado en una sesión
 * anterior desaparecía de la vista y no había forma de reanudarlo desde aquí.
 * El filtro pasa de `.eq('status','active')` a
 * `.in('status', ['active','paused'])`: la vista de takedown ahora incluye
 * TAMBIÉN los pausados, para poder reanudarlos. El orden sigue siendo
 * `ends_at` ascendente para ambos (un pausado también tiene fecha de fin —
 * D2 "pausar el reloj" no la mueve, solo congela `paused_at`).
 *
 * 🔴 INVARIANTE CENTRAL — EL `.in('status', [...])` NO ES OPCIONAL NI
 * REDUNDANTE CON RLS (mismo gotcha que usePendingAds, 208.2). La policy
 * `ads_select` (20260816000005_ads_schema.sql:205-210) es:
 *
 *   private.agency_role_of(agency_id) is not null
 *     or private.is_admin()          <-- 🔴 ESTA
 *     or (status = 'active' and now() between starts_at and ends_at)
 *
 * El caller de este hook es SIEMPRE un admin: la segunda cláusula evalúa
 * `true` para TODA fila de la tabla. Sin el `.in` explícito, la "vista de
 * takedown" traería el inventario COMPLETO de la plataforma —pendientes,
 * expirados, rechazados y borradores de todas las organizaciones—, y el
 * botón de takedown (pausar/bajar/reanudar) se ofrecería sobre anuncios que
 * ni siquiera están vigentes, chocando con el grafo de estados de la EF
 * `moderate-ad`. Precedente #155 (Guardados) y la nota
 * `flatlist_numcolumns_row_keys`.
 *
 * 🔴 ORDEN — `ends_at` ASCENDENTE, NO `created_at` como usePendingAds. La cola
 * de moderación es FIFO por antigüedad; la vista de activos es una lista de
 * emergencia: lo que expira ANTES importa más (un anuncio a punto de vencer ya
 * casi no necesita takedown; uno recién publicado con mucha vigencia por
 * delante es el que más urge poder pausar si resulta problemático). Ordenar
 * por lo que menos vigencia le queda primero.
 *
 * 🔴 COLUMNAS — decisión explícita contra lo que usePendingAds ya selecciona
 * (mismo archivo hermano, mantenerse consistente):
 *   - SÍ `description`: el admin necesita identificar el anuncio antes de un
 *     acto destructivo (bajarlo) sin tener que abrir el creativo.
 *   - SÍ `paused_by_suspension` (EXTENSIÓN 210.3, post-GREEN): ahora la lista
 *     SÍ incluye filas `status='paused'` — la vista necesita distinguir un
 *     pausado por el ADMIN (reanudable con un click) de uno pausado por la
 *     CASCADA de suspensión de organización (#211: `resume` sobre ese caso
 *     responde 409 `AD_PAUSED_BY_SUSPENSION`, ver useModerateAd EC-25) para
 *     deshabilitar el botón de reanudar y no ofrecer una acción que la EF va
 *     a rechazar.
 *   - SÍ `paused_at` (EXTENSIÓN 210.3): además de alimentar el badge
 *     "Pausado", es el discriminador barato de fila-pausada-vs-activa SIN
 *     duplicar `status` como columna — el trigger `handle_ad_status_change`
 *     SIEMPRE limpia `paused_at:=null` en `paused→active` (20260816000006) y
 *     SIEMPRE lo estampa en `active→paused`, así que
 *     `paused_at !== null ⟺ status === 'paused'` es una garantía de la base,
 *     no una convención del cliente.
 *   - NO `status`: sigue sin ser necesario (ver `paused_at` arriba) — traerlo
 *     sería una tercera fuente de la misma verdad.
 *   - NO `creative_id`/`cta_type`/`cta_value`: esta vista no reproduce el
 *     creativo (eso es la cola de moderación, 208.3); es la lista de
 *     emergencia para pausar/bajar/reanudar, no de revisión.
 *
 * FALLAR CERRADO (mismo criterio que usePendingAds/useMyAds/useAdMetrics):
 * cualquier error de la query ⇒ mensaje NEUTRO en español, NUNCA el texto
 * crudo de PostgREST/Postgres, `ads=[]`, sin lanzar — vacío real (cero
 * anuncios activos) y error (no se pudo cargar) son mensajes OPUESTOS, jamás
 * el mismo estado.
 *
 * `refetch` existe porque la pantalla de 210.3 la necesita: tras pausar o
 * bajar un anuncio, la lista tiene que refrescarse sin desmontar.
 *
 * PATRÓN DE MOCK: holder mutable + getter en '@/lib/supabase/client', calcado
 * literal de usePendingAds.test.tsx (208.2) y useMyAds.test.tsx (171.3).
 *
 * GOTCHAS RNTL ya pagados (memoria: rntl14_renderhook_async,
 * rntl_unmount_fuera_de_act): `renderHook` con `await`; `act()` async con
 * `await` — sin él `result` es undefined. PROHIBIDO
 * `expect(act(...)).resolves.not.toThrow()` (vacuo): "no lanza" se captura con
 * try/catch sobre una variable DENTRO del act.
 *
 * 🔴 EXTENSIÓN 210.3 sobre un GREEN YA vivo: `useActiveAds.ts` HOY implementa
 * el contrato ORIGINAL (`.eq('status','active')`, sin `paused_at`/
 * `paused_by_suspension` en el select). Los tests AJUSTADOS/NUEVOS de esta
 * extensión (EC-2..EC-5, EC-18..EC-21) fallan hoy por ASERCIÓN contra esa
 * implementación real (el `.in` esperado nunca se llama; las columnas nuevas
 * no están en el string de `.select`) — no por "module not found".
 *
 * EDGE CASES CUBIERTOS (EC-19..EC-21 son la EXTENSIÓN 210.3; EC-2/EC-3/EC-4/
 * EC-5/EC-18 se AJUSTARON de `.eq` a `.in` — mismo número, contrato ampliado):
 *
 * ### Happy path
 * - (EC-1) lista_con_activos_expone_las_columnas_completas_de_activead
 * - (EC-2) lista_vacia_deja_ads_en_arreglo_vacio_y_error_null [AJUSTADO: .in]
 *
 * ### 🔴 Invariante central — filtro explícito de status, RLS no es el filtro
 * - (EC-3) query_filtra_in_status_active_y_paused [AJUSTADO: antes .eq('status','active')]
 * - (EC-4) query_no_debe_omitir_el_in_de_status_confiando_en_is_admin [AJUSTADO]
 * - (EC-5) query_no_filtra_por_agency_id_la_vista_es_cross_org [AJUSTADO: usa find_in]
 *
 * ### 🔴 Orden — lo que expira antes, primero (distinto de usePendingAds)
 * - (EC-6) query_ordena_por_ends_at_ASCENDENTE_no_por_created_at_ni_descendente
 *
 * ### Selección de columnas
 * - (EC-7) select_incluye_description_para_identificar_el_anuncio_antes_de_un_acto_destructivo
 * - (EC-8) select_incluye_el_nombre_de_la_organizacion_embebido
 * - (EC-9) select_no_pide_asterisco
 *
 * ### 🔴 Fail-closed
 * - (EC-10) error_generico_mensaje_neutro_ads_vacio_sin_lanzar
 * - (EC-11) relacion_ads_no_existe_42P01_mensaje_neutro
 * - (EC-12) error_no_deja_texto_crudo_de_postgrest_en_error
 * - (EC-13) data_null_sin_error_deja_ads_en_arreglo_vacio_no_null
 *
 * ### Estado de carga
 * - (EC-14) loading_true_mientras_la_query_esta_pendiente
 * - (EC-15) loading_false_tras_resolver
 *
 * ### refetch (la pantalla lo llama tras pausar/bajar/reanudar un anuncio)
 * - (EC-16) refetch_vuelve_a_consultar_y_actualiza_la_lista
 * - (EC-17) refetch_limpia_un_error_previo_si_la_segunda_consulta_va_bien
 * - (EC-18) refetch_conserva_el_filtro_de_status_no_solo_la_primera_carga [AJUSTADO: usa find_in]
 *
 * ### 🔴 EXTENSIÓN 210.3 — la vista incluye pausados (para poder reanudarlos)
 * - (EC-19) query_pide_status_in_active_y_paused_en_una_sola_llamada_sin_dejar_un_eq_residual
 * - (EC-20) select_incluye_paused_by_suspension_y_paused_at
 * - (EC-21) filas_paused_llegan_con_paused_by_suspension_tipado_true_y_false_no_string_ni_undefined
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — ANTES de cualquier import del SUT.
// ---------------------------------------------------------------------------

const mock_supabase_holder: { client: unknown } = { client: null };

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar los mocks
// ---------------------------------------------------------------------------

import { useActiveAds, type ActiveAd } from '../hooks/useActiveAds';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_ACTIVE: ActiveAd = {
  id: 'ad-uuid-activo-1',
  title: 'Seguro de arrendamiento Zapopan',
  description: 'Protege tu renta con cobertura total.',
  agency_id: 'agencia-uuid-aseguradora',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-09-15T00:00:00Z',
  paused_at: null,
  paused_by_suspension: false,
  agencies: { name: 'Seguros del Valle' },
  property_id: null,
};

const SAMPLE_ACTIVE_2: ActiveAd = {
  id: 'ad-uuid-activo-2',
  title: 'Mudanzas express GDL',
  description: null,
  agency_id: 'agencia-uuid-mudanzas',
  starts_at: '2026-08-05T00:00:00Z',
  ends_at: '2026-08-30T00:00:00Z',
  paused_at: null,
  paused_by_suspension: false,
  agencies: { name: 'Mudanzas Express' },
  property_id: null,
};

/** Pausado por el ADMIN (click de takedown): reanudable, EC-21. */
const SAMPLE_PAUSED_BY_ADMIN: ActiveAd = {
  id: 'ad-uuid-pausado-admin',
  title: 'Renta vacacional Puerto Vallarta',
  description: 'Suspendido temporalmente por el admin.',
  agency_id: 'agencia-uuid-vacacional',
  starts_at: '2026-07-20T00:00:00Z',
  ends_at: '2026-09-01T00:00:00Z',
  paused_at: '2026-08-20T12:00:00Z',
  paused_by_suspension: false,
  agencies: { name: 'Vacacional del Pacífico' },
  property_id: null,
};

/** Pausado por la CASCADA de suspensión de organización (#211): resume debe deshabilitarse, EC-21. */
const SAMPLE_PAUSED_BY_SUSPENSION: ActiveAd = {
  id: 'ad-uuid-pausado-suspension',
  title: 'Créditos hipotecarios GDL',
  description: null,
  agency_id: 'agencia-uuid-suspendida',
  starts_at: '2026-07-01T00:00:00Z',
  ends_at: '2026-10-01T00:00:00Z',
  paused_at: '2026-08-21T09:00:00Z',
  paused_by_suspension: true,
  agencies: { name: 'Créditos del Bajío' },
  property_id: null,
};

type AdsResult = { data: ActiveAd[] | null; error: { code?: string; message: string } | null };
type RecordedCall = { method: string; args: unknown[] };

/**
 * Builder encadenable TOLERANTE A LA FORMA, ESTRICTO EN LOS ARGUMENTOS —
 * calcado de usePendingAds.test.tsx. Cada método queda registrado en `calls` y
 * devuelve el MISMO proxy; hacer `await` sobre el proxy resuelve la promesa
 * inyectada (thenable), igual que supabase-js cuando la cadena termina en
 * `.order()` sin `.maybeSingle()`.
 */
function make_chainable_query(result: AdsResult, calls: RecordedCall[]) {
  const resolved = Promise.resolve(result);
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return resolved.then.bind(resolved);
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

/** Mock de cliente con UNA respuesta fija para `ads`. */
function make_supabase_mock(result: AdsResult) {
  const calls: RecordedCall[] = [];
  const from = jest.fn((table: string) => {
    calls.push({ method: 'from', args: [table] });
    return make_chainable_query(result, calls);
  });
  return { client: { from }, calls, from };
}

/** Mock que devuelve una respuesta DISTINTA en cada llamada a `from('ads')`. */
function make_sequenced_supabase_mock(results: AdsResult[]) {
  const calls: RecordedCall[] = [];
  let index = 0;
  const from = jest.fn((table: string) => {
    calls.push({ method: 'from', args: [table] });
    const result = results[Math.min(index, results.length - 1)] as AdsResult;
    index += 1;
    return make_chainable_query(result, calls);
  });
  return { client: { from }, calls, from };
}

/** Mock cuya consulta queda PENDIENTE hasta que se llame `resolve_ads`. */
function make_deferred_supabase_mock() {
  const calls: RecordedCall[] = [];
  let resolve_ads!: (r: AdsResult) => void;
  const pending = new Promise<AdsResult>((res) => {
    resolve_ads = res;
  });
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === 'then') return pending.then.bind(pending);
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return proxy;
        };
      },
    },
  );
  const from = jest.fn((table: string) => {
    calls.push({ method: 'from', args: [table] });
    return proxy;
  });
  return { client: { from }, calls, from, resolve_ads };
}

/** Busca la llamada `.eq(col, value)` registrada, si existe. */
function find_eq(calls: RecordedCall[], column: string): RecordedCall | undefined {
  return calls.find((c) => c.method === 'eq' && c.args[0] === column);
}

/**
 * Busca la llamada `.in(col, values)` registrada, si existe (EXTENSIÓN 210.3:
 * el filtro de status pasó de `.eq` a `.in` para incluir 'paused').
 */
function find_in(calls: RecordedCall[], column: string): RecordedCall | undefined {
  return calls.find((c) => c.method === 'in' && c.args[0] === column);
}

/** Devuelve el string de columnas del `.select(...)`. */
function select_arg(calls: RecordedCall[]): string {
  const call = calls.find((c) => c.method === 'select');
  return typeof call?.args[0] === 'string' ? (call.args[0] as string) : '';
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = null;
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('useActiveAds — happy path', () => {
  it('EC-1 lista con activos expone las columnas completas de ActiveAd', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE, SAMPLE_ACTIVE_2], error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.ads).toHaveLength(2);
    expect(result.current.ads[0]).toEqual(SAMPLE_ACTIVE);
    expect(result.current.ads[1]).toEqual(SAMPLE_ACTIVE_2);
  });

  it('EC-2 lista vacía deja ads en arreglo vacío y error null', async () => {
    const mock = make_supabase_mock({ data: [], error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    // Sin estas dos aserciones el caso pasaría TRIVIALMENTE contra un stub que
    // devuelve [] sin consultar nada — la lección de EC-15 del RED de 208.1.
    expect(mock.from).toHaveBeenCalledWith('ads');
    expect(find_in(mock.calls, 'status')?.args).toEqual(['status', ['active', 'paused']]);
    expect(result.current.ads).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Invariante central — el filtro de status es del cliente, no de RLS
// ---------------------------------------------------------------------------

describe('useActiveAds — 🔴 filtro explícito de status (RLS no filtra: el caller es admin)', () => {
  it('EC-3 la query filtra .in("status", ["active", "paused"])', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    const in_status = find_in(mock.calls, 'status');
    expect(in_status).toBeDefined();
    expect(in_status?.args).toEqual(['status', ['active', 'paused']]);
  });

  it('EC-4 la query NO puede omitir el .in de status confiando en is_admin()', async () => {
    // El mock devuelve SOLO anuncios activos aunque no se filtre — si el hook
    // se apoyara en eso, `result.current.ads` se vería correcto y el bug pasaría
    // a producción, donde is_admin() devuelve la tabla ENTERA. Por eso la
    // aserción es sobre la CADENA capturada, nunca sobre los datos devueltos.
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(result.current.ads).toHaveLength(1);
    const in_calls = mock.calls.filter((c) => c.method === 'in');
    expect(in_calls.length).toBeGreaterThan(0);
    expect(
      in_calls.some(
        (c) =>
          c.args[0] === 'status' &&
          Array.isArray(c.args[1]) &&
          (c.args[1] as string[]).includes('active') &&
          (c.args[1] as string[]).includes('paused'),
      ),
    ).toBe(true);
  });

  it('EC-5 la vista es cross-org: NO filtra por agency_id', async () => {
    // El admin puede necesitar bajar el anuncio de CUALQUIER organización; un
    // .eq('agency_id', …) aquí la convertiría en "mis anuncios", no en el
    // panel de takedown del admin.
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE, SAMPLE_ACTIVE_2], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    // "No filtra por agency_id" solo significa algo si SÍ hubo consulta: un
    // stub que no llama a nada tampoco filtra por agency_id.
    expect(mock.from).toHaveBeenCalledWith('ads');
    expect(find_in(mock.calls, 'status')).toBeDefined();
    expect(find_eq(mock.calls, 'agency_id')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Orden — lo que expira antes, primero
// ---------------------------------------------------------------------------

describe('useActiveAds — 🔴 orden por vigencia (lo que expira antes, primero)', () => {
  it('EC-6 ordena por ends_at ASCENDENTE, no por created_at ni descendente', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    const order_call = mock.calls.find((c) => c.method === 'order');
    expect(order_call).toBeDefined();
    expect(order_call?.args[0]).toBe('ends_at');
    expect(order_call?.args[1]).toEqual({ ascending: true });
  });
});

// ---------------------------------------------------------------------------
// Selección de columnas
// ---------------------------------------------------------------------------

describe('useActiveAds — columnas', () => {
  it('EC-7 el select incluye description (identificar el anuncio antes de bajarlo)', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(select_arg(mock.calls)).toContain('description');
  });

  it('EC-8 el select trae el nombre de la organización embebido', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(select_arg(mock.calls)).toContain('agencies');
    expect(select_arg(mock.calls)).toContain('name');
  });

  it('EC-9 el select NO pide asterisco', async () => {
    // select('*') es el gotcha de compatibilidad de §0.5: rompe en cuanto la
    // tabla gana una columna que el build instalado no espera.
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(select_arg(mock.calls)).not.toBe('*');
    expect(select_arg(mock.calls).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Fail-closed
// ---------------------------------------------------------------------------

describe('useActiveAds — 🔴 fallar cerrado', () => {
  it('EC-10 error genérico ⇒ mensaje neutro en español, ads vacío, sin lanzar', async () => {
    const mock = make_supabase_mock({
      data: null,
      error: { code: '42501', message: 'permission denied for table ads' },
    });
    mock_supabase_holder.client = mock.client;

    let threw: unknown = null;
    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {
      try {
        await Promise.resolve();
      } catch (e) {
        threw = e;
      }
    });

    expect(threw).toBeNull();
    expect(result.current.ads).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(typeof result.current.error).toBe('string');
    expect((result.current.error ?? '').length).toBeGreaterThan(0);
  });

  it('EC-11 relation "ads" does not exist (42P01) ⇒ mensaje neutro', async () => {
    const mock = make_supabase_mock({
      data: null,
      error: { code: '42P01', message: 'relation "public.ads" does not exist' },
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(result.current.ads).toEqual([]);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).not.toContain('does not exist');
    expect(result.current.error).not.toContain('42P01');
  });

  it('EC-12 el error nunca deja texto crudo de PostgREST a la vista', async () => {
    const raw = 'JWT expired at 1755900000, current time is 1755900001';
    const mock = make_supabase_mock({ data: null, error: { code: 'PGRST301', message: raw } });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(result.current.error).not.toContain(raw);
    expect(result.current.error).not.toContain('JWT');
    expect(result.current.error).not.toContain('PGRST');
  });

  it('EC-13 data null sin error deja ads en arreglo vacío, no null', async () => {
    const mock = make_supabase_mock({ data: null, error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(mock.from).toHaveBeenCalledWith('ads');
    expect(result.current.ads).toEqual([]);
    expect(result.current.ads).not.toBeNull();
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Estado de carga
// ---------------------------------------------------------------------------

describe('useActiveAds — carga', () => {
  it('EC-14 loading true mientras la query está pendiente', async () => {
    const mock = make_deferred_supabase_mock();
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());

    expect(result.current.loading).toBe(true);
    expect(result.current.ads).toEqual([]);

    await act(async () => {
      mock.resolve_ads({ data: [SAMPLE_ACTIVE], error: null });
    });

    expect(result.current.loading).toBe(false);
  });

  it('EC-15 loading pasa de true a false y deja la lista poblada', async () => {
    // Un stub que nunca carga nada también reporta loading=false: el caso solo
    // protege si asierta la TRANSICIÓN y el resultado, no el valor final.
    const mock = make_deferred_supabase_mock();
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mock.resolve_ads({ data: [SAMPLE_ACTIVE], error: null });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.ads).toHaveLength(1);
    expect(result.current.ads[0]?.id).toBe(SAMPLE_ACTIVE.id);
  });
});

// ---------------------------------------------------------------------------
// refetch — la pantalla de 210.3 la usa tras pausar/bajar un anuncio
// ---------------------------------------------------------------------------

describe('useActiveAds — refetch', () => {
  it('EC-16 refetch vuelve a consultar y actualiza la lista', async () => {
    const mock = make_sequenced_supabase_mock([
      { data: [SAMPLE_ACTIVE, SAMPLE_ACTIVE_2], error: null },
      { data: [SAMPLE_ACTIVE_2], error: null },
    ]);
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(result.current.ads).toHaveLength(2);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mock.from).toHaveBeenCalledTimes(2);
    expect(result.current.ads).toHaveLength(1);
    expect(result.current.ads[0]?.id).toBe(SAMPLE_ACTIVE_2.id);
  });

  it('EC-17 refetch limpia un error previo si la segunda consulta va bien', async () => {
    const mock = make_sequenced_supabase_mock([
      { data: null, error: { code: '42501', message: 'permission denied' } },
      { data: [SAMPLE_ACTIVE], error: null },
    ]);
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(result.current.error).not.toBeNull();

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.error).toBeNull();
    expect(result.current.ads).toHaveLength(1);
  });

  it('EC-18 refetch conserva el filtro de status (no solo la primera carga)', async () => {
    const mock = make_sequenced_supabase_mock([
      { data: [SAMPLE_ACTIVE], error: null },
      { data: [SAMPLE_ACTIVE], error: null },
    ]);
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    const in_after_first = mock.calls.filter(
      (c) =>
        c.method === 'in' &&
        c.args[0] === 'status' &&
        Array.isArray(c.args[1]) &&
        (c.args[1] as string[]).includes('active') &&
        (c.args[1] as string[]).includes('paused'),
    ).length;

    await act(async () => {
      await result.current.refetch();
    });

    const in_after_refetch = mock.calls.filter(
      (c) =>
        c.method === 'in' &&
        c.args[0] === 'status' &&
        Array.isArray(c.args[1]) &&
        (c.args[1] as string[]).includes('active') &&
        (c.args[1] as string[]).includes('paused'),
    ).length;

    expect(in_after_first).toBe(1);
    expect(in_after_refetch).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 🔴 EXTENSIÓN 210.3 — la vista incluye pausados (para poder reanudarlos)
// ---------------------------------------------------------------------------

describe('useActiveAds — 🔴 EXTENSIÓN 210.3: pausados incluidos (resume los necesita)', () => {
  it('EC-19 pide status IN [active, paused] en UNA sola llamada, sin dejar un .eq residual', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    const in_calls = mock.calls.filter((c) => c.method === 'in' && c.args[0] === 'status');
    expect(in_calls).toHaveLength(1);
    expect(in_calls[0]?.args[1]).toEqual(['active', 'paused']);

    // Un refactor a medias podría dejar el .eq('status','active') VIEJO
    // conviviendo con el .in nuevo (encadenados, ambos aplican AND) — eso
    // volvería a excluir 'paused' aunque el .in exista. Sin .eq residual.
    expect(find_eq(mock.calls, 'status')).toBeUndefined();
  });

  it('EC-20 el select incluye paused_by_suspension y paused_at', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_ACTIVE], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(select_arg(mock.calls)).toContain('paused_by_suspension');
    expect(select_arg(mock.calls)).toContain('paused_at');
  });

  it('EC-21 filas paused llegan con paused_by_suspension tipado true/false, no string ni undefined', async () => {
    const mock = make_supabase_mock({
      data: [SAMPLE_ACTIVE, SAMPLE_PAUSED_BY_ADMIN, SAMPLE_PAUSED_BY_SUSPENSION],
      error: null,
    });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => useActiveAds());
    await act(async () => {});

    expect(result.current.ads).toHaveLength(3);

    const paused_by_admin = result.current.ads.find((a) => a.id === SAMPLE_PAUSED_BY_ADMIN.id);
    const paused_by_suspension = result.current.ads.find(
      (a) => a.id === SAMPLE_PAUSED_BY_SUSPENSION.id,
    );

    // Un stub que no propague el campo (o lo deje undefined) NO puede
    // distinguir "reanudable" de "bloqueado por la cascada de suspensión" —
    // exactamente lo que la vista necesita para deshabilitar el botón.
    expect(paused_by_admin?.paused_by_suspension).toBe(false);
    expect(paused_by_suspension?.paused_by_suspension).toBe(true);
    expect(paused_by_admin?.paused_at).toBe(SAMPLE_PAUSED_BY_ADMIN.paused_at);
    expect(paused_by_suspension?.paused_at).toBe(SAMPLE_PAUSED_BY_SUSPENSION.paused_at);

    // El anuncio activo (no pausado) conserva paused_at=null — el discriminador
    // barato de "¿está pausado?" sin duplicar `status` como columna.
    const active = result.current.ads.find((a) => a.id === SAMPLE_ACTIVE.id);
    expect(active?.paused_at).toBeNull();
    expect(active?.paused_by_suspension).toBe(false);
  });
});
