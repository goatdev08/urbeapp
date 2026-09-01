/**
 * Tests fase RED — useMyAds hook (panel del anunciante, tarea 171)
 * Archivo SUT: mobile/src/features/ads/hooks/useMyAds.ts
 * Subtarea Taskmaster: 171.3
 *
 * SEAM BAJO TEST (firma pública, fijada por el orquestador — no se
 * renegocia; mismo patrón de dos consultas en serie que
 * mobile/src/features/ads/hooks/useCanAdvertise.ts, subtarea 169.8):
 *
 *   useMyAds(): {
 *     ads: MyAd[];
 *     agency_id: string | null;
 *     loading: boolean;
 *     error: string | null;
 *   }
 *
 *   MyAd = { id, title, status, starts_at, ends_at, paused_at,
 *            paused_by_suspension, rejection_reason }
 *
 * FLUJO, dos pasos en serie:
 *   1. fetch_own_membership(user.id) de '@/features/agency/api' — resuelve
 *      { agency_id, member_role } | null. Sin sesión o sin membresía activa
 *      ⇒ agency_id=null, ads=[], loading=false, error=null, y la query 2
 *      NUNCA se dispara (fail-fast, EC-8/EC-9).
 *   2. supabase.from('ads').select(<columnas>).eq('agency_id', agency_id)
 *      .order('created_at', { ascending: false }).
 *
 * 🔴 INVARIANTE CENTRAL — RLS NO ES EL FILTRO AQUÍ (guardián, precedente
 * #155 Guardados + la nota flatlist_numcolumns_row_keys de la memoria: "mis
 * X" siempre filtra .eq(user_id/agency_id) aunque RLS "ya filtre"). La
 * policy `ads_select` (supabase/migrations/20260816000005_ads_schema.sql:
 * 205-210) es:
 *
 *   private.agency_role_of(agency_id) is not null
 *     or private.is_admin()
 *     or (status = 'active' and now() between starts_at and ends_at)
 *
 * La tercera cláusula existe A PROPÓSITO para que el feed vea inventario
 * cross-org. Consecuencia: un `select` a `ads` SIN `.eq('agency_id', …)`
 * devuelve TODOS los anuncios activos de la PLATAFORMA — los de la
 * competencia incluidos — y un anunciante vería métricas/vigencias que no
 * son suyas. El mock del builder es TOLERANTE a la forma de la cadena pero
 * ESTRICTO en los argumentos reales de `.eq()` (EC-10/EC-11/EC-12):
 * un `.select().order()` sin `.eq('agency_id', …)` de por medio, confiando
 * en que "RLS ya filtra", debe reprobar estos tests aunque el MOCK devuelva
 * exactamente los datos que se le pida — por eso se asierta sobre la
 * cadena capturada, nunca solo sobre `result.current.ads`.
 *
 * FALLAR CERRADO ante backend sin schema (mismo criterio que useCanAdvertise
 * y useAdMetrics): 168-172 se mergea a main progresivamente sin desplegar el
 * schema completo — un OTA urgente en esa ventana pega contra un backend sin
 * la tabla `ads`. Error de la query 2 (incluido 42P01 relation "ads" does
 * not exist) ⇒ mensaje NEUTRO en español, nunca el texto crudo de
 * PostgREST/Postgres, `ads=[]`, sin lanzar (EC-13/EC-14/EC-15).
 *
 * `agency_id` se expone AUNQUE la lista venga vacía o falle — 171.3 se lo
 * pasa a useAdMetrics, que hace su propia consulta (EC-16/EC-17). Un
 * anunciante sin anuncios todavía SÍ tiene agencia. Si la membresía no
 * resolvió, ahí sí `agency_id=null` (EC-8/EC-9).
 *
 * PATRÓN DE MOCK: holder mutable `mock_supabase_holder` con getter en
 * `@/lib/supabase/client` (idéntico a useCanAdvertise.test.tsx) + mock de
 * `@/features/auth/context` + mock de `fetch_own_membership` de
 * `@/features/agency/api` (jest.mock del módulo completo). Builder
 * encadenable TOLERANTE a la forma, ESTRICTO en los argumentos —
 * `make_chainable_query` calcado literal de useCanAdvertise.test.tsx.
 *
 * GOTCHAS RNTL ya pagados: `renderHook` con `await` + `act()` async con
 * `await`; sin `await` el `result` es `undefined`. `unmount()` dentro de
 * `act()` con fake timers. PROHIBIDO
 * `expect(act(...)).resolves.not.toThrow()` (vacuo) — el caso "no lanza" se
 * captura con try/catch sobre una variable dentro del `act`.
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Happy path
 * - (EC-1) owner_con_anuncios_lista_las_columnas_completas_de_myad
 * - (EC-2) admin_tambien_puede_listar_sus_anuncios
 *
 * ### 🔴 Invariante central — filtro explícito de agency_id, RLS no es el filtro
 * - (EC-3) query_de_ads_filtra_eq_agency_id_con_el_id_resuelto_por_la_membresia
 * - (EC-4) query_de_ads_usa_el_agency_id_resuelto_no_uno_fijo_en_el_hook
 * - (EC-5) query_de_ads_no_debe_omitir_el_eq_de_agency_id_confiando_en_rls
 *
 * ### Orden
 * - (EC-6) query_de_ads_ordena_por_created_at_descendente
 *
 * ### Fail-fast — la 2ª consulta nunca se dispara
 * - (EC-7) sin_sesion_falla_cerrado_sin_disparar_ninguna_query
 * - (EC-8) fetch_own_membership_null_ads_vacio_agency_id_null_sin_consultar_ads
 * - (EC-9) fetch_own_membership_llamado_con_el_user_id_real_del_caller
 *
 * ### 🔴 Fail-closed ante backend sin schema desplegado (168-172 en OTA)
 * - (EC-13) error_generico_de_la_query_de_ads_mensaje_neutro_ads_vacio
 * - (EC-14) relacion_ads_no_existe_42P01_mensaje_neutro_sin_lanzar
 * - (EC-15) error_no_deja_texto_crudo_de_postgrest_en_error
 *
 * ### agency_id se expone en camino vacío/fallido, no solo en el feliz
 * - (EC-16) agencia_real_sin_anuncios_ads_vacio_error_null_agency_id_poblado
 * - (EC-17) query_de_ads_falla_pero_agency_id_sigue_poblado_para_useAdMetrics
 *
 * ### Boundary / estado de carga
 * - (EC-10) loading_true_mientras_la_membresia_esta_pendiente
 * - (EC-11) loading_true_mientras_la_query_de_ads_esta_pendiente
 * - (EC-12) loading_false_de_inmediato_en_el_camino_sin_sesion
 *
 * ### Race (reforzada tras el FAIL del guardián de 171.3)
 * - (EC-18) cambio_de_user_id_limpia_los_anuncios_del_usuario_anterior_mientras_resuelve
 * - (EC-19) respuesta_tardia_de_ads_del_usuario_anterior_no_pisa_la_sesion_nueva
 *
 * ### Defensa contra data=null sin error
 * - (EC-20) data_null_sin_error_deja_ads_en_arreglo_vacio_no_null
 */

