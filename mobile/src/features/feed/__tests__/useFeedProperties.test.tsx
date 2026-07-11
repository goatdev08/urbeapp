/**
 * RED — useFeedProperties + onPropertyDeleted (55.2)
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts
 *
 * Falla hoy: el hook no se suscribe a emitPropertyDeleted → el id borrado sigue en `data`.
 * GREEN: useEffect(() => onPropertyDeleted(id => setData(prev => prev.filter(p => p.id !== id))), [])
 *
 * Mocks: fetchFeedProperties sí; propertyEvents no (pub/sub real).
 * EC-4: spy en onPropertyDeleted, delega al real, envuelve unsubscribe en jest.fn.
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
}));

// ponytail: harness (#42.2/#59) — default granted+coords; gating (#59) overridea a null.
const mock_use_location = jest.fn().mockReturnValue({ coords: null, status: 'loading' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// ponytail: harness (#42.2) — stub supabase; feedProperties lo require lazy con coords.
jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));


import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import type { FeedPropertyWithUrl } from '../types';

import * as property_events from '@/lib/propertyEvents';
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
    address: 'Av. Chapultepec 100, Col. Juárez, CDMX',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'owner-uuid-feed-test',
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_phone: null,
    video: {
      id: `video-${id}`,
      storage_path: `properties/${id}/video.mp4`,
      position: 0,
      thumbnail_url: null,
    },
    signed_url: `https://cdn.urbea.app/signed/${id}.mp4`,
    video_id: `video-${id}`,
    ...overrides,
  };
}

const PROP_A = make_feed_property('feed-prop-uuid-aaa');
const PROP_B = make_feed_property('feed-prop-uuid-bbb');
const PROP_C = make_feed_property('feed-prop-uuid-ccc');

const DEFAULT_COORDS = { latitude: 20.6597, longitude: -103.3496 };

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_location.mockReturnValue({ coords: DEFAULT_COORDS, status: 'granted' });
  mock_fetch_feed_properties.mockResolvedValue({
    data: [PROP_A, PROP_B, PROP_C],
    nextCursor: null,
  });
});

async function render_loaded_hook() {
  const rendered = await renderHook(() => useFeedProperties());
  await act(async () => {
    await rendered.result.current.loadInitial();
  });
  return rendered;
}

describe('useFeedProperties — suscripción a onPropertyDeleted (55.2)', () => {
  it('(EC-1) id_borrado_desaparece_del_estado_tras_emitPropertyDeleted: tras emitPropertyDeleted(idB), data ya no contiene idB y su longitud baja de 3 a 2', async () => {
    const { result } = await render_loaded_hook();
    expect(result.current.data.map((p) => p.id)).toEqual([
      PROP_A.id,
      PROP_B.id,
      PROP_C.id,
    ]);

    await act(async () => {
      emitPropertyDeleted(PROP_B.id);
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data.map((p) => p.id)).not.toContain(PROP_B.id);
  });

  it('(EC-2) otros_items_conservan_identidad_y_signed_url: al borrar idB, los objetos idA/idC restantes mantienen su misma referencia y signed_url (el video en reproducción no se reinicia)', async () => {
    const { result } = await render_loaded_hook();
    const prop_a_before = result.current.data.find((p) => p.id === PROP_A.id);
    const prop_c_before = result.current.data.find((p) => p.id === PROP_C.id);
    expect(prop_a_before).toBeDefined();
    expect(prop_c_before).toBeDefined();

    await act(async () => {
      emitPropertyDeleted(PROP_B.id);
    });

    expect(result.current.data).toHaveLength(2);

    const prop_a_after = result.current.data.find((p) => p.id === PROP_A.id);
    const prop_c_after = result.current.data.find((p) => p.id === PROP_C.id);

    expect(prop_a_after).toBe(prop_a_before);
    expect(prop_c_after).toBe(prop_c_before);
    expect(prop_a_after?.signed_url).toBe(PROP_A.signed_url);
    expect(prop_c_after?.signed_url).toBe(PROP_C.signed_url);
  });

  it('(EC-3) emitir_id_inexistente_no_afecta_los_items_restantes: tras borrar idB (2 items quedan), emitir un id que no existe en el feed no cambia el conteo ni los ids restantes', async () => {
    const { result } = await render_loaded_hook();

    await act(async () => {
      emitPropertyDeleted(PROP_B.id);
    });
    expect(result.current.data).toHaveLength(2);

    await act(async () => {
      emitPropertyDeleted('feed-prop-uuid-que-no-existe');
    });

    expect(result.current.data).toHaveLength(2);
    expect(result.current.data.map((p) => p.id)).toEqual([PROP_A.id, PROP_C.id]);
  });

  it('(EC-4) desmontar_limpia_la_suscripcion_unsubscribe_invocado: el hook se suscribe una vez al montar y llama la función de unsubscribe devuelta al desmontar', async () => {
    const real_on_property_deleted = property_events.onPropertyDeleted;
    const on_property_deleted_spy = jest
      .spyOn(property_events, 'onPropertyDeleted')
      .mockImplementation((listener: (property_id: string) => void) => {
        const real_unsubscribe = real_on_property_deleted(listener);
        return jest.fn(real_unsubscribe);
      });

    const { unmount } = await render_loaded_hook();

    expect(on_property_deleted_spy).toHaveBeenCalledTimes(1);

    const wrapped_unsubscribe = on_property_deleted_spy.mock.results[0]!
      .value as jest.Mock;

    await act(async () => {
      unmount();
    });

    expect(wrapped_unsubscribe).toHaveBeenCalledTimes(1);

    on_property_deleted_spy.mockRestore();
  });

  it('(EC-5) coords_de_uselocation_fluyen_a_deps_de_fetchfeedproperties: useLocation devuelve coords reales → loadInitial llama fetchFeedProperties con deps.coords === esas coords', async () => {
    const coords = { latitude: 20.6597, longitude: -103.3496 };
    mock_use_location.mockReturnValueOnce({ coords, status: 'granted' });

    await render_loaded_hook();

    expect(mock_fetch_feed_properties).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ coords }),
      undefined,
    );
  });
});

/**
 * RED — coords gating (#59): sin coords reales, no fetch (evita flash GDL).
 * Fallan hoy gate-EC-1/3/5 (fetch con coords null). gate-EC-2/4 = regresión.
 */
