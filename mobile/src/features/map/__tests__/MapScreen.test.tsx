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
  // El `React` importado arriba NO es visible aquí: babel-plugin-jest-hoist
  // eleva jest.mock() por encima de los imports y solo permite identificadores
  // definidos DENTRO del factory (verificado: referenciar `React` truena con
  // "not allowed to reference any out-of-scope variables") — require() local
  // es la única forma correcta, no una regresión de estilo.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactForMock = require('react');
  const MapViewStub = ReactForMock.forwardRef((props: any, _ref: any) => props.children ?? null);
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

// 268.2: useZoneSearchEvent (vía @/features/auth/context) evalúa el cliente
// real de Supabase al importarse — truena bajo Jest sin env vars (este
// archivo no las mockea, MapScreen no lo necesitaba antes de 268.2). Mock
// mínimo: MapScreen no tiene lógica bajo prueba aquí sobre la telemetría
// (su contrato vive en useZoneSearchEvent.test.tsx), solo necesita no explotar.
// Hoisteado (guardian 268.2): un jest.fn estable permite asertar el cableado
// de los 3 disparos desde los tests que ya conducen on_select_place.
const mock_report_zone_search = jest.fn();
jest.mock('../hooks/useZoneSearchEvent', () => ({
  useZoneSearchEvent: () => ({ report_zone_search: mock_report_zone_search }),
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
    // 268.2: una búsqueda de colonia que FALLÓ no es señal CRM (mutante M13 del guardian)
    expect(mock_report_zone_search).not.toHaveBeenCalled();
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
    // 268.2: colonia con polígono OK → un zone_search {kind:'neighborhood'}
    expect(mock_report_zone_search).toHaveBeenCalledTimes(1);
    expect(mock_report_zone_search).toHaveBeenCalledWith({
      kind: 'neighborhood',
      neighborhood_id: NEIGHBORHOOD.id,
    });
  });

  it('fallo→éxito: una segunda selección que SÍ resuelve limpia el mensaje de la anterior (candado del guardian — mutante: borrar el reset de polygon_error al inicio de handle_select_place)', async () => {
    mock_fetch_neighborhood_polygon.mockRejectedValueOnce(new Error('network fail'));

    const { getByText, queryByText } = await render(<MapScreen />);
    const latest_props = mock_place_search_calls[mock_place_search_calls.length - 1];

    await act(async () => {
      await latest_props.on_select_place(NEIGHBORHOOD);
    });
    expect(getByText(NEIGHBORHOOD_POLYGON_ERROR_MESSAGE)).toBeTruthy();

    mock_fetch_neighborhood_polygon.mockResolvedValueOnce({
      id: '42',
      name: 'Providencia',
      polygons: [],
      bbox: { min_lat: 0, min_lng: 0, max_lat: 1, max_lng: 1 },
    });
    await act(async () => {
      await latest_props.on_select_place(NEIGHBORHOOD);
    });

    expect(queryByText(NEIGHBORHOOD_POLYGON_ERROR_MESSAGE)).toBeNull();
  });
});

describe('MapScreen — zone_search (268.2): disparo de municipio', () => {
  it('municipio con bbox → un zone_search {kind:\'municipality\'} con su id; sin bbox → nada', async () => {
    await render(<MapScreen />);
    const latest_props = mock_place_search_calls[mock_place_search_calls.length - 1];

    await act(async () => {
      await latest_props.on_select_place({
        kind: 'municipality',
        id: 'muni-1',
        name: 'Zapopan',
        context: 'Jal.',
        bbox: null,
      });
    });
    expect(mock_report_zone_search).not.toHaveBeenCalled();

    await act(async () => {
      await latest_props.on_select_place({
        kind: 'municipality',
        id: 'muni-1',
        name: 'Zapopan',
        context: 'Jal.',
        bbox: { min_lat: 20.6, min_lng: -103.5, max_lat: 20.8, max_lng: -103.3 },
      });
    });
    expect(mock_report_zone_search).toHaveBeenCalledTimes(1);
    expect(mock_report_zone_search).toHaveBeenCalledWith({
      kind: 'municipality',
      municipality_id: 'muni-1',
    });
  });
});
