/**
 * Tests fase RED — useAddressZoneResolver (#232.2)
 * Archivo SUT: mobile/src/features/map/hooks/useAddressZoneResolver.ts
 *
 * Envuelve resolve_address_to_zone (lib crítica ya probada) con estado de
 * loading/error para la UI — el componente NUNCA hace try/catch directo,
 * solo lee `resolving`/`resolve_error` y reacciona al valor devuelto por
 * `resolve(place_id)`.
 *
 * Contrato:
 *   - resolve(place_id) → resolving=true, resolve_error=null durante el
 *     round-trip.
 *   - resultado 'resolved' → resolving=false, resolve_error=null, devuelve
 *     { kind: 'resolved', zone, point }.
 *   - resultado 'out_of_coverage' → resolving=false, resolve_error = el copy
 *     pinneado ("Esa dirección está fuera de las zonas disponibles por
 *     ahora"), devuelve { kind: 'out_of_coverage', point }.
 *   - la lib LANZA (network/RPC) → resolving=false, resolve_error = message
 *     de la excepción (nunca crashea), devuelve { kind: 'error' }.
 *   - ANTI-STALE: un 2do resolve() disparado antes de que el 1ro termine —
 *     solo el estado (resolving/resolve_error) del ÚLTIMO gana; el valor
 *     RETORNADO de cada llamada es siempre el de ESA llamada (el caller que
 *     hizo tap ya sabe qué predicción tocó).
 *
 * EDGE CASES:
 * - (EC-AZ1) resuelve_a_zona_estado_limpio
 * - (EC-AZ2) fuera_de_cobertura_setea_mensaje_pinneado
 * - (EC-AZ3) error_de_lib_setea_message_y_no_crashea
 * - (EC-AZ4) resolving_true_durante_el_round_trip
 * - (EC-AZ5) anti_stale_solo_el_ultimo_actualiza_el_estado
 */

import { act, renderHook } from '@testing-library/react-native';

import { useAddressZoneResolver } from '../hooks/useAddressZoneResolver';
import type { PlaceSuggestion } from '../lib/placeSearch';

jest.mock('../lib/resolveAddressZone', () => ({
  resolve_address_to_zone: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const mock_resolve = (require('../lib/resolveAddressZone') as {
  resolve_address_to_zone: jest.Mock;
}).resolve_address_to_zone;

const ZONE: PlaceSuggestion = {
  kind: 'neighborhood',
  id: '42',
  name: 'Providencia',
  context: 'Guadalajara, Jal.',
  bbox: null,
};
const POINT = { lat: 20.7, lng: -103.37 };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useAddressZoneResolver — estado de resolución dirección→zona (#232)', () => {
  it('(EC-AZ1) resuelve_a_zona_estado_limpio', async () => {
    mock_resolve.mockResolvedValue({ kind: 'resolved', zone: ZONE, point: POINT });
    const { result } = await renderHook(() => useAddressZoneResolver());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.resolve('place-1');
    });

    expect(returned).toEqual({ kind: 'resolved', zone: ZONE, point: POINT });
    expect(result.current.resolving).toBe(false);
    expect(result.current.resolve_error).toBeNull();
  });

  it('(EC-AZ2) fuera_de_cobertura_setea_mensaje_pinneado', async () => {
    mock_resolve.mockResolvedValue({ kind: 'out_of_coverage', point: POINT });
    const { result } = await renderHook(() => useAddressZoneResolver());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.resolve('place-2');
    });

    expect(returned).toEqual({ kind: 'out_of_coverage', point: POINT });
    expect(result.current.resolve_error).toBe(
      'Esa dirección está fuera de las zonas disponibles por ahora',
    );
    expect(result.current.resolving).toBe(false);
  });

  it('(EC-AZ3) error_de_lib_setea_message_y_no_crashea', async () => {
    mock_resolve.mockRejectedValue(new Error('No se pudo obtener la ubicación de esa dirección'));
    const { result } = await renderHook(() => useAddressZoneResolver());

    let returned: unknown;
    await act(async () => {
      returned = await result.current.resolve('place-3');
    });

    expect(returned).toEqual({ kind: 'error' });
    expect(result.current.resolve_error).toBe('No se pudo obtener la ubicación de esa dirección');
    expect(result.current.resolving).toBe(false);
  });

  it('(EC-AZ4) resolving_true_durante_el_round_trip', async () => {
    let resolve_promise!: (v: unknown) => void;
    mock_resolve.mockReturnValue(
      new Promise((res) => {
        resolve_promise = res;
      }),
    );
    const { result } = await renderHook(() => useAddressZoneResolver());

    let call_promise!: Promise<unknown>;
    await act(async () => {
      call_promise = result.current.resolve('place-4');
      await Promise.resolve(); // deja que el estado resolving=true se aplique
    });

    expect(result.current.resolving).toBe(true);

    await act(async () => {
      resolve_promise({ kind: 'resolved', zone: ZONE, point: POINT });
      await call_promise;
    });

    expect(result.current.resolving).toBe(false);
  });

  it('(EC-AZ5) anti_stale_solo_el_ultimo_actualiza_el_estado', async () => {
    let resolve_first!: (v: unknown) => void;
    const first_promise = new Promise((res) => {
      resolve_first = res;
    });
    mock_resolve
      .mockReturnValueOnce(first_promise)
      .mockResolvedValueOnce({ kind: 'out_of_coverage', point: POINT });

    const { result } = await renderHook(() => useAddressZoneResolver());

    let first_call!: Promise<unknown>;
    await act(async () => {
      first_call = result.current.resolve('place-a'); // queda en vuelo
    });

    let second_returned: unknown;
    await act(async () => {
      second_returned = await result.current.resolve('place-b'); // resuelve YA
    });

    expect(second_returned).toEqual({ kind: 'out_of_coverage', point: POINT });
    expect(result.current.resolve_error).toBe(
      'Esa dirección está fuera de las zonas disponibles por ahora',
    );

    // La 1ra llamada resuelve TARDE con 'resolved' — su valor de retorno es
    // el suyo (el caller de ESA llamada ya sabe qué tocó), pero NO debe
    // pisar el estado resolve_error ya asentado por la 2da (más nueva).
    let first_returned: unknown;
    await act(async () => {
      resolve_first({ kind: 'resolved', zone: ZONE, point: POINT });
      first_returned = await first_call;
    });

    expect(first_returned).toEqual({ kind: 'resolved', zone: ZONE, point: POINT });
    expect(result.current.resolve_error).toBe(
      'Esa dirección está fuera de las zonas disponibles por ahora',
    );
  });
});