import { renderHook, act } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Mocks — ANTES de cualquier import del SUT.
// ---------------------------------------------------------------------------

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

jest.mock('@/features/agency/api', () => ({
  fetch_own_membership: jest.fn(),
}));

const mock_supabase_holder: { client: ReturnType<typeof make_supabase_mock> } = {
  client: null as never,
};

jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase_holder.client;
  },
}));

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar los mocks
// ---------------------------------------------------------------------------

import { useAuth } from '@/features/auth/context';
import { fetch_own_membership } from '@/features/agency/api';
import { useMyAds, type MyAd } from '../hooks/useMyAds';

const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;
const mock_fetch_own_membership = fetch_own_membership as jest.MockedFunction<
  typeof fetch_own_membership
>;

// ---------------------------------------------------------------------------
// Constantes de test
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'usuario-uuid-my-ads-171-3';
const TEST_AGENCY_ID = 'agencia-uuid-171-3-anunciante';

const SAMPLE_AD: MyAd = {
  id: 'ad-uuid-1',
  title: 'Departamento en venta Providencia',
  status: 'active',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-09-01T00:00:00Z',
  paused_at: null,
  paused_by_suspension: false,
  rejection_reason: null,
  property_id: null,
};

const SAMPLE_AD_2: MyAd = {
  id: 'ad-uuid-2',
  title: 'Casa en renta Zapopan',
  status: 'rejected',
  starts_at: '2026-07-01T00:00:00Z',
  ends_at: '2026-08-01T00:00:00Z',
  paused_at: null,
  paused_by_suspension: false,
  rejection_reason: 'creativo con texto ilegible',
  property_id: null,
};

