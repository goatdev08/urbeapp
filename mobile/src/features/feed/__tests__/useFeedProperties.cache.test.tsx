/**
 * RED — #296.5: useFeedProperties cache-first por tab (decisión I1,
 * exploración 050 + /tm-plan 296, orquestador 2026-09-14).
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts (SIN TOCAR — este
 * archivo solo prueba la integración; la lógica nueva la escribe GREEN)
 * Colaborador: mobile/src/features/feed/lib/feedTabCache.ts (296.5-A, USADO
 * REAL — NO mockeado — para que la integración sea observable; hoy sus
 * funciones lanzan `not_implemented`, así que TODO este archivo falla desde
 * `beforeEach` hasta que 296.5-A y la integración en el hook existan).
 *
 * SEAMS bajo test: la firma pública de `useFeedProperties` — `data`,
 * `isLoading`, `error`, `nextCursor`, `lapCount`, `loadInitial`, `loadMore`,
 * `refetch`, y los campos NUEVOS `restoredScrollIndex`/`noteScrollIndex` — y
 * el cableo hacia `fetch_feed_page` (mock de frontera, `../lib/feedSources`)
 * y `InteractionManager.runAfterInteractions` de `react-native` (mock de
 * frontera, ejecutado SÍNCRONO para poder observar el prefetch dentro del
 * mismo `act`).
 *
 * Reloj: `jest.useFakeTimers({ now: BASE_TIME, doNotFake: ['queueMicrotask',
 * 'setImmediate'] })` en TODOS los tests (memoria tests_bomba_de_fecha); el
 * avance se hace con `jest.setSystemTime` dentro de `act` — nunca se lee
 * `Date.now()` real.
 *
 * PATRÓN DE MOCK: mismo patrón que useFeedProperties.tabs.test.tsx/lap-wrap
 * — `@/lib/supabase/client` como `{}` (compose_feed_items cae en fail-soft
 * absoluto, todos los items son kind:'property', sin anuncios), `useLocation`
 * con coords fijas, `appSession` con session_id fijo.
 *
 * `render_feed` reproduce el patrón manual de useFeedProperties.tabs.test.tsx
 * (llamar loadInitial explícitamente tras cada rerender) — NO el efecto de
 * FeedScreen — para controlar milimétricamente cuándo dispara cada fetch.
 *
 * EDGE CASES (RED):
 * ### Cache-first: hit / miss básicos
 * (EC-CACHE-HOOK-1)  miss inicial: loadInitial dispara fetch_feed_page y dos
 *                     campos nuevos toman su valor de "sin restaurar":
 *                     restoredScrollIndex === null.
 * (EC-CACHE-HOOK-2)  hit desde estado poblado (round-trip para_ti→nuevos→
 *                     para_ti, 3 tabs con datos DISTINTOS en cada mock):
 *                     el regreso NO llama fetch_feed_page una 3ra vez y
 *                     `data`/`nextCursor` son los de la carga ORIGINAL, no
 *                     los de una fuga de datos de una llamada fantasma.
 * (EC-CACHE-HOOK-3)  el hit nunca enciende `isLoading`, ni siquiera de forma
 *                     SÍNCRONA justo al invocar loadInitial (antes del
 *                     primer await) — prueba que ni siquiera arranca el
 *                     fetch.
 * ### loadMore / lap sobre un tab restaurado
 * (EC-CACHE-HOOK-4)  loadMore sobre un tab restaurado (hit) continúa desde
 *                     el `nextCursor` RESTAURADO (valor exacto) y acumula
 *                     sobre los items restaurados, no sobre una página
 *                     fantasma.
 * (EC-CACHE-HOOK-5)  `lapCount` y las keys `lap` de los items se preservan
 *                     por tab a través de un round-trip (un tab distinto
 *                     entre medio SÍ resetea su propio lapCount — mecánica
 *                     #285.3 intacta).
 * ### refetch salta la caché
 * (EC-CACHE-HOOK-6)  refetch reescribe la entrada del tab con datos frescos;
 *                     un regreso posterior a ese tab (loadInitial normal) es
 *                     hit sobre los datos DEL refetch, no sobre los
 *                     originales ni sobre una fuga.
 * ### staleness (TTL), boundary exacto
 * (EC-CACHE-HOOK-7)  edad < TTL (FEED_CACHE_TTL_MS - 1 ms): el regreso sigue
 *                     siendo hit.
 * (EC-CACHE-HOOK-8)  edad > TTL (FEED_CACHE_TTL_MS + 1 ms): el regreso es
 *                     miss y refetchea.
 * ### aislamiento por usuario
 * (EC-CACHE-HOOK-9)  cambiar `user_id` en el MISMO tab es miss — nunca
 *                     expone datos cacheados de otro usuario.
 * ### prefetch en idle de vecinos
 * (EC-CACHE-HOOK-10) tras un loadInitial exitoso se prefetchea cada vecino
 *                     de `neighbor_tabs(tab)` que no tenga entrada válida,
 *                     con `fetch_feed_page(undefined, deps, with_tab(filters,
 *                     vecino), {tab: vecino, user_id})` exacto.
 * (EC-CACHE-HOOK-11) el prefetch NUNCA toca `data`/`isLoading`/`error` del
 *                     tab visible.
 * (EC-CACHE-HOOK-12) un vecino que YA tiene entrada válida (poblada como tab
 *                     principal en una navegación previa) NO se vuelve a
 *                     pedir por el prefetch.
 * (EC-CACHE-HOOK-13) el fallo de un vecino en el prefetch (fetch_feed_page
 *                     rechaza) se ignora en silencio: `error` del hook queda
 *                     `null`, `isLoading` en `false`.
 * (EC-CACHE-HOOK-14) al navegar a un vecino ya prefetcheado, el hit es
 *                     INSTANTÁNEO (sin fetch_feed_page adicional) y muestra
 *                     exactamente los items que trajo el prefetch.
 * ### scroll persistido por tab
 * (EC-CACHE-HOOK-15) noteScrollIndex guarda el índice en la entrada del tab
 *                     CARGADO (`loaded_tab_ref`), no en `feed_tab` (la prop):
 *                     llamado justo tras un rerender a otro tab pero ANTES
 *                     de su loadInitial (el dataset viejo sigue en `data`),
 *                     debe escribir en la entrada del tab ANTERIOR, no en la
 *                     del nuevo (que además ni existe todavía); un regreso
 *                     posterior expone `restoredScrollIndex` con ese valor
 *                     EXACTO.
 * (EC-CACHE-HOOK-16) tras un refetch, `restoredScrollIndex` vuelve a `null`
 *                     Y la entrada del tab queda con `scroll_index` 0 —
 *                     probado DESDE ESTADO POBLADO (un HIT previo con
 *                     `restoredScrollIndex` ya en un valor no-null; si no,
 *                     el caso es vacuo: `null` sería el estado inicial de
 *                     todos modos).
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedSources', () => ({
  fetch_feed_page: jest.fn(),
}));

jest.mock('../lib/appSession', () => ({
  get_app_session_id: () => 'sesion-cache-fija',
}));

const mock_use_location = jest
  .fn()
  .mockReturnValue({ coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// Sin `.rpc`: compose_feed_items degrada a fail-soft absoluto (170.4) — todos
// los ítems de este archivo son kind:'property', sin anuncios.
jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { InteractionManager } from 'react-native';

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetch_feed_page } from '../lib/feedSources';
import {
  FEED_CACHE_TTL_MS,
  feed_cache_key,
  get_feed_tab_entry,
  reset_feed_tab_cache,
} from '../lib/feedTabCache';
import { with_tab, type FeedTab } from '@/features/search/lib/feedSection';
import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import type { FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

const mock_fetch_feed_page = fetch_feed_page as jest.MockedFunction<typeof fetch_feed_page>;

const BASE_TIME = new Date('2026-09-14T12:00:00.000Z').getTime();

function make_feed_property(
  id: string,
  overrides: Partial<FeedPropertyWithUrl> = {},
): FeedPropertyWithUrl {
  return {
    id,
    price: 15000,
    operation_type: 'rent',
    property_type: 'departamento',
    currency: 'MXN',
    price_visible: true,
    address: 'Av. Chapultepec 100, Col. Juárez, CDMX',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'owner-uuid-cache-test',
    agent_name: null,
    agent_photo_url: null,
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_has_phone: false,
    video: {
      id: `video-${id}`,
      storage_path: `properties/${id}/video.mp4`,
      position: 0,
      thumbnail_url: null,
    },
    signed_url: `https://cdn.urbea.app/signed/${id}.mp4`,
    video_id: `video-${id}`,
    posterUrl: null,
    ...overrides,
  };
}

type FeedPropertyItem = Extract<FeedItem, { kind: 'property' }>;
const is_property = (it: FeedItem): it is FeedPropertyItem => it.kind === 'property';
const property_ids = (items: FeedItem[]): string[] =>
  items.filter(is_property).map((it) => it.property.id);

interface RenderProps {
  filters?: FilterState;
  tab: FeedTab;
  user_id: string | null;
}

async function render_feed(initial: RenderProps) {
  return renderHook(
    ({ filters, tab, user_id }: RenderProps) => useFeedProperties(filters, tab, user_id),
    { initialProps: initial },
  );
}

type FeedPage = { data: FeedPropertyWithUrl[]; nextCursor: string | null };

/**
 * Reemplazo de la cola FIFO GLOBAL de `mockResolvedValueOnce` — el prefetch
 * de vecinas (296.5) intercala llamadas a `fetch_feed_page` con las
 * "principales" del test, y una cola FIFO global sin filtrar deja que una
 * llamada de prefetch se coma la respuesta que un test había encolado para
 * su siguiente llamada real (ver diagnóstico EC-CACHE-HOOK-1/2/4/6/7/8/9,
 * bitácora 296.5). `respond_by_tab()` despacha por `ctx.tab` (4º argumento
 * de `fetch_feed_page`, el mismo seam que EC-TAB-1/3 ya usan para filtrar):
 * cada tab tiene su PROPIA cola FIFO, así que una llamada a 'nuevos' nunca
 * consume la respuesta programada para 'para_ti'.
 * `set(tab, pages)` REEMPLAZA la cola de ese tab (no acumula): si un test
 * programa una respuesta "FUGA" para probar que NINGUNA llamada debe
 * consumirla (hit), y luego programa la respuesta real de la SIGUIENTE
 * llamada esperada a ese mismo tab, la fuga no debe quedar estorbando en la
 * cola — se reemplaza entera.
 * Sin respuesta programada para un tab, la llamada resuelve `undefined`
 * (mismo fail-soft silencioso que el mock vacío de antes; EC-CACHE-HOOK-13
 * ejerce ese camino en su propio test con `mockRejectedValueOnce`, sin tocar
 * este helper).
 */
