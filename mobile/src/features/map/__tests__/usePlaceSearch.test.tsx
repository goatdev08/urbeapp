/**
 * Tests fase RED — usePlaceSearch (hook del autocomplete del mapa, #157.7)
 * Archivo SUT: mobile/src/features/map/hooks/usePlaceSearch.ts
 *
 * Espejo estructural de useZoneAutocomplete (debounce 300ms con useRef +
 * setTimeout) con UNA diferencia de fondo: aquí cada búsqueda es un ROUND-TRIP
 * de red (RPC search_places), no un filtro client-side — por eso se agrega el
 * guard ANTI-STALE: un contador de request en ref; solo el response del último
 * request puede setear suggestions. Sin él, una respuesta lenta de "provi"
 * puede pisar la respuesta fresca de "providencia" (out-of-order clásico).
 *
 * Contrato:
 *   - set_query(text): actualiza query INMEDIATO (input controlado); dispara
 *     la búsqueda tras 300ms sin tecleos nuevos (debounce).
 *   - Tras el debounce, texto con < 2 chars útiles → suggestions [] SIN llamar
 *     search_places (la lib también guarda, pero el hook ni lo intenta).
 *   - loading true mientras hay búsqueda en vuelo; error con el message si la
 *     lib lanza (y suggestions se vacían).
 *   - clear(): query '', suggestions [], error null; cancela el debounce
 *     pendiente (no dispara búsquedas fantasma).
 *
 * ⚠️ Gotcha del repo (memoria rntl_unmount_fuera_de_act): todo avance de
 * timers y resolución de promesas va DENTRO de act.
 *
 * EDGE CASES:
 * - (EC-H1) estado_inicial_vacio
 * - (EC-H2) debounce_300ms_una_llamada
 * - (EC-H3) tecleos_rapidos_solo_ultima_query
 * - (EC-H4) resultados_pueblan_suggestions
 * - (EC-H5) anti_stale_response_viejo_no_pisa_al_nuevo
 * - (EC-H6) query_corta_vacia_sin_llamar
 * - (EC-H7) error_de_lib_expone_message
 * - (EC-H8) clear_resetea_y_cancela_debounce
 */

import { act, renderHook } from '@testing-library/react-native';

import { usePlaceSearch } from '../hooks/usePlaceSearch';
import type { PlaceSuggestion } from '../lib/placeSearch';