describe('useFeedProperties — coords gating (#59)', () => {
  const REAL_COORDS = { latitude: 20.6597, longitude: -103.3496 };
  const NO_COORDS = { coords: null, status: 'loading' as const };

  it('gate-EC-1: coords null → loadInitial() NO dispara fetch, isLoading sigue true, data []', async () => {
    mock_use_location.mockReturnValue(NO_COORDS);

    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_properties).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
  });

  it('gate-EC-2: coords null en mount → isLoading true y data [] (precondición del skeleton)', async () => {
    mock_use_location.mockReturnValue(NO_COORDS);

    const { result } = await renderHook(() => useFeedProperties());

    expect(result.current.isLoading).toBe(true);
    expect(result.current.data).toEqual([]);
    expect(mock_fetch_feed_properties).not.toHaveBeenCalled();
  });

  it('gate-EC-3: coords null → real → loadInitial ahora sí dispara fetch (1 vez, con coords reales) y baja isLoading', async () => {
    mock_use_location.mockReturnValue(NO_COORDS);

    const { result, rerender } = await renderHook(() => useFeedProperties());

    await act(async () => {
      await result.current.loadInitial();
    });
    expect(mock_fetch_feed_properties).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);

    mock_use_location.mockReturnValue({ coords: REAL_COORDS, status: 'granted' });
    await act(async () => {
      rerender(undefined);
    });
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_properties).toHaveBeenCalledTimes(1);
    expect(mock_fetch_feed_properties).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ coords: REAL_COORDS }),
      undefined,
    );
    expect(result.current.data).toHaveLength(3);
    expect(result.current.isLoading).toBe(false);
  });

  it('gate-EC-4: coords null → loadMore() es no-op (guard nextCursor null, sin fetch)', async () => {
    mock_use_location.mockReturnValue(NO_COORDS);

    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mock_fetch_feed_properties).not.toHaveBeenCalled();
  });

  it('gate-EC-5: coords null → refetch() (alias de loadInitial) NO dispara fetch', async () => {
    mock_use_location.mockReturnValue(NO_COORDS);

    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.refetch();
    });

    expect(mock_fetch_feed_properties).not.toHaveBeenCalled();
  });
});
