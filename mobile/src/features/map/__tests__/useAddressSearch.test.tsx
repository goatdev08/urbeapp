/**
 * Tests fase RED — useAddressSearch (#232.2)
 * Archivo SUT: mobile/src/features/map/hooks/useAddressSearch.ts
 *
 * A diferencia de usePlaceSearch (que POSEE su propio `query`/`set_query`),
 * este hook es EXTERNAMENTE dirigido: recibe `query` como argumento (el
 * mismo texto que ya controla usePlaceSearch en el padre — un solo input,
 * dos búsquedas independientes) y debounce-ea vía useEffect+setTimeout cada
 * vez que `query` cambia entre renders.
 *
 * Contrato:
 *   - available = has_google_places_key(deps).
 *   - !available, o query < 3 chars útiles → predictions [] SIN round-trip
 *     (ni siquiera arranca el debounce).
 *   - Tras 300ms sin cambios de query → fetch_address_predictions(query, deps).
 *   - Cambios de query dentro de los 300ms cancelan el timer anterior (solo
 *     la ÚLTIMA query dispara el round-trip).
 *   - Anti-stale: un cambio de query mientras una búsqueda sigue en vuelo
 *     invalida esa respuesta al llegar (no pisa el estado más nuevo).
 *   - loading true mientras hay round-trip en vuelo; error con el message si
 *     la lib lanza.
 *
 * ⚠️ Gotcha del repo (memoria rntl_unmount_fuera_de_act): timers/promesas
 * dentro de act.
 *
 * EDGE CASES:
 * - (EC-AS1) sin_key_predictions_vacio_sin_llamar
 * - (EC-AS2) query_corta_vacio_sin_llamar
 * - (EC-AS3) debounce_300ms_una_llamada
 * - (EC-AS4) tecleos_rapidos_solo_ultima_query
 * - (EC-AS5) resultados_pueblan_predictions
 * - (EC-AS6) anti_stale_respuesta_vieja_no_pisa_la_nueva
 * - (EC-AS7) error_de_lib_expone_message
 */

import { act, renderHook } from '@testing-library/react-native';

import { useAddressSearch } from '../hooks/useAddressSearch';
import type { AddressPrediction } from '../lib/addressPlaces';

jest.mock('../lib/addressPlaces', () => ({
  fetch_address_predictions: jest.fn(),
  has_google_places_key: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mocked = require('../lib/addressPlaces') as {
  fetch_address_predictions: jest.Mock;
  has_google_places_key: jest.Mock;
};

const PREDICTION: AddressPrediction = {
  place_id: 'place-1',
  main_text: 'Av. Chapultepec 123',
  secondary_text: 'Guadalajara, Jal.',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mocked.has_google_places_key.mockReturnValue(true);
  mocked.fetch_address_predictions.mockResolvedValue([]);
});

afterEach(() => {
  jest.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('useAddressSearch — predicciones de dirección dirigidas por query externa (#232)', () => {
  it('(EC-AS1) sin_key_predictions_vacio_sin_llamar', async () => {
    mocked.has_google_places_key.mockReturnValue(false);

    const { result } = await renderHook(() => useAddressSearch('Av. Chapultepec'));
    await advance(300);

    expect(result.current.available).toBe(false);
    expect(result.current.predictions).toEqual([]);
    expect(mocked.fetch_address_predictions).not.toHaveBeenCalled();
  });

  it('(EC-AS2) query_corta_vacio_sin_llamar: 2 chars → sin round-trip', async () => {
    const { result } = await renderHook(() => useAddressSearch('Av'));
    await advance(300);

    expect(result.current.predictions).toEqual([]);
    expect(mocked.fetch_address_predictions).not.toHaveBeenCalled();
  });

  it('(EC-AS3) debounce_300ms_una_llamada', async () => {
    const { rerender } = await renderHook(({ query }) => useAddressSearch(query), {
      initialProps: { query: '' },
    });

    await act(async () => rerender({ query: 'Av. Chapultepec' }));
    expect(mocked.fetch_address_predictions).not.toHaveBeenCalled();

    await advance(299);
    expect(mocked.fetch_address_predictions).not.toHaveBeenCalled();

    await advance(1);
    expect(mocked.fetch_address_predictions).toHaveBeenCalledTimes(1);
    expect(mocked.fetch_address_predictions.mock.calls[0][0]).toBe('Av. Chapultepec');
  });

  it('(EC-AS4) tecleos_rapidos_solo_ultima_query', async () => {
    const { rerender } = await renderHook(({ query }) => useAddressSearch(query), {
      initialProps: { query: '' },
    });

    await act(async () => rerender({ query: 'Av' }));
    await advance(100);
    await act(async () => rerender({ query: 'Av. Ch' }));
    await advance(100);
    await act(async () => rerender({ query: 'Av. Chapultepec' }));
    await advance(300);

    expect(mocked.fetch_address_predictions).toHaveBeenCalledTimes(1);
    expect(mocked.fetch_address_predictions.mock.calls[0][0]).toBe('Av. Chapultepec');
  });

  it('(EC-AS5) resultados_pueblan_predictions', async () => {
    mocked.fetch_address_predictions.mockResolvedValue([PREDICTION]);
    const { result, rerender } = await renderHook(({ query }) => useAddressSearch(query), {
      initialProps: { query: '' },
    });

    await act(async () => rerender({ query: 'Av. Chapultepec' }));
    await advance(300);

    expect(result.current.predictions).toEqual([PREDICTION]);
    expect(result.current.loading).toBe(false);
  });

  it('(EC-AS6) anti_stale_respuesta_vieja_no_pisa_la_nueva', async () => {
    let resolve_first!: (v: AddressPrediction[]) => void;
    const first_promise = new Promise<AddressPrediction[]>((resolve) => {
      resolve_first = resolve;
    });
    mocked.fetch_address_predictions
      .mockImplementationOnce(() => first_promise)
      .mockImplementationOnce(async () => [PREDICTION]);

    const { result, rerender } = await renderHook(({ query }) => useAddressSearch(query), {
      initialProps: { query: '' },
    });

    await act(async () => rerender({ query: 'Av' }));
    await advance(300); // dispara la 1ra búsqueda ("Av"), queda en vuelo

    await act(async () => rerender({ query: 'Av. Chapultepec' }));
    await advance(300); // dispara la 2da búsqueda, resuelve YA (mock 2)

    expect(result.current.predictions).toEqual([PREDICTION]);

    // La 1ra búsqueda resuelve TARDE — no debe pisar el estado ya poblado.
    await act(async () => {
      resolve_first([]);
      await Promise.resolve();
    });

    expect(result.current.predictions).toEqual([PREDICTION]);
  });

  it('(EC-AS7) error_de_lib_expone_message', async () => {
    mocked.fetch_address_predictions.mockRejectedValue(new Error('Places autocomplete: 500'));
    const { result, rerender } = await renderHook(({ query }) => useAddressSearch(query), {
      initialProps: { query: '' },
    });

    await act(async () => rerender({ query: 'Av. Chapultepec' }));
    await advance(300);

    expect(result.current.error).toBe('Places autocomplete: 500');
    expect(result.current.predictions).toEqual([]);
  });
});