function respond_by_tab() {
  const queues = new Map<FeedTab, FeedPage[]>();
  mock_fetch_feed_page.mockImplementation((async (
    ...args: Parameters<typeof fetch_feed_page>
  ) => {
    const ctx = args[3];
    const queue = queues.get(ctx.tab);
    if (!queue || queue.length === 0) return undefined;
    return queue.shift();
  }) as unknown as typeof fetch_feed_page);

  return {
    set(tab: FeedTab, pages: FeedPage[]) {
      queues.set(tab, [...pages]);
    },
  };
}

/** Llamadas a `fetch_feed_page` cuyo `ctx.tab` es `tab` — ignora el prefetch de vecinas (mismo patrón que EC-TAB-1/3). */
function calls_for_tab(tab: FeedTab) {
  return mock_fetch_feed_page.mock.calls.filter((c) => (c[3] as { tab: FeedTab }).tab === tab);
}

beforeEach(() => {
  jest.useFakeTimers({ now: BASE_TIME, doNotFake: ['queueMicrotask', 'setImmediate'] });
  // resetAllMocks (no solo clearAllMocks): además de vaciar mock.calls,
  // QUITA cualquier `mockImplementation` que un test previo haya dejado en
  // `mock_fetch_feed_page` vía `respond_by_tab()` — sin esto, un test que NO
  // llama a `respond_by_tab()` heredaría la implementación (cerrada sobre un
  // Map ya vacío/irrelevante) del test anterior en vez del comportamiento
  // por-default de un `jest.fn()` recién creado.
  jest.resetAllMocks();
  mock_use_location.mockReturnValue({
    coords: { latitude: 20.6597, longitude: -103.3496 },
    status: 'granted',
  });
  // El prefetch en idle se agenda vía InteractionManager.runAfterInteractions.
  // Se ejecuta SÍNCRONO (llama el callback de inmediato) para poder
  // observarlo dentro del mismo `act` sin depender de que RN drene su cola
  // de interacciones bajo Jest — mismo patrón de spyOn que
  // useFeedActiveIndex.flush.test.tsx usa sobre AppState.addEventListener.
  jest.spyOn(InteractionManager, 'runAfterInteractions').mockImplementation(((
    task?: (() => unknown) | { run?: () => unknown; gen?: () => unknown },
  ) => {
    if (typeof task === 'function') void task();
    else if (task && typeof task.run === 'function') void task.run();
    else if (task && typeof task.gen === 'function') void task.gen();
    return {
      then: () => Promise.resolve(),
      done: () => undefined,
      cancel: () => undefined,
    };
  }) as unknown as typeof InteractionManager.runAfterInteractions);
  reset_feed_tab_cache();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useFeedProperties — cache-first por tab (#296.5)', () => {
  it('(EC-CACHE-HOOK-1) miss_inicial_dispara_fetch_y_restoredscrollindex_es_null', async () => {
    const feed = respond_by_tab();
    feed.set('para_ti', [{ data: [make_feed_property('miss-a')], nextCursor: null }]);
    const { result } = await render_feed({ tab: 'para_ti', user_id: null });

    await act(async () => {
      await result.current.loadInitial();
    });

    expect(calls_for_tab('para_ti')).toHaveLength(1);
    expect(result.current.restoredScrollIndex).toBeNull();
  });

  it('(EC-CACHE-HOOK-2) hit_desde_estado_poblado_no_refetchea_y_conserva_los_datos_originales', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('para_ti', [
      { data: [make_feed_property('orig-1'), make_feed_property('orig-2')], nextCursor: 'c-orig' },
    ]);
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: 'u1' });
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(property_ids(result.current.data)).toEqual(['orig-1', 'orig-2']);

    feed.set('nuevos', [{ data: [make_feed_property('otro-tab')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'nuevos', user_id: 'u1' });
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(calls_for_tab('para_ti')).toHaveLength(1);
    expect(calls_for_tab('nuevos')).toHaveLength(1);

    // FUGA: si el regreso a 'para_ti' refetchea en vez de usar la caché,
    // esta respuesta (encolada específicamente para 'para_ti') se colaría
    // en `data`.
    feed.set('para_ti', [{ data: [make_feed_property('fuga-si-esto-aparece')], nextCursor: 'c-fuga' }]);
    await act(async () => {
      await rerender({ filters, tab: 'para_ti', user_id: 'u1' });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(calls_for_tab('para_ti')).toHaveLength(1);
    expect(property_ids(result.current.data)).toEqual(['orig-1', 'orig-2']);
    expect(result.current.nextCursor).toBe('c-orig');
    expect(result.current.isLoading).toBe(false);
  });

  it('(EC-CACHE-HOOK-3) hit_nunca_enciende_isloading_ni_siquiera_de_forma_sincrona', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('sync-a')],
      nextCursor: null,
    });
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('sync-b')],
      nextCursor: null,
    });
    await act(async () => {
      await rerender({ filters, tab: 'nuevos', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    await act(async () => {
      await rerender({ filters, tab: 'para_ti', user_id: null });
    });

    // Invoca loadInitial SIN esperar: en un hit no debe haber NINGÚN fetch en
    // vuelo — el fetch real enciende isLoading de forma síncrona (antes del
    // primer await), así que esta comprobación distingue hit de miss.
    act(() => {
      void result.current.loadInitial();
    });
    expect(result.current.isLoading).toBe(false);

    // Drena cualquier promesa pendiente para no dejar un act() abierto.
    await act(async () => {});
  });

  it('(EC-CACHE-HOOK-4) loadmore_sobre_tab_restaurado_continua_desde_el_cursor_restaurado', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('nuevos', [{ data: [make_feed_property('cont-a')], nextCursor: 'cursor-real' }]);
    const { result, rerender } = await render_feed({ filters, tab: 'nuevos', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    feed.set('para_ti', [{ data: [make_feed_property('otro-tab')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'para_ti', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    // FUGA: si el regreso a 'nuevos' refetchea, este cursor equivocado (
    // encolado específicamente para 'nuevos') se colaría como el
    // `nextCursor` que loadMore debería usar.
    feed.set('nuevos', [{ data: [make_feed_property('fuga-cursor')], nextCursor: 'cursor-fuga' }]);
    await act(async () => {
      await rerender({ filters, tab: 'nuevos', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(calls_for_tab('nuevos')).toHaveLength(1); // sigue siendo hit: la fuga no se consumió

    feed.set('nuevos', [{ data: [make_feed_property('cont-b')], nextCursor: null }]);
    await act(async () => {
      await result.current.loadMore();
    });

    const load_more_call = calls_for_tab('nuevos').at(-1)!;
    expect(load_more_call[0]).toBe('cursor-real');
    expect(property_ids(result.current.data)).toEqual(['cont-a', 'cont-b']);
  });

  it('(EC-CACHE-HOOK-5) lapcount_y_las_keys_lap_se_preservan_por_tab_a_traves_de_un_round_trip', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('lap-x')],
      nextCursor: null,
    });
    const { result, rerender } = await render_feed({ filters, tab: 'nuevos', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('lap-y')],
      nextCursor: null,
    });
    await act(async () => {
      await result.current.loadMore();
    });
    expect(result.current.lapCount).toBe(1);

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('otra-tab')],
      nextCursor: null,
    });
    await act(async () => {
      await rerender({ filters, tab: 'para_ti', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.lapCount).toBe(0);

    await act(async () => {
      await rerender({ filters, tab: 'nuevos', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(result.current.lapCount).toBe(1);
    expect(result.current.data.map((it) => (it as { lap?: number }).lap)).toEqual([
      undefined,
      1,
    ]);
  });

  it('(EC-CACHE-HOOK-6) refetch_reescribe_la_entrada_y_el_regreso_posterior_ve_los_datos_frescos_sin_refetch', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('venta', [{ data: [make_feed_property('refetch-orig')], nextCursor: 'c1' }]);
    const { result, rerender } = await render_feed({ filters, tab: 'venta', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    feed.set('venta', [{ data: [make_feed_property('refetch-fresco')], nextCursor: 'c2' }]);
    await act(async () => {
      await result.current.refetch();
    });
    expect(calls_for_tab('venta')).toHaveLength(2);

    feed.set('renta', [{ data: [make_feed_property('otro-tab')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'renta', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    // (Sin assert de conteo para 'renta' aquí: 'venta' tiene DOS vecinos
    // —'nuevos' y 'renta'— así que tanto el miss inicial como el refetch de
    // 'venta' agendan su propio intento de prefetch hacia 'renta'; cuántos
    // de esos intentos ocurren es un detalle de implementación ajeno a lo
    // que este caso verifica — el round-trip de caché de 'venta'.)

    // FUGA: si el regreso a 'venta' no usara la entrada RE-escrita por
    // refetch (o refetcheara de más), esta respuesta (encolada
    // específicamente para 'venta') contaminaría `data`.
    feed.set('venta', [{ data: [make_feed_property('fuga')], nextCursor: 'c-fuga' }]);
    await act(async () => {
      await rerender({ filters, tab: 'venta', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(calls_for_tab('venta')).toHaveLength(2);
    expect(property_ids(result.current.data)).toEqual(['refetch-fresco']);
  });

  it('(EC-CACHE-HOOK-7) edad_menor_al_ttl_sigue_siendo_hit_al_regresar', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('para_ti', [{ data: [make_feed_property('fresh-a')], nextCursor: null }]);
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    feed.set('nuevos', [{ data: [make_feed_property('otro-tab')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'nuevos', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    await act(async () => {
      jest.setSystemTime(BASE_TIME + FEED_CACHE_TTL_MS - 1);
    });

    feed.set('para_ti', [{ data: [make_feed_property('fuga-fresh')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'para_ti', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(calls_for_tab('para_ti')).toHaveLength(1);
    expect(property_ids(result.current.data)).toEqual(['fresh-a']);
  });

  it('(EC-CACHE-HOOK-8) edad_mayor_al_ttl_es_miss_y_refetchea_al_regresar', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('para_ti', [{ data: [make_feed_property('stale-a')], nextCursor: null }]);
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    feed.set('nuevos', [{ data: [make_feed_property('otro-tab')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'nuevos', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    await act(async () => {
      jest.setSystemTime(BASE_TIME + FEED_CACHE_TTL_MS + 1);
    });

    feed.set('para_ti', [{ data: [make_feed_property('post-ttl')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'para_ti', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(calls_for_tab('para_ti')).toHaveLength(2);
    expect(property_ids(result.current.data)).toEqual(['post-ttl']);
  });

  it('(EC-CACHE-HOOK-9) cambiar_user_id_en_el_mismo_tab_es_miss_nunca_filtra_datos_de_otro_usuario', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('siguiendo', [{ data: [make_feed_property('de-user-1')], nextCursor: null }]);
    const { result, rerender } = await render_feed({
      filters,
      tab: 'siguiendo',
      user_id: 'user-1',
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    const llamadas_tras_user1 = calls_for_tab('siguiendo').length;

    feed.set('siguiendo', [{ data: [make_feed_property('de-user-2')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'siguiendo', user_id: 'user-2' });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(calls_for_tab('siguiendo').length).toBeGreaterThan(llamadas_tras_user1);
    expect(property_ids(result.current.data)).toEqual(['de-user-2']);
  });

  it('(EC-CACHE-HOOK-10) tras_loadinitial_exitoso_se_prefetchean_los_vecinos_sin_entrada_valida', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS, price_min: 3000 };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('main-siguiendo')],
      nextCursor: null,
    });
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('vecino-para_ti')],
      nextCursor: 'c-pt',
    });
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('vecino-nuevos')],
      nextCursor: 'c-nv',
    });

    const { result } = await render_feed({ filters, tab: 'siguiendo', user_id: 'u1' });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {});

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(3);
    const prefetch_calls = mock_fetch_feed_page.mock.calls.slice(1);
    const ctx_por_llamada = prefetch_calls.map((c) => c[3]);
    expect(ctx_por_llamada).toEqual(
      expect.arrayContaining([
        { tab: 'para_ti', user_id: 'u1' },
        { tab: 'nuevos', user_id: 'u1' },
      ]),
    );
    const filters_por_tab = new Map(
      prefetch_calls.map((c) => [(c[3] as { tab: FeedTab }).tab, c[2]]),
    );
    expect(filters_por_tab.get('para_ti')).toEqual(with_tab(filters, 'para_ti'));
    expect(filters_por_tab.get('nuevos')).toEqual(with_tab(filters, 'nuevos'));
  });

  it('(EC-CACHE-HOOK-11) el_prefetch_de_vecinos_nunca_toca_data_isloading_error_del_tab_visible', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('visible-a')],
      nextCursor: null,
    });
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('vecino-1')],
      nextCursor: null,
    });
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('vecino-2')],
      nextCursor: null,
    });

    const { result } = await render_feed({ filters, tab: 'siguiendo', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {});

    expect(property_ids(result.current.data)).toEqual(['visible-a']);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-CACHE-HOOK-12) un_vecino_ya_cacheado_como_tab_principal_no_se_vuelve_a_pedir_por_el_prefetch', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    // 1. 'para_ti' como tab principal — su único vecino es 'siguiendo', que
    //    se prefetchea.
    feed.set('para_ti', [{ data: [make_feed_property('pt-main')], nextCursor: null }]);
    feed.set('siguiendo', [{ data: [make_feed_property('pt-prefetch-siguiendo')], nextCursor: null }]);
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {});
    expect(calls_for_tab('para_ti')).toHaveLength(1);
    expect(calls_for_tab('siguiendo')).toHaveLength(1);

    // 2. Navega a 'siguiendo' — YA tiene entrada válida (paso 1, prefetcheada)
    //    → HIT, sin nueva llamada para 'siguiendo'. Su vecino 'para_ti' YA
    //    tiene entrada válida (paso 1, tab principal) y no debe re-pedirse;
    //    solo se prefetchea 'nuevos' (sin entrada).
    feed.set('nuevos', [{ data: [make_feed_property('sig-prefetch-nuevos')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'siguiendo', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {});

    expect(calls_for_tab('siguiendo')).toHaveLength(1); // hit: sin nueva llamada
    expect(calls_for_tab('para_ti')).toHaveLength(1); // vecino ya cacheado: no se re-pide
    expect(calls_for_tab('nuevos')).toHaveLength(1); // vecino sin cache: sí se prefetchea
  });

  it('(EC-CACHE-HOOK-13) el_fallo_de_un_vecino_en_el_prefetch_se_ignora_en_silencio', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('main')],
      nextCursor: null,
    });
    mock_fetch_feed_page.mockRejectedValueOnce(new Error('vecino caído'));
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('vecino-ok')],
      nextCursor: null,
    });

    const { result } = await render_feed({ filters, tab: 'siguiendo', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {});

    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('(EC-CACHE-HOOK-14) navegar_a_un_vecino_ya_prefetcheado_es_un_hit_instantaneo_sin_fetch', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('para_ti', [{ data: [make_feed_property('main')], nextCursor: null }]);
    feed.set('siguiendo', [
      {
        data: [make_feed_property('vecino-prefetched-1'), make_feed_property('vecino-prefetched-2')],
        nextCursor: 'c-vecino',
      },
    ]);

    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {}); // deja correr el prefetch de 'siguiendo' (único vecino de para_ti)

    expect(calls_for_tab('para_ti')).toHaveLength(1);
    expect(calls_for_tab('siguiendo')).toHaveLength(1);

    // FUGA: si el hit no usara la entrada prefetcheada, esta respuesta
    // (encolada específicamente para 'siguiendo') se colaría.
    feed.set('siguiendo', [{ data: [make_feed_property('fuga')], nextCursor: 'c-fuga' }]);
    await act(async () => {
      await rerender({ filters, tab: 'siguiendo', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    // Sigue siendo hit para 'siguiendo' (0 llamadas nuevas para ESE tab); el
    // GREEN corregido ahora SÍ prefetchea a partir de un hit (296.5), así que
    // puede sumar una llamada para 'nuevos' (el otro vecino de 'siguiendo',
    // sin cache) — eso no invalida "el hit fue instantáneo", que es lo que
    // este caso afirma.
    expect(calls_for_tab('siguiendo')).toHaveLength(1);
    expect(property_ids(result.current.data)).toEqual([
      'vecino-prefetched-1',
      'vecino-prefetched-2',
    ]);
    expect(result.current.nextCursor).toBe('c-vecino');
  });

  it('(EC-CACHE-HOOK-15) notescrollindex_escribe_en_el_tab_cargado_no_en_feed_tab_y_un_regreso_posterior_expone_restoredscrollindex', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('venta', [{ data: [make_feed_property('scroll-a')], nextCursor: null }]);
    const { result, rerender } = await render_feed({ filters, tab: 'venta', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    // Cambia la prop `feed_tab` a 'renta' pero TODAVÍA NO llama loadInitial:
    // el dataset de 'venta' sigue en `data` (loaded_tab_ref sigue en
    // 'venta'). Un GREEN que escribiera con `feed_tab` (la prop, ya 'renta')
    // en vez de con el tab CARGADO metería el índice en la entrada
    // equivocada — la de 'renta', que encima ni siquiera existe todavía.
    await act(async () => {
      await rerender({ filters, tab: 'renta', user_id: null });
    });
    await act(() => {
      result.current.noteScrollIndex(7);
    });

    feed.set('renta', [{ data: [make_feed_property('scroll-b')], nextCursor: null }]);
    await act(async () => {
      await result.current.loadInitial();
    });

    const filters_key = feed_cache_key(filters, null);
    expect(get_feed_tab_entry('venta', filters_key, Date.now())?.scroll_index).toBe(7);
    expect(get_feed_tab_entry('renta', filters_key, Date.now())?.scroll_index).toBe(0);

    // FUGA: si el regreso a 'venta' no fuera un hit, esta respuesta
    // (encolada específicamente para 'venta') se colaría.
    feed.set('venta', [{ data: [make_feed_property('fuga')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'venta', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(calls_for_tab('venta')).toHaveLength(1); // sigue siendo hit
    expect(result.current.restoredScrollIndex).toBe(7);
  });

  it('(EC-CACHE-HOOK-16) tras_un_refetch_restoredscrollindex_vuelve_a_null_y_la_entrada_queda_con_scroll_index_0', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    const feed = respond_by_tab();
    feed.set('venta', [{ data: [make_feed_property('rs-a')], nextCursor: null }]);
    const { result, rerender } = await render_feed({ filters, tab: 'venta', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    await act(() => {
      result.current.noteScrollIndex(5);
    });

    feed.set('renta', [{ data: [make_feed_property('rs-renta')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'renta', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    // ESTADO POBLADO (memoria reset_solo_se_prueba_desde_estado_poblado):
    // antes de refetchear, confirma que el regreso a 'venta' SÍ restauró
    // `restoredScrollIndex` a un valor no-null — si esto no se prueba, el
    // `toBeNull()` de más abajo pasa aunque nadie lo haya reseteado nunca
    // (sería el estado inicial de todos modos).
    feed.set('venta', [{ data: [make_feed_property('fuga-antes-de-refetch')], nextCursor: null }]);
    await act(async () => {
      await rerender({ filters, tab: 'venta', user_id: null });
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(calls_for_tab('venta')).toHaveLength(1); // sigue siendo hit
    expect(result.current.restoredScrollIndex).toBe(5);

    feed.set('venta', [{ data: [make_feed_property('rs-b')], nextCursor: null }]);
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.restoredScrollIndex).toBeNull();
    const filters_key = feed_cache_key(filters, null);
    expect(get_feed_tab_entry('venta', filters_key, Date.now())?.scroll_index).toBe(0);
  });
});
