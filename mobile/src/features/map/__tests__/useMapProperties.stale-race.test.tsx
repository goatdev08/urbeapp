/**
 * RED — #249 (verificación del mapa): useMapProperties comparte el FilterState
 * con el feed (#56 «buscar en esta zona»), y arrastra el MISMO defecto que
 * useFeedProperties: `set_data(result)` sin guarda de concurrencia, así que la
 * petición del filtro anterior —si resuelve tarde— pisa el resultado filtrado
 * y el mapa se queda mostrando los pines de antes.
 *
 * SUT: mobile/src/features/map/hooks/useMapProperties.ts
 * GREEN esperado: solo la petición VIGENTE escribe estado.
 *
 * SEAMS: `fetchMapProperties` mockeado con promesas resueltas a mano (orden de
 * llegada determinista); `useLocation` stubbeado con un objeto estable.
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/mapProperties', () => ({
  fetchMapProperties: jest.fn(),
}));

// ponytail: objeto estable a nivel de módulo — un literal nuevo por render
// cambiaría la identidad de coords → de fetch_data → refetch por render.
jest.mock('@/features/location/LocationProvider', () => {
  const location = { coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' };
  return { useLocation: () => location };
});

import { useMapProperties } from '../hooks/useMapProperties';
import { fetchMapProperties } from '../lib/mapProperties';
import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';
import type { MapProperty } from '../types';

const mock_fetch = fetchMapProperties as jest.MockedFunction<typeof fetchMapProperties>;

const make_marker = (id: string): MapProperty =>
  ({ id, latitude: 20.6, longitude: -103.3, price: 1_000_000 }) as unknown as MapProperty;

const RADIO_5KM: FilterState = { ...EMPTY_FILTERS, radius_m: 5000 };
const SIN_LIMITE: FilterState = { ...EMPTY_FILTERS, radius_m: null };

const SUPABASE_STUB = {};

beforeEach(() => {
  jest.clearAllMocks();
  mock_fetch.mockResolvedValue([]);
});

describe('useMapProperties — refetch al aplicar filtros (#249)', () => {
  it('(EC-249-5) respuesta_vieja_del_mapa_no_pisa_a_la_nueva: si la petición del filtro ANTERIOR resuelve después de la del filtro nuevo, el mapa conserva los pines nuevos', async () => {
    let resolve_vieja!: (rows: MapProperty[]) => void;
    let resolve_nueva!: (rows: MapProperty[]) => void;
    mock_fetch.mockImplementationOnce(() => new Promise<MapProperty[]>((r) => (resolve_vieja = r)));
    mock_fetch.mockImplementationOnce(() => new Promise<MapProperty[]>((r) => (resolve_nueva = r)));

    const { result, rerender } = await renderHook(
      ({ f }: { f: FilterState }) => useMapProperties(SUPABASE_STUB, f),
      { initialProps: { f: RADIO_5KM } },
    );
    await act(async () => {});

    await act(async () => {
      rerender({ f: SIN_LIMITE });
    });

    await act(async () => {
      resolve_nueva([make_marker('nueva')]);
    });
    await act(async () => {
      resolve_vieja([make_marker('vieja')]);
    });

    expect(result.current.data.map((p) => p.id)).toEqual(['nueva']);
  });
});
