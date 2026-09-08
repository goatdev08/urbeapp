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
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { MapScreen, NEIGHBORHOOD_POLYGON_ERROR_MESSAGE } from '../MapScreen';
import type { PlaceSuggestion } from '../lib/placeSearch';
import { viewport_to_area } from '../lib/viewportToArea';
import { format_radius_m } from '../lib/formatRadius';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// 281.2: captura las props que MapContent le pasa a <MapView> — así los
// tests disparan onRegionChangeComplete directo, sin un native module real
// (mismo espíritu que mock_place_search_calls, más abajo).
let mock_map_view_props: any = {};
jest.mock('react-native-maps', () => {
  // El `React` importado arriba NO es visible aquí: babel-plugin-jest-hoist
  // eleva jest.mock() por encima de los imports y solo permite identificadores
  // definidos DENTRO del factory (verificado: referenciar `React` truena con
  // "not allowed to reference any out-of-scope variables") — require() local
  // es la única forma correcta, no una regresión de estilo.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactForMock = require('react');
  const MapViewStub = ReactForMock.forwardRef((props: any, _ref: any) => {
    mock_map_view_props = props;
    return props.children ?? null;
  });
  // 281.2: Circle expuesto como View con testID + las props relevantes en
  // data-* — así los tests leen center/radius/lineDashPattern sin depender
  // del native module (mismo patrón que Polygon, pero Polygon no necesitaba
  // inspección de props hasta ahora).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const CircleStub = (props: any) =>
    ReactForMock.createElement(View, {
      testID: 'zone-circle',
      'data-center': JSON.stringify(props.center),
      'data-radius': props.radius,
      'data-dashed': props.lineDashPattern != null,
    });
  return {
    __esModule: true,
    default: MapViewStub,
    Polygon: () => null,
    Circle: CircleStub,
    Region: {},
  };
});

// #284: push hoisteado para asertar la navegación al feed al confirmar la zona.
const mock_router_push = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mock_router_push }),
}));

// 281.2: jest.fn() en vez de valor fijo — los tests de zone_circle necesitan
// variar coords/filters.area/filters.radius_m por caso.
const mock_use_location = jest.fn();
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: (...args: unknown[]) => mock_use_location(...args),
}));

