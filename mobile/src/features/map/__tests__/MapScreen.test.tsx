/**
 * Tests — MapScreen (mobile/src/features/map/MapScreen.tsx)
 * Subtarea Taskmaster: 233.1 — candado del guardian (#233, hallazgo 1):
 * el catch de `handle_select_place` para una colonia (fetch del polígono vía
 * `fetch_neighborhood_polygon`, RPC `get_neighborhood_geojson`) era MUDO —
 * el testStrategy de #161 pedía "mensaje visible" y no estaba. Fix: overlay
 * `polygon_error` que reusa el MISMO mecanismo (`styles.error_overlay`/
 * `error_text`) que ya existía para el error de `useMapProperties`.
 *
 * MapScreen no tenía NINGÚN test — pantalla NO crítica (CLAUDE.md §5,
 * `components/**`/pantallas), así que este archivo es solo el candado del
 * guardian, no cobertura exhaustiva de MapScreen. Mismo criterio que
 * PropertyDetailScreen.test.tsx: cada hijo sin lógica bajo prueba aquí queda
 * stubbeado a `null` (su propia cobertura vive en su propio archivo);
 * `react-native-maps` se mockea entero (sin native module bajo Jest).
 *
 * SEAM: `PlaceSearch` se mockea como una función que registra sus props en
 * `mock_place_search_calls` — así el test dispara `on_select_place` directo, sin
 * simular taps dentro de una ScrollView real.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';

import { MapScreen, NEIGHBORHOOD_POLYGON_ERROR_MESSAGE } from '../MapScreen';
import type { PlaceSuggestion } from '../lib/placeSearch';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

jest.mock('react-native-maps', () => {
  const React2 = require('react');
  const MapViewStub = React2.forwardRef((props: any, _ref: any) => props.children ?? null);
  return {
    __esModule: true,
    default: MapViewStub,
    Polygon: () => null,
    Region: {},
  };
});

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => ({ coords: null }),
}));

jest.mock('../../search/filterStore', () => ({
  useFilters: () => ({
    filters: {},
    set_filter: jest.fn(),
    active_filter_count: 0,
  }),
}));

const mock_use_map_properties = jest.fn();
jest.mock('../hooks/useMapProperties', () => ({
  useMapProperties: (...args: unknown[]) => mock_use_map_properties(...args),
}));

jest.mock('../hooks/usePlaceSearch', () => ({
  usePlaceSearch: () => ({
    query: '',
    set_query: jest.fn(),
    suggestions: [],
    loading: false,
    error: null,
    clear: jest.fn(),
  }),
}));

const mock_fetch_neighborhood_polygon = jest.fn();
jest.mock('../lib/neighborhoodPolygon', () => ({
  fetch_neighborhood_polygon: (...args: unknown[]) => mock_fetch_neighborhood_polygon(...args),
}));

jest.mock('../components/PropertyMarker', () => ({ PropertyMarker: () => null }));
jest.mock('../components/ClusterMarker', () => ({ ClusterMarker: () => null }));
jest.mock('../components/PropertyMiniCard', () => ({ PropertyMiniCard: () => null }));
jest.mock('../components/AreaSearchPill', () => ({ AreaSearchPill: () => null }));
jest.mock('../components/MapSearchBar', () => ({ MapSearchBar: () => null }));
jest.mock('../../search/components/FilterSheet', () => ({ FilterSheet: () => null }));
jest.mock('../../search/components/ZoneActiveChip', () => ({ ZoneActiveChip: () => null }));

let mock_place_search_calls: any[] = [];
jest.mock('../components/PlaceSearch', () => ({
  PlaceSearch: (props: any) => {
    mock_place_search_calls.push(props);
    return null;
  },
}));

const NEIGHBORHOOD: PlaceSuggestion = {
  kind: 'neighborhood',
  id: '42',
  name: 'Providencia',
  context: 'Guadalajara, Jal.',
  bbox: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mock_place_search_calls = [];
  mock_use_map_properties.mockReturnValue({ data: [], loading: false, error: null });
});

describe('MapScreen — candado #233.1 (fetch de polígono fallido)', () => {
  it('el catch de handle_select_place ya NO es mudo: aparece un mensaje visible', async () => {
    mock_fetch_neighborhood_polygon.mockRejectedValue(new Error('network fail'));

    const { getByText } = await render(<MapScreen />);

    const latest_props = mock_place_search_calls[mock_place_search_calls.length - 1];
    await act(async () => {
      await latest_props.on_select_place(NEIGHBORHOOD);
    });

    expect(getByText(NEIGHBORHOOD_POLYGON_ERROR_MESSAGE)).toBeTruthy();
  });

  it('fetch exitoso → sin mensaje de error de polígono', async () => {
    mock_fetch_neighborhood_polygon.mockResolvedValue({
      id: '42',
      name: 'Providencia',
      polygons: [],
      bbox: { min_lat: 0, min_lng: 0, max_lat: 1, max_lng: 1 },
    });

    const { queryByText } = await render(<MapScreen />);

    const latest_props = mock_place_search_calls[mock_place_search_calls.length - 1];
    await act(async () => {
      await latest_props.on_select_place(NEIGHBORHOOD);
    });

    expect(queryByText(NEIGHBORHOOD_POLYGON_ERROR_MESSAGE)).toBeNull();
  });
});