type AdsResult = { data: MyAd[] | null; error: { code?: string; message: string } | null };

/** Una llamada encadenable capturada: { method: 'eq', args: ['agency_id', uid] }, etc. */
type RecordedCall = { method: string; args: unknown[] };

/**
 * Builder encadenable TOLERANTE A LA FORMA de la cadena, ESTRICTO en los
 * ARGUMENTOS — calcado literal de useCanAdvertise.test.tsx (guardián,
 * precedente #155 Guardados). `order()`/`eq()`/`select()` quedan registrados
 * en `calls` y devuelven el MISMO proxy; awaiting el proxy directamente
 * resuelve la promesa inyectada (thenable), como hace supabase-js cuando la
 * query termina en `.order()` sin `.maybeSingle()`.
 */
function make_chainable_query(result: AdsResult, calls: RecordedCall[]) {
  const resolved_promise = Promise.resolve(result);
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') {
          return resolved_promise.then.bind(resolved_promise);
        }
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
          return proxy;
        };
      },
    },
  );
  return proxy;
}

/**
 * Variante DIFERIDA del builder: la consulta a `ads` queda pendiente hasta
 * que se llame `resolve_ads(...)` a mano. Es lo que permite construir la
 * carrera REAL de EC-19 (respuesta tardía del usuario anterior) — con
 * `make_chainable_query` la promesa ya viene resuelta y nunca hay nada en
 * vuelo que descartar. Hallazgo del guardián de 171.3: sin esto, el flag
 * `ignore` del hook era removible con la suite entera en verde.
 */
function make_deferred_supabase_mock() {
  const ads_calls: RecordedCall[] = [];
  let resolve_ads!: (result: AdsResult) => void;
  const pending = new Promise<AdsResult>((res) => {
    resolve_ads = res;
  });
  const proxy: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return pending.then.bind(pending);
        return (...args: unknown[]) => {
          calls_push(ads_calls, prop, args);
          return proxy;
        };
      },
    },
  );
  const from = jest.fn((table: string) => {
    if (table === 'ads') return proxy;
    throw new Error(`tabla no mockeada en el test: ${table}`);
  });
  return { client: { from, _ads: { calls: ads_calls } }, resolve_ads };
}

function calls_push(calls: RecordedCall[], method: string, args: unknown[]): void {
  calls.push({ method, args });
}

function find_call(calls: RecordedCall[], method: string): RecordedCall | undefined {
  return calls.find((c) => c.method === method);
}

/**
 * Mock de `supabase.from('ads')` — pendiente hasta que `resolve_ads` se
 * invoque; permite construir el caso de carrera (EC-18) sin timers falsos.
 */