jest.mock('../lib/placeSearch', () => ({
  search_places: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mock_search_places = (require('../lib/placeSearch') as {
  search_places: jest.Mock;
}).search_places;

const SUGGESTION: PlaceSuggestion = {
  kind: 'neighborhood',
  id: '42',
  name: 'Providencia',
  context: 'Guadalajara, Jal.',
  bbox: { min_lat: 20.69, min_lng: -103.38, max_lat: 20.71, max_lng: -103.36 },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mock_search_places.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

/** Avanza el debounce y drena las microtasks pendientes, todo dentro de act. */
async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('usePlaceSearch — autocomplete del mapa (#157)', () => {
  it('(EC-H1) estado_inicial_vacio: query "", suggestions [], loading false, error null', async () => {
    const { result } = await renderHook(() => usePlaceSearch());

    expect(result.current.query).toBe('');
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-H2) debounce_300ms_una_llamada: query inmediato en el estado; search_places solo tras 300ms', async () => {
    const { result } = await renderHook(() => usePlaceSearch());

    await act(async () => result.current.set_query('provi'));
    expect(result.current.query).toBe('provi');
    expect(mock_search_places).not.toHaveBeenCalled();

    await advance(299);
    expect(mock_search_places).not.toHaveBeenCalled();

    await advance(1);
    expect(mock_search_places).toHaveBeenCalledTimes(1);
    expect(mock_search_places.mock.calls[0][0]).toBe('provi');
  });

  it('(EC-H3) tecleos_rapidos_solo_ultima_query: "p"→"pr"→"provi" en <300ms → UNA llamada con "provi"', async () => {
    const { result } = await renderHook(() => usePlaceSearch());

    await act(async () => result.current.set_query('p'));
    await advance(100);
    await act(async () => result.current.set_query('pr'));
    await advance(100);
    await act(async () => result.current.set_query('provi'));
    await advance(300);

    expect(mock_search_places).toHaveBeenCalledTimes(1);
    expect(mock_search_places.mock.calls[0][0]).toBe('provi');
  });

  it('(EC-H4) resultados_pueblan_suggestions: la lib resuelve → suggestions con las filas y loading false', async () => {
    mock_search_places.mockResolvedValue([SUGGESTION]);
    const { result } = await renderHook(() => usePlaceSearch());

    await act(async () => result.current.set_query('provi'));
    await advance(300);

    expect(result.current.suggestions).toEqual([SUGGESTION]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('(EC-H5) anti_stale_response_viejo_no_pisa_al_nuevo: el response LENTO de la query vieja resuelve al final y NO sobrescribe', async () => {
    const vieja: PlaceSuggestion = { ...SUGGESTION, id: '1', name: 'Vieja' };
    const nueva: PlaceSuggestion = { ...SUGGESTION, id: '2', name: 'Nueva' };

    let resolve_vieja!: (v: PlaceSuggestion[]) => void;
    const promesa_vieja = new Promise<PlaceSuggestion[]>((res) => {
      resolve_vieja = res;
    });

    mock_search_places
      .mockReturnValueOnce(promesa_vieja)           // 1ª búsqueda: se queda colgada
      .mockResolvedValueOnce([nueva]);              // 2ª búsqueda: resuelve normal

    const { result } = await renderHook(() => usePlaceSearch());

    await act(async () => result.current.set_query('vi'));
    await advance(300);                              // dispara la 1ª (en vuelo)

    await act(async () => result.current.set_query('nueva'));
    await advance(300);                              // dispara y resuelve la 2ª
    expect(result.current.suggestions).toEqual([nueva]);

    await act(async () => {
      resolve_vieja([vieja]);                        // la 1ª llega TARDE
    });

    expect(result.current.suggestions).toEqual([nueva]);
  });

  it('(EC-H6) query_corta_vacia_sin_llamar: con resultados previos, teclear "p" → suggestions [] y CERO llamadas nuevas', async () => {
    mock_search_places.mockResolvedValue([SUGGESTION]);
    const { result } = await renderHook(() => usePlaceSearch());

    await act(async () => result.current.set_query('provi'));
    await advance(300);
    expect(result.current.suggestions).toEqual([SUGGESTION]);

    await act(async () => result.current.set_query('p'));
    await advance(300);

    expect(result.current.suggestions).toEqual([]);
    expect(mock_search_places).toHaveBeenCalledTimes(1);
  });

  it('(EC-H7) error_de_lib_expone_message: search_places lanza → error con message, suggestions [], loading false', async () => {
    mock_search_places.mockRejectedValue(new Error('se cayó la red'));
    const { result } = await renderHook(() => usePlaceSearch());

    await act(async () => result.current.set_query('provi'));
    await advance(300);

    expect(result.current.error).toBe('se cayó la red');
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-H8) clear_resetea_y_cancela_debounce: clear() con debounce pendiente → estado limpio y sin búsqueda fantasma', async () => {
    mock_search_places.mockResolvedValue([SUGGESTION]);
    const { result } = await renderHook(() => usePlaceSearch());

    await act(async () => result.current.set_query('provi'));
    await advance(300);
    expect(result.current.suggestions).toEqual([SUGGESTION]);

    await act(async () => result.current.set_query('otra'));     // deja un debounce pendiente
    await act(async () => result.current.clear());

    expect(result.current.query).toBe('');
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.error).toBeNull();

    await advance(300);                              // el timer cancelado NO dispara
    expect(mock_search_places).toHaveBeenCalledTimes(1);
  });
});
