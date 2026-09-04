/**
 * RED — #249: al aplicar filtros el feed no cambia hasta hacer pull-to-refresh.
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts
 *
 * CAUSA RAÍZ (reproducida, no inferida): el disparo del refetch SÍ funciona —
 * al cambiar la identidad de `filters` cambia la de `loadInitial` y el efecto
 * de FeedScreen la vuelve a llamar (EC-249-3 lo fija). Lo que falla es que la
 * petición ANTERIOR sigue en vuelo y no hay ninguna guarda de concurrencia:
 * cuando resuelve DESPUÉS de la nueva, su `set_data` pisa la página filtrada y
 * el feed se queda mostrando lo de antes. El pull-to-refresh es una sola
 * petición sin solapamiento, por eso ahí sí se aplican los filtros — que es
 * literalmente el síntoma del smoke #222 paso 4.
 *
 * El docblock del hook ya declaraba el techo: "sin abort controller (el feed
 * es efímero, sin race visible)". Con el FilterSheet escribiendo al store en
 * cada toque (el slider de radio emite en cada movimiento del PanResponder) la
 * race es perfectamente visible.
 *
 * GREEN esperado: solo la petición VIGENTE escribe estado.
 *
 * SEAMS: `fetchFeedProperties` mockeado con promesas que resolvemos a mano
 * (así el orden de llegada es determinista, sin timers); `useLocation` y el
 * cliente supabase stubbeados igual que en useFeedProperties.test.tsx.
 * El efecto que dispara loadInitial se replica en el harness porque vive en
 * FeedScreen, no en el hook.
 */

import { useEffect } from 'react';
import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
  mint_videos: jest.fn().mockResolvedValue([]),
}));

