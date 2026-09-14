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
 *                     cargado; un regreso posterior expone
 *                     `restoredScrollIndex` con ese valor EXACTO.
 * (EC-CACHE-HOOK-16) tras un refetch, `restoredScrollIndex` vuelve a `null`
 *                     (dataset fresco, sin scroll heredado).
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
import { FEED_CACHE_TTL_MS, reset_feed_tab_cache } from '../lib/feedTabCache';
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

beforeEach(() => {
  jest.useFakeTimers({ now: BASE_TIME, doNotFake: ['queueMicrotask', 'setImmediate'] });
  jest.clearAllMocks();
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
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('miss-a')],
      nextCursor: null,
    });
    const { result } = await render_feed({ tab: 'para_ti', user_id: null });

    await act(async () => {
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(1);
    expect(result.current.restoredScrollIndex).toBeNull();
  });

  it('(EC-CACHE-HOOK-2) hit_desde_estado_poblado_no_refetchea_y_conserva_los_datos_originales', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('orig-1'), make_feed_property('orig-2')],
      nextCursor: 'c-orig',
    });
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: 'u1' });
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(property_ids(result.current.data)).toEqual(['orig-1', 'orig-2']);

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('otro-tab')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'nuevos', user_id: 'u1' });
      await result.current.loadInitial();
    });
    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);

    // FUGA: si el regreso a 'para_ti' refetchea en vez de usar la caché,
    // esta respuesta se colaría en `data`.
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('fuga-si-esto-aparece')],
      nextCursor: 'c-fuga',
    });
    await act(async () => {
      rerender({ filters, tab: 'para_ti', user_id: 'u1' });
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);
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
      rerender({ filters, tab: 'nuevos', user_id: null });
      await result.current.loadInitial();
    });

    act(() => {
      rerender({ filters, tab: 'para_ti', user_id: null });
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
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('cont-a')],
      nextCursor: 'cursor-real',
    });
    const { result, rerender } = await render_feed({ filters, tab: 'nuevos', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('otro-tab')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'para_ti', user_id: null });
      await result.current.loadInitial();
    });

    // FUGA: si el regreso a 'nuevos' refetchea, este cursor equivocado se
    // colaría como el `nextCursor` que loadMore debería usar.
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('fuga-cursor')],
      nextCursor: 'cursor-fuga',
    });
    await act(async () => {
      rerender({ filters, tab: 'nuevos', user_id: null });
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('cont-b')],
      nextCursor: null,
    });
    await act(async () => {
      await result.current.loadMore();
    });

    const load_more_call = mock_fetch_feed_page.mock.calls.at(-1)!;
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
      rerender({ filters, tab: 'para_ti', user_id: null });
      await result.current.loadInitial();
    });
    expect(result.current.lapCount).toBe(0);

    await act(async () => {
      rerender({ filters, tab: 'nuevos', user_id: null });
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
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('refetch-orig')],
      nextCursor: 'c1',
    });
    const { result, rerender } = await render_feed({ filters, tab: 'venta', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('refetch-fresco')],
      nextCursor: 'c2',
    });
    await act(async () => {
      await result.current.refetch();
    });
    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('otro-tab')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'renta', user_id: null });
      await result.current.loadInitial();
    });
    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(3);

    // FUGA: si el regreso a 'venta' no usara la entrada RE-escrita por
    // refetch (o refetcheara de más), esta respuesta contaminaría `data`.
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('fuga')],
      nextCursor: 'c-fuga',
    });
    await act(async () => {
      rerender({ filters, tab: 'venta', user_id: null });
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(3);
    expect(property_ids(result.current.data)).toEqual(['refetch-fresco']);
  });

  it('(EC-CACHE-HOOK-7) edad_menor_al_ttl_sigue_siendo_hit_al_regresar', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('fresh-a')],
      nextCursor: null,
    });
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('otro-tab')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'nuevos', user_id: null });
      await result.current.loadInitial();
    });

    await act(async () => {
      jest.setSystemTime(BASE_TIME + FEED_CACHE_TTL_MS - 1);
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('fuga-fresh')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'para_ti', user_id: null });
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);
    expect(property_ids(result.current.data)).toEqual(['fresh-a']);
  });

  it('(EC-CACHE-HOOK-8) edad_mayor_al_ttl_es_miss_y_refetchea_al_regresar', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('stale-a')],
      nextCursor: null,
    });
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('otro-tab')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'nuevos', user_id: null });
      await result.current.loadInitial();
    });

    await act(async () => {
      jest.setSystemTime(BASE_TIME + FEED_CACHE_TTL_MS + 1);
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('post-ttl')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'para_ti', user_id: null });
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(3);
    expect(property_ids(result.current.data)).toEqual(['post-ttl']);
  });

  it('(EC-CACHE-HOOK-9) cambiar_user_id_en_el_mismo_tab_es_miss_nunca_filtra_datos_de_otro_usuario', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('de-user-1')],
      nextCursor: null,
    });
    const { result, rerender } = await render_feed({
      filters,
      tab: 'siguiendo',
      user_id: 'user-1',
    });
    await act(async () => {
      await result.current.loadInitial();
    });
    const llamadas_tras_user1 = mock_fetch_feed_page.mock.calls.length;

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('de-user-2')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'siguiendo', user_id: 'user-2' });
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page.mock.calls.length).toBeGreaterThan(llamadas_tras_user1);
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
    // 1. 'para_ti' como tab principal — su único vecino es 'siguiendo', que
    //    se prefetchea.
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('pt-main')],
      nextCursor: null,
    });
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('pt-prefetch-siguiendo')],
      nextCursor: null,
    });
    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {});
    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);

    // 2. Navega a 'siguiendo' — su vecino 'para_ti' YA tiene entrada válida
    //    (paso 1) y no debe re-pedirse; solo se prefetchea 'nuevos'.
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('sig-main')],
      nextCursor: null,
    });
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('sig-prefetch-nuevos')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'siguiendo', user_id: null });
      await result.current.loadInitial();
    });
    await act(async () => {});

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(4);
    const tabs_pedidos_paso_2 = mock_fetch_feed_page.mock.calls
      .slice(2)
      .map((c) => (c[3] as { tab: FeedTab }).tab);
    expect(tabs_pedidos_paso_2).toEqual(['siguiendo', 'nuevos']);
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
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('main')],
      nextCursor: null,
    });
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('vecino-prefetched-1'), make_feed_property('vecino-prefetched-2')],
      nextCursor: 'c-vecino',
    });

    const { result, rerender } = await render_feed({ filters, tab: 'para_ti', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });
    await act(async () => {}); // deja correr el prefetch de 'siguiendo' (único vecino de para_ti)

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);

    // FUGA: si el hit no usara la entrada prefetcheada, esta respuesta se colaría.
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('fuga')],
      nextCursor: 'c-fuga',
    });
    await act(async () => {
      rerender({ filters, tab: 'siguiendo', user_id: null });
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);
    expect(property_ids(result.current.data)).toEqual([
      'vecino-prefetched-1',
      'vecino-prefetched-2',
    ]);
    expect(result.current.nextCursor).toBe('c-vecino');
  });

  it('(EC-CACHE-HOOK-15) notescrollindex_guarda_el_indice_y_un_regreso_posterior_expone_restoredscrollindex', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('scroll-a')],
      nextCursor: null,
    });
    const { result, rerender } = await render_feed({ filters, tab: 'venta', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    act(() => {
      result.current.noteScrollIndex(3);
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('scroll-b')],
      nextCursor: null,
    });
    await act(async () => {
      rerender({ filters, tab: 'renta', user_id: null });
      await result.current.loadInitial();
    });

    await act(async () => {
      rerender({ filters, tab: 'venta', user_id: null });
      await result.current.loadInitial();
    });

    expect(result.current.restoredScrollIndex).toBe(3);
  });

  it('(EC-CACHE-HOOK-16) tras_un_refetch_restoredscrollindex_vuelve_a_null', async () => {
    const filters: FilterState = { ...EMPTY_FILTERS };
    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('rs-a')],
      nextCursor: null,
    });
    const { result } = await render_feed({ filters, tab: 'venta', user_id: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    act(() => {
      result.current.noteScrollIndex(5);
    });

    mock_fetch_feed_page.mockResolvedValueOnce({
      data: [make_feed_property('rs-b')],
      nextCursor: null,
    });
    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.restoredScrollIndex).toBeNull();
  });
});
