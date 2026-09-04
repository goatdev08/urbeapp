/**
 * RED — #249 (segundo defecto del mismo flujo): al cambiar un filtro, el
 * FilterSheet SE DESMONTA en plena interacción.
 *
 * SUT: mobile/src/features/feed/FeedScreen.tsx
 *
 * FeedScreen renderiza <FilterSheet> dentro del gate
 * `show_filters = !is_skeleton && !is_error`. Al aplicar un filtro, el efecto
 * de #241.2 vacía `data` y loadInitial pone isLoading en true ⇒ is_skeleton
 * pasa a true ⇒ el Modal del sheet desaparece mientras se recarga y vuelve a
 * montarse cuando llega la página (filter_visible nunca cambió). El usuario ve
 * el panel cerrarse solo justo al tocar un filtro.
 *
 * GREEN esperado: el sheet sobrevive a la recarga. El BOTÓN de filtros sigue
 * oculto durante la carga inicial (requisito de #157, fijado abajo).
 *
 * SEAMS: se maneja el FilterProvider REAL desde un componente sonda que expone
 * `set_filter` — así el test empuja el store igual que lo hace el sheet, sin
 * depender de simular toques dentro de un Modal de RN.
 * Los hijos pesados del feed (video, anuncios, autocomplete de zona) se
 * stubbean a null: su cobertura vive en sus propios archivos.
 */

import React, { useEffect } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
  mint_videos: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/features/location/LocationProvider', () => {
  const location = { coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' };
  return { useLocation: () => location };
});

jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));

jest.mock('@/lib/splash-gate', () => ({ release_splash: jest.fn() }));
jest.mock('../components/VideoFeedItem', () => ({ VideoFeedItem: () => null }));
jest.mock('../components/AdFeedItem', () => ({ AdFeedItem: () => null }));
jest.mock('../../search/components/ZoneAutocomplete', () => ({ ZoneAutocomplete: () => null }));

import { FeedScreen } from '../FeedScreen';
import { FilterProvider, useFilters, type FilterContextValue } from '@/features/search/filterStore';
import { fetchFeedProperties } from '../lib/feedProperties';
import type { FeedPropertyWithUrl } from '../types';

const mock_fetch = fetchFeedProperties as jest.MockedFunction<typeof fetchFeedProperties>;

type FeedPage = { data: FeedPropertyWithUrl[]; nextCursor: string | null };

const make_property = (id: string): FeedPropertyWithUrl =>
  ({
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
  }) as unknown as FeedPropertyWithUrl;

/**
 * Sonda: publica el valor del FilterContext real para empujarlo desde el test.
 * La publicación va en un EFECTO, no en el cuerpo del render: escribir en un
 * contenedor externo durante el render es un efecto secundario y el lint de
 * react-hooks lo rechaza ("This value cannot be modified").
 */
const filter_probe: { value: FilterContextValue | null } = { value: null };
function FilterProbe(): null {
  const context = useFilters();
  useEffect(() => {
    filter_probe.value = context;
  }, [context]);
  return null;
}

async function render_feed_screen() {
  return render(
    <FilterProvider>
      <FilterProbe />
      <FeedScreen />
    </FilterProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  filter_probe.value = null;
  mock_fetch.mockResolvedValue({ data: [make_property('inicial')], nextCursor: null });
});

describe('FeedScreen — el FilterSheet durante la recarga por filtros (#249)', () => {
  it('(EC-249-6) filtersheet_sigue_montado_durante_la_recarga_por_filtros: con el sheet abierto, cambiar un filtro NO lo desmonta mientras llega la página nueva', async () => {
    const screen = await render_feed_screen();
    await act(async () => {});

    // El usuario abre el panel de filtros.
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Abrir filtros'));
    });
    expect(screen.queryByTestId('radius_unlimited_toggle')).not.toBeNull();

    // Cambia el radio; la página nueva queda EN VUELO.
    let resolve_page!: (page: FeedPage) => void;
    mock_fetch.mockImplementationOnce(() => new Promise<FeedPage>((r) => (resolve_page = r)));
    await act(async () => {
      filter_probe.value!.set_filter('radius_m', null);
    });

    // 🔴 Aquí el sheet desaparecía: is_skeleton apagaba todo el bloque.
    expect(screen.queryByTestId('radius_unlimited_toggle')).not.toBeNull();

    await act(async () => {
      resolve_page({ data: [make_property('filtrada')], nextCursor: null });
    });
    expect(screen.queryByTestId('radius_unlimited_toggle')).not.toBeNull();
  });

  it('(EC-249-7) boton_de_filtros_sigue_oculto_en_la_carga_inicial: durante el skeleton del arranque el botón de filtros no se muestra (#157)', async () => {
    // Toda petición queda en vuelo: el arranque monta el hook y, tras hidratar
    // el FilterProvider desde AsyncStorage, vuelve a pedir la primera página.
    const pendientes: ((page: FeedPage) => void)[] = [];
    mock_fetch.mockImplementation(() => new Promise<FeedPage>((r) => pendientes.push(r)));

    const screen = await render_feed_screen();
    await act(async () => {});

    expect(screen.queryByLabelText('Abrir filtros')).toBeNull();

    await act(async () => {
      pendientes.forEach((resolve) => resolve({ data: [make_property('inicial')], nextCursor: null }));
    });
    expect(screen.queryByLabelText('Abrir filtros')).not.toBeNull();
  });
});