// ponytail: objeto de ubicación estable a nivel de módulo — devolver un literal
// nuevo en cada render cambiaría la identidad de coords y con ella la de
// loadInitial, lo que dispara un refetch por render (bucle) y arruinaría el
// conteo de llamadas de estos tests.
jest.mock('@/features/location/LocationProvider', () => {
  const location = { coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' };
  return { useLocation: () => location };
});

jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import type { FeedPropertyWithUrl } from '../types';
import type { FeedItem } from '../lib/interleaveAds';

const mock_fetch = fetchFeedProperties as jest.MockedFunction<typeof fetchFeedProperties>;

type FeedPage = { data: FeedPropertyWithUrl[]; nextCursor: string | null };

function make_property(id: string): FeedPropertyWithUrl {
  return {
    id,
    price: 15000,
    operation_type: 'sale',
    property_type: 'casa',
    currency: 'MXN',
    price_visible: true,
    address: 'Av. Chapultepec 100',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'owner-249',
    agent_name: null,
    agent_photo_url: null,
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_phone: null,
    video: { id: `video-${id}`, storage_path: `p/${id}.mp4`, position: 0, thumbnail_url: null },
    signed_url: `https://cdn.urbea.app/${id}.mp4`,
    video_id: `video-${id}`,
    posterUrl: null,
  } as unknown as FeedPropertyWithUrl;
}

const property_ids = (items: FeedItem[]): string[] =>
  items.filter((it) => it.kind === 'property').map((it) => (it as { property: { id: string } }).property.id);

const RADIO_5KM: FilterState = { ...EMPTY_FILTERS, radius_m: 5000 };
const SIN_LIMITE: FilterState = { ...EMPTY_FILTERS, radius_m: null };

/**
 * Monta el hook con el MISMO efecto que FeedScreen usa para disparar la carga
 * (`useEffect(() => { loadInitial(); }, [loadInitial])`), de modo que un cambio
 * de `filters` reproduzca el flujo real de la pantalla.
 */
async function render_feed(filters: FilterState) {
  return renderHook(
    ({ f }: { f: FilterState }) => {
      const feed = useFeedProperties(f);
      const { loadInitial } = feed;
      useEffect(() => {
        void loadInitial();
      }, [loadInitial]);
      return feed;
    },
    { initialProps: { f: filters } },
  );
}

/** Devuelve el `filters` con el que se hizo la n-ésima llamada al lib. */
const filters_of_call = (n: number): FilterState | undefined => mock_fetch.mock.calls[n]?.[2];

beforeEach(() => {
  jest.clearAllMocks();
  mock_fetch.mockResolvedValue({ data: [], nextCursor: null });
});

describe('useFeedProperties — refetch al aplicar filtros (#249)', () => {
  it('(EC-249-1) respuesta_inicial_vieja_no_pisa_a_la_nueva: si la petición del filtro ANTERIOR resuelve después de la del filtro nuevo, el feed conserva la página nueva', async () => {
    let resolve_vieja!: (page: FeedPage) => void;
    let resolve_nueva!: (page: FeedPage) => void;
    mock_fetch.mockImplementationOnce(() => new Promise<FeedPage>((r) => (resolve_vieja = r)));
    mock_fetch.mockImplementationOnce(() => new Promise<FeedPage>((r) => (resolve_nueva = r)));

    const { result, rerender } = await render_feed(RADIO_5KM);
    await act(async () => {});

    // El usuario cambia el radio a «Sin límite» con la primera petición aún en vuelo.
    await act(async () => {
      rerender({ f: SIN_LIMITE });
    });

    // La nueva llega primero; la vieja se retrasa y aterriza al final.
    await act(async () => {
      resolve_nueva({ data: [make_property('nueva')], nextCursor: null });
    });
    await act(async () => {
      resolve_vieja({ data: [make_property('vieja')], nextCursor: null });
    });

    expect(property_ids(result.current.data)).toEqual(['nueva']);
  });

  it('(EC-249-2) loadmore_viejo_no_apende_tras_cambiar_filtros: una página siguiente pedida ANTES del cambio de filtros no se apende al feed ya refiltrado', async () => {
    mock_fetch.mockResolvedValueOnce({ data: [make_property('p1')], nextCursor: '10' });

    const { result, rerender } = await render_feed(RADIO_5KM);
    await act(async () => {});

    let resolve_more!: (page: FeedPage) => void;
    mock_fetch.mockImplementationOnce(() => new Promise<FeedPage>((r) => (resolve_more = r)));
    await act(async () => {
      void result.current.loadMore();
    });

    // Cambia el filtro con el loadMore en vuelo.
    mock_fetch.mockResolvedValueOnce({ data: [make_property('refiltrada')], nextCursor: null });
    await act(async () => {
      rerender({ f: SIN_LIMITE });
    });
    await act(async () => {});

    // La página vieja aterriza tarde: no debe entrar al feed nuevo.
    await act(async () => {
      resolve_more({ data: [make_property('pagina_vieja')], nextCursor: null });
    });

    expect(property_ids(result.current.data)).toEqual(['refiltrada']);
  });

  it('(EC-249-3) cambio_de_radio_refetchea_sin_pull: cambiar radius_m a null vuelve a llamar a fetchFeedProperties con el radio nuevo, sin invocar refetch() a mano', async () => {
    const { result, rerender } = await render_feed(RADIO_5KM);
    await act(async () => {});
    expect(mock_fetch).toHaveBeenCalledTimes(1);
    expect(filters_of_call(0)?.radius_m).toBe(5000);

    const refetch_espia = jest.spyOn(result.current, 'refetch');
    await act(async () => {
      rerender({ f: SIN_LIMITE });
    });
    await act(async () => {});

    expect(mock_fetch).toHaveBeenCalledTimes(2);
    expect(filters_of_call(1)?.radius_m).toBe(null);
    expect(refetch_espia).not.toHaveBeenCalled();
  });

  it('(EC-249-4) seccion_venta_renta_sigue_refrescando: cambiar operation_types (tabs #241) refetchea con la sección nueva', async () => {
    const venta: FilterState = { ...EMPTY_FILTERS, operation_types: ['sale'] };
    const renta: FilterState = { ...EMPTY_FILTERS, operation_types: ['rent'] };

    const { rerender } = await render_feed(venta);
    await act(async () => {});
    expect(filters_of_call(0)?.operation_types).toEqual(['sale']);

    await act(async () => {
      rerender({ f: renta });
    });
    await act(async () => {});

    expect(mock_fetch).toHaveBeenCalledTimes(2);
    expect(filters_of_call(1)?.operation_types).toEqual(['rent']);
  });
});