const mock_use_filters = jest.fn();
jest.mock('../../search/filterStore', () => ({
  useFilters: (...args: unknown[]) => mock_use_filters(...args),
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
// #284: la píldora captura props — los tests pulsan on_press/on_cancel directo
// (mismo seam que PlaceSearch/ZoneActiveChip) y leen el label del modo.
let mock_area_pill_calls: any[] = [];
jest.mock('../components/AreaSearchPill', () => ({
  AreaSearchPill: (props: any) => {
    mock_area_pill_calls.push(props);
    return null;
  },
}));
jest.mock('../components/MapSearchBar', () => ({ MapSearchBar: () => null }));
jest.mock('../../search/components/FilterSheet', () => ({ FilterSheet: () => null }));
// 281.3: captura las props (como PlaceSearch más abajo) para asertar el
// label "Zona activa · {radio}" sin depender del render real del chip.
let mock_zone_active_chip_calls: any[] = [];
jest.mock('../../search/components/ZoneActiveChip', () => ({
  ZoneActiveChip: (props: any) => {
    mock_zone_active_chip_calls.push(props);
    return null;
  },
}));

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
  mock_zone_active_chip_calls = [];
  mock_area_pill_calls = [];
  mock_map_view_props = {};
  mock_use_map_properties.mockReturnValue({ data: [], loading: false, error: null });
  mock_use_location.mockReturnValue({ coords: null });
  mock_use_filters.mockReturnValue({
    filters: { area: null, radius_m: null },
    set_filter: jest.fn(),
    active_filter_count: 0,
  });
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

describe('MapScreen — modo búsqueda por zona (#284) y círculo geo-anclado (281.2)', () => {
  const REGION = { latitude: 20.7, longitude: -103.35, latitudeDelta: 0.05, longitudeDelta: 0.05 };
  const LAYOUT = { nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 800 } } };

  /** Última píldora renderizada (props vivas). */
  function last_pill() {
    return mock_area_pill_calls[mock_area_pill_calls.length - 1];
  }

  /** Layout del contenedor + una región conocida, como tras el primer pan. */
  async function layout_and_pan(getByTestId: (id: string) => any) {
    // RNTL 14: fireEvent es async (envuelve act) — sin await se solapan los act().
    await fireEvent(getByTestId('map-container'), 'layout', LAYOUT);
    await act(async () => {
      mock_map_view_props.onRegionChangeComplete(REGION);
    });
  }

  it('reposo: la píldora está SIEMPRE visible con el label default y sin Cancelar; panear NO dibuja ningún círculo (el visor de 281.2 se retiró)', async () => {
    const { getByTestId, queryByTestId } = await render(<MapScreen />);
    expect(last_pill()).toBeDefined();

    await layout_and_pan(getByTestId);

    expect(last_pill().label).toBeUndefined();
    expect(last_pill().on_cancel).toBeUndefined();
    expect(queryByTestId('zone-circle')).toBeNull();
    expect(queryByTestId('zone-viewfinder')).toBeNull();
  });

  it('entrar al modo: pulsar la píldora → círculo FIJO centrado con diámetro = lado corto del contenedor, label «Buscar aquí · X km» y Cancelar', async () => {
    const { getByTestId, queryByTestId } = await render(<MapScreen />);
    await layout_and_pan(getByTestId);

    await act(async () => {
      last_pill().on_press();
    });

    const style = StyleSheet.flatten(getByTestId('zone-viewfinder').props.style);
    expect(style.width).toBe(400);
    expect(style.height).toBe(400);
    expect(style.borderRadius).toBe(200);
    expect(style.top).toBe(200); // (800 - 400) / 2
    expect(style.left).toBe(0); // (400 - 400) / 2
    expect(last_pill().label).toBe(
      `Buscar aquí · ${format_radius_m(viewport_to_area(REGION).radius_m)}`,
    );
    expect(typeof last_pill().on_cancel).toBe('function');
    // En modo el círculo geo-anclado no compite con el fijo.
    expect(queryByTestId('zone-circle')).toBeNull();
  });

  it('en modo el mapa se mueve debajo: una región nueva actualiza el radio del label (el círculo fijo no cambia de sitio)', async () => {
    const { getByTestId } = await render(<MapScreen />);
    await layout_and_pan(getByTestId);
    await act(async () => {
      last_pill().on_press();
    });
    const before = StyleSheet.flatten(getByTestId('zone-viewfinder').props.style);

    const ZOOMED = { ...REGION, latitudeDelta: 0.01, longitudeDelta: 0.01 };
    await act(async () => {
      mock_map_view_props.onRegionChangeComplete(ZOOMED);
    });

    expect(last_pill().label).toBe(
      `Buscar aquí · ${format_radius_m(viewport_to_area(ZOOMED).radius_m)}`,
    );
    const after = StyleSheet.flatten(getByTestId('zone-viewfinder').props.style);
    expect(after.top).toBe(before.top);
    expect(after.left).toBe(before.left);
    expect(after.width).toBe(before.width);
  });

  it('confirmar: segunda pulsación → set_filter(\'area\', viewport_to_area(region)) + push(\'/\') y sale del modo', async () => {
    const set_filter = jest.fn();
    mock_use_filters.mockReturnValue({
      filters: { area: null, radius_m: null },
      set_filter,
      active_filter_count: 0,
    });
    const { getByTestId, queryByTestId } = await render(<MapScreen />);
    await layout_and_pan(getByTestId);
    await act(async () => {
      last_pill().on_press();
    });

    await act(async () => {
      last_pill().on_press();
    });

    expect(set_filter).toHaveBeenCalledWith('area', viewport_to_area(REGION));
    expect(mock_router_push).toHaveBeenCalledWith('/');
    expect(mock_report_zone_search).toHaveBeenCalledWith({
      kind: 'area',
      center: viewport_to_area(REGION).center,
      radius_m: viewport_to_area(REGION).radius_m,
    });
    expect(queryByTestId('zone-viewfinder')).toBeNull();
    expect(last_pill().on_cancel).toBeUndefined();
  });

  it('cancelar: sale del modo sin set_filter ni navegación', async () => {
    const set_filter = jest.fn();
    mock_use_filters.mockReturnValue({
      filters: { area: null, radius_m: null },
      set_filter,
      active_filter_count: 0,
    });
    const { getByTestId, queryByTestId } = await render(<MapScreen />);
    await layout_and_pan(getByTestId);
    await act(async () => {
      last_pill().on_press();
    });
    expect(getByTestId('zone-viewfinder')).toBeTruthy();

    await act(async () => {
      last_pill().on_cancel();
    });

    expect(queryByTestId('zone-viewfinder')).toBeNull();
    expect(set_filter).not.toHaveBeenCalled();
    expect(mock_router_push).not.toHaveBeenCalled();
    expect(last_pill().label).toBeUndefined();
  });

  it('elegir un lugar del buscador abandona el modo búsqueda', async () => {
    mock_fetch_neighborhood_polygon.mockResolvedValue({
      id: '42',
      name: 'Providencia',
      polygons: [],
      bbox: { min_lat: 0, min_lng: 0, max_lat: 1, max_lng: 1 },
    });
    const { getByTestId, queryByTestId } = await render(<MapScreen />);
    await layout_and_pan(getByTestId);
    await act(async () => {
      last_pill().on_press();
    });
    expect(getByTestId('zone-viewfinder')).toBeTruthy();

    const latest_props = mock_place_search_calls[mock_place_search_calls.length - 1];
    await act(async () => {
      await latest_props.on_select_place(NEIGHBORHOOD);
    });

    expect(queryByTestId('zone-viewfinder')).toBeNull();
  });

  it('sin layout todavía (map_size null) el modo no pinta un círculo de 0 px', async () => {
    const { queryByTestId } = await render(<MapScreen />);
    await act(async () => {
      last_pill().on_press();
    });
    expect(queryByTestId('zone-viewfinder')).toBeNull();
  });

  it('persistente: filters.area activo dibuja su center/radius; en modo búsqueda se OCULTA (el fijo muestra la zona nueva)', async () => {
    mock_use_filters.mockReturnValue({
      filters: { area: { center: { lat: 20.6, lng: -103.3 }, radius_m: 1200 }, radius_m: null },
      set_filter: jest.fn(),
      active_filter_count: 1,
    });

    const { getByTestId, queryByTestId } = await render(<MapScreen />);

    const circle = getByTestId('zone-circle');
    expect(circle.props['data-center']).toBe(
      JSON.stringify({ latitude: 20.6, longitude: -103.3 }),
    );
    expect(circle.props['data-radius']).toBe(1200);
    expect(circle.props['data-dashed']).toBe(false);

    await layout_and_pan(getByTestId);
    await act(async () => {
      last_pill().on_press();
    });
    expect(queryByTestId('zone-circle')).toBeNull();
    expect(getByTestId('zone-viewfinder')).toBeTruthy();
  });

  it('281.3: el chip de zona activa muestra "Zona activa · 2.4 km" con radius_m=2400', async () => {
    mock_use_filters.mockReturnValue({
      filters: { area: { center: { lat: 20.6, lng: -103.3 }, radius_m: 2400 }, radius_m: null },
      set_filter: jest.fn(),
      active_filter_count: 1,
    });

    await render(<MapScreen />);

    const chip_call = mock_zone_active_chip_calls.find((props) => props.label != null);
    expect(chip_call?.label).toBe('Zona activa · 2.4 km');
  });

  it('cerca de mí: radius_m numérico + user_coords → círculo PUNTEADO en el usuario', async () => {
    mock_use_filters.mockReturnValue({
      filters: { area: null, radius_m: 3000 },
      set_filter: jest.fn(),
      active_filter_count: 0,
    });
    mock_use_location.mockReturnValue({ coords: { latitude: 20.65, longitude: -103.34 } });

    const { getByTestId } = await render(<MapScreen />);

    const circle = getByTestId('zone-circle');
    expect(circle.props['data-center']).toBe(
      JSON.stringify({ latitude: 20.65, longitude: -103.34 }),
    );
    expect(circle.props['data-radius']).toBe(3000);
    expect(circle.props['data-dashed']).toBe(true);
  });

  it('ausente cuando radius_m es null (sin límite): el default implícito 5000 de mapProperties.ts NO se dibuja', async () => {
    mock_use_filters.mockReturnValue({
      filters: { area: null, radius_m: null },
      set_filter: jest.fn(),
      active_filter_count: 0,
    });
    mock_use_location.mockReturnValue({ coords: { latitude: 20.65, longitude: -103.34 } });

    const { queryByTestId } = await render(<MapScreen />);

    expect(queryByTestId('zone-circle')).toBeNull();
  });

  it('ausente con polígono de colonia activo (D9): ni el punteado «cerca de mí» se dibuja encima', async () => {
    mock_use_filters.mockReturnValue({
      filters: { area: null, radius_m: 3000 },
      set_filter: jest.fn(),
      active_filter_count: 0,
    });
    mock_use_location.mockReturnValue({ coords: { latitude: 20.65, longitude: -103.34 } });
    mock_fetch_neighborhood_polygon.mockResolvedValue({
      id: '42',
      name: 'Providencia',
      polygons: [[{ latitude: 0, longitude: 0 }]],
      bbox: { min_lat: 0, min_lng: 0, max_lat: 1, max_lng: 1 },
    });

    const { getByTestId, queryByTestId } = await render(<MapScreen />);
    expect(getByTestId('zone-circle')).toBeTruthy();

    const latest_props = mock_place_search_calls[mock_place_search_calls.length - 1];
    await act(async () => {
      await latest_props.on_select_place(NEIGHBORHOOD);
    });

    expect(queryByTestId('zone-circle')).toBeNull();
  });
});
