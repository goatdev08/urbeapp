/**
 * RED — #285.3: wrap de vuelta en useFeedProperties con re-fetch de página 1
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts
 * Doc: .taskmaster/docs/exploraciones/047-feed-infinito-reinicio.md §20 (Q1/Q4/Q5/Q6/Q7)
 *
 * CONTRATO fijado (plan 285.3 + doc 047):
 *  - load_more: si `nextCursor === null && data.length > 0 && !isLoading`, hace
 *    una VUELTA — re-fetch de página 1 (`fetchFeedProperties(undefined, deps,
 *    filters)`), baraja las propiedades con
 *    `shuffle_with_seed(props, hash_seed(get_app_session_id()) + lap)`,
 *    compone como CONTINUACIÓN (`skip_first_position=false`,
 *    `already_shown_ref`/`since_last_ad_ref` se arrastran), marca cada ítem
 *    con `lap` y APENDEA a `data`. SIN TECHO.
 *  - Con `data.length === 0` y `nextCursor === null` NO hace vuelta (mismo
 *    guard que hoy).
 *  - No vacía `data`; `isLoading` sigue el mismo patrón que un `load_more`
 *    normal (true solo mientras carga, `data` nunca se resetea a []).
 *  - Respeta `request_seq_ref` (#249): una respuesta tardía de una vuelta se
 *    descarta si mientras tanto entró otra carga (loadInitial/filters).
 *  - Expone `lapCount: number` (vueltas cruzadas, 0 al inicio) y lo resetea a
 *    0 en `load_initial`/`refetch`/cambio de `filters`.
 *
 * SEAMS bajo test: la firma pública de `useFeedProperties` — en particular
 * `data`, `lapCount`, `loadMore`, `loadInitial` — y el cableo hacia
 * `fetchFeedProperties` (mock de frontera) y `get_app_session_id` (mock de
 * frontera, fija la semilla del barajado).
 *
 * `compose_feed_items` (interno, no mockeado) cae en fail-soft absoluto
 * porque el doble de `@/lib/supabase/client` es `{}` sin `.rpc` (mismo patrón
 * que los 14 archivos preexistentes de feed/__tests__): todos los ítems de
 * estos tests son `kind: 'property'`, sin anuncios — la costura de anuncios
 * en la vuelta es 285.4, no esta subtarea.
 *
 * EDGE CASES (RED):
 * (1) nextCursor null + data no vacío → loadMore dispara UN fetch de página 1
 *     (cursor undefined) y apendea: data.length crece, ningún ítem se pierde.
 * (2) 5 vueltas seguidas apendean SIN TECHO; lapCount = 5.
 * (3) los ítems apendeados llevan `lap` = número de vuelta y sus keys
 *     (`feed_key_extractor`) son todas únicas a través de 3 vueltas — incluso
 *     repitiendo las MISMAS property_id (el caso real: se re-sirve el mismo
 *     inventario).
 * (4) la vuelta 2 llega permutada respecto al orden original con ≥ 3
 *     propiedades (8 ids) y el orden es determinista: dos hooks con el mismo
 *     `session_id` ven exactamente el mismo orden (mock de `get_app_session_id`
 *     fijo).
 * (5) durante la vuelta `data` NUNCA se vacía (no hay estado de skeleton) y
 *     `isLoading` vuelve a `false` al resolver.
 * (6) con `data` vacío y `nextCursor` null NO hace vuelta (combinado con el
 *     caso positivo en el mismo test: primero se prueba que SÍ vuelve cuando
 *     `data` no está vacío, luego que deja de hacerlo al vaciarse).
 * (7) respuesta tardía: si tras disparar la vuelta llega un `loadInitial`
 *     (cambio de identidad), la vuelta tardía NO se apendea y `lapCount`
 *     vuelve a 0.
 * (8) un fallo del fetch de vuelta pone `error` (mensaje exacto del `Error`
 *     rechazado) y NO incrementa `lapCount`; `data` no se corrompe.
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
}));

// Semilla fija de sesión: EC-4 exige que "dos hooks con el mismo session_id
// vean lo mismo" — un valor de módulo constante basta, no hace falta el
// patrón `mock_session_counter` de los archivos de ads (ese existe para
// des-duplicar la señal de fallo entre tests, que aquí no se ejerce: el
// stub de supabase no tiene `.rpc`, compose_feed_items nunca llega a esa
// señal).
const FIXED_SESSION_ID = 'sesion-lap-wrap-fija';
jest.mock('../lib/appSession', () => ({
  get_app_session_id: () => FIXED_SESSION_ID,
}));

const mock_use_location = jest
  .fn()
  .mockReturnValue({ coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// Sin `.rpc`: compose_feed_items degrada a fail-soft absoluto (170.4,
// decisión 6) y todos los ítems de este archivo son `kind: 'property'`.
jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import { feed_key_extractor, type LappedFeedItem } from '../lib/feedKeyExtractor';
import type { FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

import { emitPropertyDeleted } from '@/lib/propertyEvents';

const mock_fetch_feed_properties = fetchFeedProperties as jest.MockedFunction<
  typeof fetchFeedProperties
>;

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
    owner_user_id: 'owner-uuid-lap-wrap-test',
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

const laps_of = (items: FeedItem[]): (number | undefined)[] =>
  items.map((it) => (it as LappedFeedItem).lap);

beforeEach(() => {
  // resetAllMocks (no solo clearAllMocks): limpia también la COLA de
  // `mockResolvedValueOnce`/`mockImplementationOnce` — necesario aquí porque,
  // bajo el código HOY (sin la vuelta implementada), `loadMore` con
  // `nextCursor === null` es un no-op y nunca llama a `fetchFeedProperties`
  // para "la vuelta": esa promesa en cola quedaría sin consumir y se colaría
  // como la respuesta del PRIMER fetch del test siguiente (`clearAllMocks`
  // no vacía esa cola, solo `.mock.calls`/`.mock.results`).
  jest.resetAllMocks();
  mock_use_location.mockReturnValue({
    coords: { latitude: 20.6597, longitude: -103.3496 },
    status: 'granted',
  });
});

describe('useFeedProperties — wrap de vuelta (#285.3)', () => {
  it('(EC-1) nextcursor_null_con_data_no_vacio_dispara_una_vuelta_y_apendea_sin_perder_items: loadMore hace UN fetch de página 1 (cursor undefined) y data crece sin perder los items previos', async () => {
    const A = make_feed_property('lap-a');
    const B = make_feed_property('lap-b');
    const C = make_feed_property('lap-c');
    const D = make_feed_property('lap-d');
    const E = make_feed_property('lap-e');
    const F = make_feed_property('lap-f');

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [A, B, C], nextCursor: null });

    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.data).toHaveLength(3);

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [D, E, F], nextCursor: null });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mock_fetch_feed_properties).toHaveBeenCalledTimes(2);
    expect(mock_fetch_feed_properties.mock.calls[1]?.[0]).toBeUndefined();
    expect(result.current.data).toHaveLength(6);
    expect(new Set(property_ids(result.current.data))).toEqual(
      new Set([A, B, C, D, E, F].map((p) => p.id)),
    );
  });

  it('(EC-2) cinco_vueltas_seguidas_apendean_sin_techo: 5 loadMore consecutivos con nextCursor null siguen apendeando y lapCount llega a 5', async () => {
    const X = make_feed_property('lap-x');
    const Y = make_feed_property('lap-y');

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [X, Y], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.data).toHaveLength(2);

    for (let i = 0; i < 5; i++) {
      mock_fetch_feed_properties.mockResolvedValueOnce({ data: [X, Y], nextCursor: null });
      await act(async () => {
        await result.current.loadMore();
      });
    }

    expect(result.current.data).toHaveLength(2 + 5 * 2);
    expect(result.current.lapCount).toBe(5);
  });

  it('(EC-3) items_apendeados_llevan_lap_y_keys_unicas_a_traves_de_3_vueltas: aunque se repita la MISMA property_id en cada vuelta, `lap` marca el número de vuelta y feed_key_extractor produce 8 keys únicas', async () => {
    const P = make_feed_property('lap-p');
    const Q = make_feed_property('lap-q');

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [P, Q], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });

    for (let i = 0; i < 3; i++) {
      mock_fetch_feed_properties.mockResolvedValueOnce({ data: [P, Q], nextCursor: null });
      await act(async () => {
        await result.current.loadMore();
      });
    }

    expect(result.current.data).toHaveLength(8);
    // Primera vuelta (loadInitial): sin lap o lap 0. Vueltas 1..3: lap 1,2,3.
    expect(laps_of(result.current.data)).toEqual([undefined, undefined, 1, 1, 2, 2, 3, 3]);

    const keys = result.current.data.map((item) => feed_key_extractor(item as LappedFeedItem));
    expect(new Set(keys).size).toBe(8);
  });

  it('(EC-4) vuelta_2_llega_permutada_y_es_determinista_entre_hooks_con_mismo_session_id: con 8 propiedades, el orden de la vuelta 1 coincide EXACTO con shuffle_with_seed(ids, hash_seed(session_id)+1) trazado a mano, y dos hooks distintos con el mismo session_id ven el mismo orden', async () => {
    // traza (node -e con feedShuffle.ts real, hash_seed('sesion-lap-wrap-fija') + 1
    // sobre ['id-1'..'id-8']): seed=3142359283 → este orden exacto.
    const EXPECTED_ORDER = ['id-8', 'id-4', 'id-2', 'id-1', 'id-3', 'id-6', 'id-7', 'id-5'];
    const EIGHT = Array.from({ length: 8 }, (_, i) => make_feed_property(`id-${i + 1}`));
    const seed_item = make_feed_property('lap-seed');

    async function run_one_hook() {
      mock_fetch_feed_properties.mockResolvedValueOnce({ data: [seed_item], nextCursor: null });
      const { result } = await renderHook(() => useFeedProperties());
      await act(async () => {
        await result.current.loadInitial();
      });

      mock_fetch_feed_properties.mockResolvedValueOnce({ data: EIGHT, nextCursor: null });
      await act(async () => {
        await result.current.loadMore();
      });

      // El primer item es el de la carga inicial (lap 0); el resto es la vuelta.
      return property_ids(result.current.data).slice(1);
    }

    const order_hook_1 = await run_one_hook();
    const order_hook_2 = await run_one_hook();

    expect(order_hook_1).toEqual(EXPECTED_ORDER);
    expect(order_hook_2).toEqual(EXPECTED_ORDER);
    expect(order_hook_1).not.toEqual(EIGHT.map((p) => p.id));
  });

  it('(EC-5) durante_la_vuelta_data_nunca_se_vacia_y_no_hay_skeleton: mientras el fetch de la vuelta está en vuelo, data conserva los items previos; al resolver, isLoading vuelve a false y data crece', async () => {
    const A = make_feed_property('lap-skel-a');
    const B = make_feed_property('lap-skel-b');
    const C = make_feed_property('lap-skel-c');

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [A, B, C], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.isLoading).toBe(false);

    let resolve_wrap!: (page: { data: FeedPropertyWithUrl[]; nextCursor: string | null }) => void;
    mock_fetch_feed_properties.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_wrap = resolve;
        }),
    );

    await act(async () => {
      void result.current.loadMore();
    });

    // El fetch de la vuelta sigue en vuelo: nunca se vació la lista previa.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toHaveLength(3);
    expect(property_ids(result.current.data)).toEqual([A.id, B.id, C.id]);

    const D = make_feed_property('lap-skel-d');
    await act(async () => {
      resolve_wrap({ data: [D], nextCursor: null });
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.data).toHaveLength(4);
  });

  it('(EC-6) con_data_vacio_no_hace_vuelta_pero_con_data_no_vacio_si: primero confirma que SÍ vuelve (data no vacío); tras borrar todos los items (data []), un loadMore posterior NO dispara un fetch adicional', async () => {
    const SOLO = make_feed_property('lap-solo');

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [SOLO], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.data).toHaveLength(1);

    const OTRA = make_feed_property('lap-otra');
    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [OTRA], nextCursor: null });
    await act(async () => {
      await result.current.loadMore();
    });

    // Caso positivo: con data no vacío SÍ hizo la vuelta (2 fetches en total).
    expect(mock_fetch_feed_properties).toHaveBeenCalledTimes(2);
    expect(result.current.data).toHaveLength(2);
    expect(result.current.lapCount).toBe(1);

    await act(async () => {
      emitPropertyDeleted(SOLO.id);
      emitPropertyDeleted(OTRA.id);
    });
    expect(result.current.data).toHaveLength(0);

    await act(async () => {
      await result.current.loadMore();
    });

    // Caso negativo: con data vacío, NINGÚN fetch adicional (sigue en 2).
    expect(mock_fetch_feed_properties).toHaveBeenCalledTimes(2);
    expect(result.current.data).toHaveLength(0);
    expect(result.current.lapCount).toBe(1);
  });

  it('(EC-7) respuesta_tardia_de_la_vuelta_se_descarta_y_lapcount_vuelve_a_0: una carga nueva (loadInitial) entra mientras la vuelta sigue en vuelo → la vuelta tardía no se apendea y lapCount queda en 0', async () => {
    const P1 = make_feed_property('lap-tardia-p1');
    const P2 = make_feed_property('lap-tardia-p2');
    const P3_TARDE = make_feed_property('lap-tardia-p3-tarde');

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [P1], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.data).toHaveLength(1);

    let resolve_wrap!: (page: { data: FeedPropertyWithUrl[]; nextCursor: string | null }) => void;
    mock_fetch_feed_properties.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolve_wrap = resolve;
        }),
    );
    await act(async () => {
      void result.current.loadMore();
    });

    // La vuelta sí se disparó (2º fetch en vuelo).
    expect(mock_fetch_feed_properties).toHaveBeenCalledTimes(2);

    // Entra una carga nueva mientras la vuelta sigue pendiente.
    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [P2], nextCursor: null });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(property_ids(result.current.data)).toEqual([P2.id]);
    expect(result.current.lapCount).toBe(0);

    // La vuelta descartada llega tarde: no debe apendearse ni afectar lapCount.
    await act(async () => {
      resolve_wrap({ data: [P3_TARDE], nextCursor: null });
    });

    expect(property_ids(result.current.data)).toEqual([P2.id]);
    expect(result.current.lapCount).toBe(0);
  });

  it('(EC-8) fallo_del_fetch_de_vuelta_pone_error_y_no_incrementa_lapcount: la vuelta rechaza con un Error → error queda con ese mensaje exacto, lapCount sigue en 0 y data no se corrompe', async () => {
    const A = make_feed_property('lap-fail-a');
    const B = make_feed_property('lap-fail-b');

    mock_fetch_feed_properties.mockResolvedValueOnce({ data: [A, B], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.data).toHaveLength(2);

    mock_fetch_feed_properties.mockRejectedValueOnce(new Error('fallo_de_red_vuelta_test'));
    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.error).toBe('fallo_de_red_vuelta_test');
    expect(result.current.lapCount).toBe(0);
    expect(result.current.data).toHaveLength(2);
    expect(property_ids(result.current.data)).toEqual([A.id, B.id]);
  });
});