function make_supabase_mock(ads_result: AdsResult = { data: [], error: null }) {
  const ads_calls: RecordedCall[] = [];
  const ads_builder = make_chainable_query(ads_result, ads_calls);

  const from = jest.fn((table: string) => {
    if (table === 'ads') return ads_builder;
    throw new Error(`tabla no mockeada en el test: ${table}`);
  });

  return { from, _ads: { calls: ads_calls } };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function set_auth_user(user_id: string | null): void {
  mock_use_auth.mockReturnValue({
    user: user_id ? ({ id: user_id } as any) : null,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  } as any);
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_supabase_holder.client = make_supabase_mock();
  set_auth_user(TEST_USER_ID);
  mock_fetch_own_membership.mockResolvedValue({
    agency_id: TEST_AGENCY_ID,
    member_role: 'owner',
  } as any);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useMyAds', () => {
  // ── Happy path ────────────────────────────────────────────────────────

  it('(EC-1) owner_con_anuncios_lista_las_columnas_completas_de_myad: owner con 2 anuncios → ads trae exactamente las 8 columnas del contrato MyAd, agency_id poblado, loading=false, error=null', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: [SAMPLE_AD, SAMPLE_AD_2],
      error: null,
    });

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([SAMPLE_AD, SAMPLE_AD_2]);
    expect(result.current.agency_id).toBe(TEST_AGENCY_ID);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    // La PROYECCIÓN pedida, no solo la forma de lo devuelto (obs. del
    // guardián de 171.3: el mock devuelve lo que se le inyecte, así que sin
    // esto un `select('*')` pasaba la suite). Importa porque `ads` tiene
    // columnas que esta pantalla no necesita (purchase_id, created_by_user_id,
    // creative_id, cta_value…): pedir de más es tráfico y superficie extra
    // sobre datos comerciales.
    const select_call = find_call(mock_supabase_holder.client._ads.calls, 'select');
    const projection = String(select_call?.args[0] ?? '');
    expect(projection).not.toBe('*');
    for (const column of [
      'id',
      'title',
      'status',
      'starts_at',
      'ends_at',
      'paused_at',
      'paused_by_suspension',
      'rejection_reason',
    ]) {
      expect(projection).toContain(column);
    }
  });

  it('(EC-2) admin_tambien_puede_listar_sus_anuncios: member_role=admin (no solo owner) → misma lista, mismo agency_id', async () => {
    mock_fetch_own_membership.mockResolvedValue({
      agency_id: TEST_AGENCY_ID,
      member_role: 'admin',
    } as any);
    mock_supabase_holder.client = make_supabase_mock({ data: [SAMPLE_AD], error: null });

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([SAMPLE_AD]);
    expect(result.current.agency_id).toBe(TEST_AGENCY_ID);
  });

  // ── 🔴 Invariante central — filtro explícito, RLS no es el filtro ──────

  it('(EC-3) query_de_ads_filtra_eq_agency_id_con_el_id_resuelto_por_la_membresia: la query a ads incluye .eq("agency_id", <agency_id resuelto>) — sin este filtro, ads_select (20260816000005:205-210) devolvería TAMBIÉN el inventario activo de la competencia vía su tercera cláusula', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_AD], error: null });
    mock_supabase_holder.client = mock;

    await renderHook(() => useMyAds());

    const agency_eq_call = find_call(mock._ads.calls, 'eq');
    expect(agency_eq_call?.args).toEqual(['agency_id', TEST_AGENCY_ID]);
  });

  it('(EC-4) query_de_ads_usa_el_agency_id_resuelto_no_uno_fijo_en_el_hook: la membresía resuelve un agency_id DISTINTO del habitual → la query filtra .eq("agency_id", <ese id>), no un literal fijo', async () => {
    const OTHER_AGENCY_ID = 'agencia-uuid-DISTINTA-171-3-scoping';
    mock_fetch_own_membership.mockResolvedValue({
      agency_id: OTHER_AGENCY_ID,
      member_role: 'owner',
    } as any);
    const mock = make_supabase_mock({ data: [], error: null });
    mock_supabase_holder.client = mock;

    await renderHook(() => useMyAds());

    const agency_eq_call = mock._ads.calls.find(
      (c) => c.method === 'eq' && c.args[0] === 'agency_id',
    );
    expect(agency_eq_call?.args).toEqual(['agency_id', OTHER_AGENCY_ID]);
  });

  it('(EC-5) query_de_ads_no_debe_omitir_el_eq_de_agency_id_confiando_en_rls: debe existir AL MENOS una llamada .eq() con "agency_id" como primer argumento — el mock devolvería datos aunque el hook confiara solo en RLS, así que la única forma de reprobar esto es no llamar a .eq("agency_id", …), que es justo el bug del precedente #155/mis-X', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_AD], error: null });
    mock_supabase_holder.client = mock;

    await renderHook(() => useMyAds());

    const agency_id_calls = mock._ads.calls.filter(
      (c) => c.method === 'eq' && c.args[0] === 'agency_id',
    );
    expect(agency_id_calls.length).toBeGreaterThanOrEqual(1);
  });

  // ── Orden ────────────────────────────────────────────────────────────

  it('(EC-6) query_de_ads_ordena_por_created_at_descendente: la query incluye .order("created_at", { ascending: false }) — el anuncio más reciente arriba', async () => {
    const mock = make_supabase_mock({ data: [SAMPLE_AD], error: null });
    mock_supabase_holder.client = mock;

    await renderHook(() => useMyAds());

    const order_call = find_call(mock._ads.calls, 'order');
    expect(order_call?.args).toEqual(['created_at', { ascending: false }]);
  });

  // ── Fail-fast — la 2ª consulta nunca se dispara ────────────────────────

  it('(EC-7) sin_sesion_falla_cerrado_sin_disparar_ninguna_query: useAuth().user=null → ads=[], agency_id=null, loading=false, error=null, ni fetch_own_membership ni supabase.from se llaman', async () => {
    set_auth_user(null);
    const mock = make_supabase_mock();
    mock_supabase_holder.client = mock;

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([]);
    expect(result.current.agency_id).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mock_fetch_own_membership).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('(EC-8) fetch_own_membership_null_ads_vacio_agency_id_null_sin_consultar_ads: fetch_own_membership resuelve null (sin membresía activa) → ads=[], agency_id=null, error=null, supabase.from("ads") NUNCA se llama', async () => {
    mock_fetch_own_membership.mockResolvedValue(null);
    const mock = make_supabase_mock();
    mock_supabase_holder.client = mock;

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([]);
    expect(result.current.agency_id).toBeNull();
    expect(result.current.error).toBeNull();
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('(EC-9) fetch_own_membership_llamado_con_el_user_id_real_del_caller: useAuth() devuelve un usuario DISTINTO del habitual → fetch_own_membership se llama con ESE id, no un literal fijo en el hook', async () => {
    const OTHER_USER_ID = 'usuario-uuid-DISTINTO-171-3-scoping';
    set_auth_user(OTHER_USER_ID);

    await renderHook(() => useMyAds());

    expect(mock_fetch_own_membership).toHaveBeenCalledWith(OTHER_USER_ID);
  });

  // ── 🔴 Fail-closed ante backend sin schema desplegado ──────────────────

  it('(EC-13) error_generico_de_la_query_de_ads_mensaje_neutro_ads_vacio: la query a ads devuelve un error SIN code reconocido (red/timeout) → ads=[], error=mensaje NEUTRO en español, sin lanzar', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: null,
      error: { message: 'FetchError: network request failed' },
    });

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([]);
    expect(result.current.error).toEqual(expect.any(String));
    expect(result.current.error).not.toBeNull();
  });

  it('(EC-14) relacion_ads_no_existe_42P01_mensaje_neutro_sin_lanzar: error.code="42P01" (relation "ads" does not exist — 168-172 mergeado sin desplegar schema, OTA en esa ventana) → ads=[], error NEUTRO, loading=false, no lanza', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: null,
      error: { code: '42P01', message: 'relation "public.ads" does not exist' },
    });

    // 🔴 Corrección del RED (orquestador, 171.3): la primera versión hacía
    // `hook_result = result.current` DENTRO de un act() externo que envolvía
    // al propio renderHook. `result.current` es un objeto nuevo en cada
    // render, así que copiarlo ahí dentro congela un render anterior al
    // flush — el caso reprobaba contra código correcto (falso rojo). Se
    // guarda el `result` (el contenedor vivo) y se lee su `.current` DESPUÉS,
    // idéntico a useAdMetrics.test.tsx EC-15.
    let thrown: unknown = null;
    let render_result: Awaited<ReturnType<typeof renderHook<ReturnType<typeof useMyAds>, never>>> | undefined;
    try {
      render_result = await renderHook(() => useMyAds());
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeNull();
    expect(render_result?.result.current.ads).toEqual([]);
    expect(render_result?.result.current.error).not.toBeNull();
    expect(render_result?.result.current.loading).toBe(false);
  });

  it('(EC-15) error_no_deja_texto_crudo_de_postgrest_en_error: el mensaje expuesto NUNCA contiene el texto crudo de Postgres/PostgREST (p.ej. "relation" o "does not exist")', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: null,
      error: { code: '42P01', message: 'relation "public.ads" does not exist' },
    });

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.error).not.toBeNull();
    expect(result.current.error).not.toContain('relation');
    expect(result.current.error).not.toContain('does not exist');
  });

  // ── agency_id se expone en camino vacío/fallido ────────────────────────

  it('(EC-16) agencia_real_sin_anuncios_ads_vacio_error_null_agency_id_poblado: agencia real, la query a ads resuelve data=[] SIN error → ads=[], error=null, agency_id SIGUE poblado (distinguible de un error, que también deja ads=[] pero CON mensaje)', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: [], error: null });

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.agency_id).toBe(TEST_AGENCY_ID);
  });

  it('(EC-17) query_de_ads_falla_pero_agency_id_sigue_poblado_para_useAdMetrics: la query a ads falla → agency_id SIGUE poblado (171.3 se lo pasa a useAdMetrics, que hace su propia consulta independiente)', async () => {
    mock_supabase_holder.client = make_supabase_mock({
      data: null,
      error: { code: '42P01', message: 'relation "public.ads" does not exist' },
    });

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.agency_id).toBe(TEST_AGENCY_ID);
    expect(result.current.error).not.toBeNull();
  });

  // ── Boundary / estado de carga ──────────────────────────────────────────

  it('(EC-10) loading_true_mientras_la_membresia_esta_pendiente: fetch_own_membership nunca resuelve → loading=true, ads=[], agency_id=null', async () => {
    mock_fetch_own_membership.mockReturnValue(new Promise<never>(() => {}));

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.loading).toBe(true);
    expect(result.current.ads).toEqual([]);
    expect(result.current.agency_id).toBeNull();
  });

  it('(EC-11) loading_true_mientras_la_query_de_ads_esta_pendiente: la membresía resuelve pero supabase.from("ads") nunca resuelve → loading sigue true', async () => {
    const ads_calls: RecordedCall[] = [];
    // 🔴 Corrección del RED (orquestador, 171.3): la primera versión devolvía
    // `undefined` para 'then' creyendo que así "nunca resuelve". Es al revés:
    // un objeto SIN `then` invocable no es un thenable, así que `await` lo
    // envuelve con PromiseResolve y resuelve EN EL ACTO. Con ese mock este
    // caso no podía observar loading=true contra NINGUNA implementación — era
    // un falso rojo. Lo pendiente de verdad es un thenable cuyo `then` nunca
    // llama a sus callbacks: `new Promise<never>(() => {})`, el mismo patrón
    // que useCanAdvertise.test.tsx EC-15/16 y useAdMetrics.test.tsx EC-18.
    const never_settles = new Promise<never>(() => {});
    const pending_proxy = new Proxy(
      {},
      {
        get(_t, prop: string) {
          if (prop === 'then') return never_settles.then.bind(never_settles);
          return (...args: unknown[]) => {
            ads_calls.push({ method: prop, args });
            return pending_proxy;
          };
        },
      },
    );
    mock_supabase_holder.client = {
      from: jest.fn((table: string) => {
        if (table === 'ads') return pending_proxy;
        throw new Error(`tabla no mockeada: ${table}`);
      }),
      _ads: { calls: ads_calls },
    };

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.loading).toBe(true);
  });

  it('(EC-12) loading_false_de_inmediato_en_el_camino_sin_sesion: sin sesión, loading termina en false sin esperar ningún ciclo adicional', async () => {
    set_auth_user(null);

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.loading).toBe(false);
  });

  // ── Race ────────────────────────────────────────────────────────────

  it('(EC-18) cambio_de_user_id_limpia_los_anuncios_del_usuario_anterior_mientras_resuelve: con los anuncios de A ya cargados, cambiar a un usuario B cuya membresía sigue pendiente NO puede dejar visibles los anuncios ni el agency_id de A — se limpian al arrancar la nueva resolución, no al terminarla', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: [SAMPLE_AD], error: null });

    const { result, rerender } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([SAMPLE_AD]);
    expect(result.current.loading).toBe(false);

    // Cambio de sesión a un usuario B — la membresía queda pendiente
    // indefinidamente; el efecto de limpieza del hook (`ignore`) debe
    // impedir que una resolución tardía de la consulta del usuario A
    // (que ya no debería estar en vuelo, pero si lo estuviera) sobrescriba
    // este nuevo ciclo.
    mock_fetch_own_membership.mockReturnValue(new Promise<never>(() => {}));
    set_auth_user('usuario-uuid-OTRO-171-3-transicion');

    await act(async () => {
      rerender(undefined);
    });

    expect(result.current.loading).toBe(true);
    // 🔴 Estas dos faltaban (violación del guardián de 171.3): sin ellas, un
    // reset PARCIAL — que solo prendiera `loading` sin limpiar `ads`/
    // `agency_id` — pasaba la suite dejando los anuncios de A visibles
    // durante toda la sesión de B.
    expect(result.current.ads).toEqual([]);
    expect(result.current.agency_id).toBeNull();
  });

  it('(EC-19) respuesta_tardia_de_ads_del_usuario_anterior_no_pisa_la_sesion_nueva: la consulta de ads de A sigue EN VUELO cuando la sesión cambia a B; cuando por fin responde, el flag `ignore` del cleanup debe descartarla — sin él, el anuncio de A aparece en la sesión de B (fuga cross-cuenta demostrada por el guardián de 171.3)', async () => {
    const { client, resolve_ads } = make_deferred_supabase_mock();
    mock_supabase_holder.client = client as never;

    const { result, rerender } = await renderHook(() => useMyAds());

    // La consulta de ads del usuario A está pendiente DE VERDAD: es lo que
    // EC-18 nunca construyó (ahí ya había resuelto antes del cambio).
    expect(result.current.loading).toBe(true);
    expect(result.current.ads).toEqual([]);

    // Cambio de sesión a B — su membresía nunca resuelve.
    mock_fetch_own_membership.mockReturnValue(new Promise<never>(() => {}));
    set_auth_user('usuario-uuid-B-171-3-carrera');

    await act(async () => {
      rerender(undefined);
    });

    // Y AHORA responde la consulta de A, tarde.
    await act(async () => {
      resolve_ads({ data: [SAMPLE_AD], error: null });
    });

    expect(result.current.ads).toEqual([]);
    expect(result.current.agency_id).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  // ── Defensa contra data=null sin error ───────────────────────────────

  it('(EC-20) data_null_sin_error_deja_ads_en_arreglo_vacio_no_null: PostgREST devuelve [] en éxito, pero si alguna vez llegara data=null sin error, `ads` NO puede quedar en null — la pantalla de 171.3 hace .map/.length sobre él y reventaría (obs. del guardián: el fallback `data ?? []` no tenía test)', async () => {
    mock_supabase_holder.client = make_supabase_mock({ data: null, error: null });

    const { result } = await renderHook(() => useMyAds());

    expect(result.current.ads).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.agency_id).toBe(TEST_AGENCY_ID);
    expect(result.current.loading).toBe(false);
  });
});
