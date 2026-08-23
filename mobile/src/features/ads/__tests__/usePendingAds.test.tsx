/**
 * Tests fase RED — usePendingAds (cola de moderación del admin, tarea 208)
 * Archivo SUT: mobile/src/features/ads/hooks/usePendingAds.ts
 * Subtarea Taskmaster: 208.2
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — no se renegocia):
 *
 *   usePendingAds(): {
 *     ads: PendingAd[];
 *     loading: boolean;
 *     error: string | null;
 *     refetch: () => Promise<void>;
 *   }
 *
 *   PendingAd = { id, title, description, agency_id, creative_id, cta_type,
 *                 cta_value, starts_at, ends_at, created_at,
 *                 agencies: { name: string } | null }
 *
 * FLUJO — UNA sola consulta:
 *   supabase.from('ads')
 *     .select(<columnas + agencies(name)>)
 *     .eq('status', 'pending_review')
 *     .order('created_at', { ascending: true })
 *
 * 🔴 INVARIANTE CENTRAL — EL `.eq('status','pending_review')` NO ES OPCIONAL
 * NI REDUNDANTE CON RLS, Y AQUÍ EL RIESGO ES MAYOR QUE EN useMyAds. La policy
 * `ads_select` (20260816000005_ads_schema.sql:205-210) es:
 *
 *   private.agency_role_of(agency_id) is not null
 *     or private.is_admin()          <-- 🔴 ESTA
 *     or (status = 'active' and now() between starts_at and ends_at)
 *
 * El caller de este hook es SIEMPRE un admin, así que la segunda cláusula
 * evalúa `true` para TODA fila de la tabla: un `select` sin el `.eq` de status
 * devuelve el inventario COMPLETO de la plataforma —anuncios activos, pausados,
 * expirados, rechazados y borradores de todas las organizaciones— y la "cola de
 * pendientes" mostraría anuncios que ya se moderaron. Peor: el admin podría
 * pulsar "aprobar" sobre un anuncio `expired` y comerse un 409 sin entender por
 * qué. En useMyAds (171.3) el mismo descuido filtraba a la competencia; aquí
 * filtra TODO. Precedente #155 (Guardados) y la nota
 * `flatlist_numcolumns_row_keys`: "mis X" siempre filtra explícito en el
 * cliente, aunque RLS "ya filtre".
 *
 * Por eso el mock del builder es TOLERANTE a la forma de la cadena pero
 * ESTRICTO en los argumentos reales de `.eq()`: una implementación que
 * devuelva exactamente los datos correctos porque el MOCK se los dio, pero sin
 * haber pedido el filtro, DEBE reprobar (EC-3/EC-4/EC-5).
 *
 * 🔴 ORDEN ASCENDENTE, no descendente. Una cola de moderación es FIFO: el
 * anuncio que lleva más tiempo esperando se atiende primero. Es la decisión
 * contraria a useMyAds (171.3), que ordena `descending` porque ahí el
 * anunciante quiere ver lo último que subió. Invertirlo aquí significa que un
 * anuncio que llegó temprano se hunde al fondo conforme entran otros y nunca
 * se modera — el anunciante paga por una vigencia que se le consume en la cola.
 *
 * FALLAR CERRADO (mismo criterio que useMyAds/useCanAdvertise/useAdMetrics):
 * cualquier error de la query ⇒ mensaje NEUTRO en español, NUNCA el texto crudo
 * de PostgREST/Postgres, `ads=[]`, sin lanzar. Incluye 42P01 (`relation "ads"
 * does not exist`): la épica 168-172 se mergea a main progresivamente y un OTA
 * en esa ventana pega contra un backend sin la tabla.
 *
 * `refetch` existe porque 208.3 la necesita: tras aprobar o rechazar, la cola
 * tiene que refrescarse sin desmontar la pantalla.
 *
 * PATRÓN DE MOCK: holder mutable + getter en '@/lib/supabase/client', calcado
 * literal de useMyAds.test.tsx (171.3) y useCanAdvertise.test.tsx (169.8).
 *
 * GOTCHAS RNTL ya pagados (memoria: rntl14_renderhook_async,
 * rntl_unmount_fuera_de_act): `renderHook` con `await`; `act()` async con
 * `await` — sin él `result` es undefined. PROHIBIDO
 * `expect(act(...)).resolves.not.toThrow()` (vacuo): "no lanza" se captura con
 * try/catch sobre una variable DENTRO del act.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) cola_con_anuncios_expone_las_columnas_completas_de_pendingad
 * - (EC-2) cola_vacia_deja_ads_en_arreglo_vacio_y_error_null
 *
 * ### 🔴 Invariante central — filtro explícito de status, RLS no es el filtro
 * - (EC-3) query_filtra_eq_status_pending_review
 * - (EC-4) query_no_debe_omitir_el_eq_de_status_confiando_en_is_admin
 * - (EC-5) query_no_filtra_por_agency_id_la_cola_es_cross_org
 *
 * ### 🔴 Orden FIFO
 * - (EC-6) query_ordena_por_created_at_ASCENDENTE_no_descendente
 *
 * ### Selección de columnas
 * - (EC-7) select_incluye_creative_id_para_poder_pedir_la_url_firmada
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
 * ### refetch (lo consume 208.3 tras moderar)
 * - (EC-16) refetch_vuelve_a_consultar_y_actualiza_la_lista
 * - (EC-17) refetch_limpia_un_error_previo_si_la_segunda_consulta_va_bien
 * - (EC-18) refetch_conserva_el_filtro_de_status_no_solo_la_primera_carga
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

import { usePendingAds, type PendingAd } from '../hooks/usePendingAds';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SAMPLE_PENDING: PendingAd = {
  id: 'ad-uuid-pendiente-1',
  title: 'Seguro de arrendamiento Zapopan',
  description: 'Protege tu renta con cobertura total.',
  agency_id: 'agencia-uuid-aseguradora',
  creative_id: 'creativo-uuid-1',
  cta_type: 'whatsapp',
  cta_value: '+523331234567',
  starts_at: '2026-09-01T00:00:00Z',
  ends_at: '2026-10-01T00:00:00Z',
  created_at: '2026-08-20T10:00:00Z',
  agencies: { name: 'Seguros del Valle' },
};

const SAMPLE_PENDING_2: PendingAd = {
  id: 'ad-uuid-pendiente-2',
  title: 'Mudanzas express GDL',
  description: null,
  agency_id: 'agencia-uuid-mudanzas',
  creative_id: 'creativo-uuid-2',
  cta_type: 'link',
  cta_value: 'https://mudanzas.example.mx',
  starts_at: '2026-09-05T00:00:00Z',
  ends_at: '2026-10-05T00:00:00Z',
  created_at: '2026-08-21T10:00:00Z',
  agencies: { name: 'Mudanzas Express' },
};

type AdsResult = { data: PendingAd[] | null; error: { code?: string; message: string } | null };
type RecordedCall = { method: string; args: unknown[] };

/**
 * Builder encadenable TOLERANTE A LA FORMA, ESTRICTO EN LOS ARGUMENTOS —
 * calcado de useMyAds.test.tsx. Cada método queda registrado en `calls` y
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

describe('usePendingAds — happy path', () => {
  it('EC-1 cola con anuncios expone las columnas completas de PendingAd', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING, SAMPLE_PENDING_2], error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
    await act(async () => {});

    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.ads).toHaveLength(2);
    expect(result.current.ads[0]).toEqual(SAMPLE_PENDING);
    expect(result.current.ads[1]).toEqual(SAMPLE_PENDING_2);
  });

  it('EC-2 cola vacía deja ads en arreglo vacío y error null', async () => {
    const mock = make_supabase_mock({ data: [], error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
    await act(async () => {});

    // Sin estas dos aserciones el caso pasaría TRIVIALMENTE contra un stub que
    // devuelve [] sin consultar nada — la lección de EC-15 del RED de 208.1.
    expect(mock.from).toHaveBeenCalledWith('ads');
    expect(find_eq(mock.calls, 'status')?.args).toEqual(['status', 'pending_review']);
    expect(result.current.ads).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Invariante central — el filtro de status es del cliente, no de RLS
// ---------------------------------------------------------------------------

describe('usePendingAds — 🔴 filtro explícito de status (RLS no filtra: el caller es admin)', () => {
  it('EC-3 la query filtra .eq("status", "pending_review")', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => usePendingAds());
    await act(async () => {});

    const eq_status = find_eq(mock.calls, 'status');
    expect(eq_status).toBeDefined();
    expect(eq_status?.args).toEqual(['status', 'pending_review']);
  });

  it('EC-4 la query NO puede omitir el .eq de status confiando en is_admin()', async () => {
    // El mock devuelve SOLO anuncios pendientes aunque no se filtre — si el hook
    // se apoyara en eso, `result.current.ads` se vería correcto y el bug pasaría
    // a producción, donde is_admin() devuelve la tabla ENTERA. Por eso la
    // aserción es sobre la CADENA capturada, nunca sobre los datos devueltos.
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING], error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
    await act(async () => {});

    expect(result.current.ads).toHaveLength(1);
    const eq_calls = mock.calls.filter((c) => c.method === 'eq');
    expect(eq_calls.length).toBeGreaterThan(0);
    expect(eq_calls.some((c) => c.args[0] === 'status' && c.args[1] === 'pending_review')).toBe(true);
  });

  it('EC-5 la cola es cross-org: NO filtra por agency_id', async () => {
    // Al revés que useMyAds (171.3). El admin modera anuncios de TODAS las
    // organizaciones; un .eq('agency_id', …) aquí vaciaría la cola.
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING, SAMPLE_PENDING_2], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => usePendingAds());
    await act(async () => {});

    // "No filtra por agency_id" solo significa algo si SÍ hubo consulta: un
    // stub que no llama a nada tampoco filtra por agency_id.
    expect(mock.from).toHaveBeenCalledWith('ads');
    expect(find_eq(mock.calls, 'status')).toBeDefined();
    expect(find_eq(mock.calls, 'agency_id')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 🔴 Orden FIFO
// ---------------------------------------------------------------------------

describe('usePendingAds — 🔴 orden FIFO de la cola', () => {
  it('EC-6 ordena por created_at ASCENDENTE (el que más ha esperado, primero)', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => usePendingAds());
    await act(async () => {});

    const order_call = mock.calls.find((c) => c.method === 'order');
    expect(order_call).toBeDefined();
    expect(order_call?.args[0]).toBe('created_at');
    expect(order_call?.args[1]).toEqual({ ascending: true });
  });
});

// ---------------------------------------------------------------------------
// Selección de columnas
// ---------------------------------------------------------------------------

describe('usePendingAds — columnas', () => {
  it('EC-7 el select incluye creative_id (208.3 lo necesita para la URL firmada)', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => usePendingAds());
    await act(async () => {});

    expect(select_arg(mock.calls)).toContain('creative_id');
  });

  it('EC-8 el select trae el nombre de la organización embebido', async () => {
    // Moderar sin saber QUIÉN lo subió es moderar a ciegas.
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => usePendingAds());
    await act(async () => {});

    expect(select_arg(mock.calls)).toContain('agencies');
    expect(select_arg(mock.calls)).toContain('name');
  });

  it('EC-9 el select NO pide asterisco', async () => {
    // select('*') es el gotcha de compatibilidad de §0.5: rompe en cuanto la
    // tabla gana una columna que el build instalado no espera.
    const mock = make_supabase_mock({ data: [SAMPLE_PENDING], error: null });
    mock_supabase_holder.client = mock.client;

    await renderHook(() => usePendingAds());
    await act(async () => {});

    expect(select_arg(mock.calls)).not.toBe('*');
    expect(select_arg(mock.calls).length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// 🔴 Fail-closed
// ---------------------------------------------------------------------------

describe('usePendingAds — 🔴 fallar cerrado', () => {
  it('EC-10 error genérico ⇒ mensaje neutro en español, ads vacío, sin lanzar', async () => {
    const mock = make_supabase_mock({
      data: null,
      error: { code: '42501', message: 'permission denied for table ads' },
    });
    mock_supabase_holder.client = mock.client;

    let threw: unknown = null;
    const { result } = await renderHook(() => usePendingAds());
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

    const { result } = await renderHook(() => usePendingAds());
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

    const { result } = await renderHook(() => usePendingAds());
    await act(async () => {});

    expect(result.current.error).not.toContain(raw);
    expect(result.current.error).not.toContain('JWT');
    expect(result.current.error).not.toContain('PGRST');
  });

  it('EC-13 data null sin error deja ads en arreglo vacío, no null', async () => {
    const mock = make_supabase_mock({ data: null, error: null });
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
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

describe('usePendingAds — carga', () => {
  it('EC-14 loading true mientras la query está pendiente', async () => {
    const mock = make_deferred_supabase_mock();
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());

    expect(result.current.loading).toBe(true);
    expect(result.current.ads).toEqual([]);

    await act(async () => {
      mock.resolve_ads({ data: [SAMPLE_PENDING], error: null });
    });

    expect(result.current.loading).toBe(false);
  });

  it('EC-15 loading pasa de true a false y deja la lista poblada', async () => {
    // Un stub que nunca carga nada también reporta loading=false: el caso solo
    // protege si asierta la TRANSICIÓN y el resultado, no el valor final.
    const mock = make_deferred_supabase_mock();
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
    expect(result.current.loading).toBe(true);

    await act(async () => {
      mock.resolve_ads({ data: [SAMPLE_PENDING], error: null });
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.ads).toHaveLength(1);
    expect(result.current.ads[0]?.id).toBe(SAMPLE_PENDING.id);
  });
});

// ---------------------------------------------------------------------------
// refetch — 208.3 la usa tras moderar
// ---------------------------------------------------------------------------

describe('usePendingAds — refetch', () => {
  it('EC-16 refetch vuelve a consultar y actualiza la lista', async () => {
    const mock = make_sequenced_supabase_mock([
      { data: [SAMPLE_PENDING, SAMPLE_PENDING_2], error: null },
      { data: [SAMPLE_PENDING_2], error: null },
    ]);
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
    await act(async () => {});

    expect(result.current.ads).toHaveLength(2);

    await act(async () => {
      await result.current.refetch();
    });

    expect(mock.from).toHaveBeenCalledTimes(2);
    expect(result.current.ads).toHaveLength(1);
    expect(result.current.ads[0]?.id).toBe(SAMPLE_PENDING_2.id);
  });

  it('EC-17 refetch limpia un error previo si la segunda consulta va bien', async () => {
    const mock = make_sequenced_supabase_mock([
      { data: null, error: { code: '42501', message: 'permission denied' } },
      { data: [SAMPLE_PENDING], error: null },
    ]);
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
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
      { data: [SAMPLE_PENDING], error: null },
      { data: [SAMPLE_PENDING], error: null },
    ]);
    mock_supabase_holder.client = mock.client;

    const { result } = await renderHook(() => usePendingAds());
    await act(async () => {});

    const eq_after_first = mock.calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'pending_review',
    ).length;

    await act(async () => {
      await result.current.refetch();
    });

    const eq_after_refetch = mock.calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'status' && c.args[1] === 'pending_review',
    ).length;

    expect(eq_after_first).toBe(1);
    expect(eq_after_refetch).toBe(2);
  });
});
