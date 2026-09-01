/**
 * Tests fase RED — resolve_address_to_zone (#232.2)
 * Archivo SUT: mobile/src/features/map/lib/resolveAddressZone.ts
 *
 * 🔴 CRÍTICA (CLAUDE.md §5): orquesta dirección → zona de catálogo
 * (geocode → RPC → resultado|fuera-de-cobertura) — el corazón del contrato
 * "la zona guardada SIEMPRE es de catálogo, jamás inventada" (#232).
 *
 * Contrato:
 *   1. fetch_place_location(place_id, deps.address) → point | null.
 *      · null (sin location resoluble) → throw Error('no se pudo obtener la
 *        ubicación de esa dirección') — degradación distinguible de "fuera
 *        de cobertura" (ese SÍ tiene point, este NO).
 *   2. resolve_place_at_point(point.lat, point.lng, deps.zone) → zone | null.
 *      · null → { kind: 'out_of_coverage', point } (NUNCA se inventa zona).
 *      · zone → { kind: 'resolved', zone, point }.
 *   3. Cualquier error de las libs subyacentes (fetch_place_location o
 *      resolve_place_at_point lanzan) se propaga tal cual — el caller decide
 *      el mensaje (mismo criterio que placeSearch/placeAtPoint: throw, no
 *      texto neutro aquí).
 *
 * EDGE CASES:
 * - (EC-RZ1) direccion_resuelve_a_colonia_de_catalogo
 * - (EC-RZ2) direccion_resuelve_a_municipio_de_catalogo
 * - (EC-RZ3) cero_filas_de_place_at_point_es_out_of_coverage_con_point
 * - (EC-RZ4) sin_location_lanza_mensaje_distinguible
 * - (EC-RZ5) error_de_place_at_point_se_propaga
 * - (EC-RZ6) error_de_fetch_location_se_propaga
 */

import { resolve_address_to_zone } from '../lib/resolveAddressZone';
import type { PlaceSuggestion } from '../lib/placeSearch';

const mock_fetch_place_location = jest.fn();
const mock_resolve_place_at_point = jest.fn();

jest.mock('../lib/addressPlaces', () => ({
  fetch_place_location: (...args: unknown[]) => mock_fetch_place_location(...args),
}));

jest.mock('../lib/placeAtPoint', () => ({
  resolve_place_at_point: (...args: unknown[]) => mock_resolve_place_at_point(...args),
}));

const NEIGHBORHOOD: PlaceSuggestion = {
  kind: 'neighborhood',
  id: '42',
  name: 'Providencia',
  context: 'Guadalajara, Jal.',
  bbox: { min_lat: 20.69, min_lng: -103.38, max_lat: 20.71, max_lng: -103.36 },
};

const MUNICIPALITY: PlaceSuggestion = {
  kind: 'municipality',
  id: '14039',
  name: 'Guadalajara',
  context: 'Jalisco',
  bbox: null,
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('resolve_address_to_zone — orquestación dirección→zona (#232)', () => {
  it('(EC-RZ1) direccion_resuelve_a_colonia_de_catalogo', async () => {
    mock_fetch_place_location.mockResolvedValue({ lat: 20.7, lng: -103.37 });
    mock_resolve_place_at_point.mockResolvedValue(NEIGHBORHOOD);

    const result = await resolve_address_to_zone('place-1');

    expect(mock_fetch_place_location).toHaveBeenCalledWith('place-1', undefined);
    expect(mock_resolve_place_at_point).toHaveBeenCalledWith(20.7, -103.37, undefined);
    expect(result).toEqual({
      kind: 'resolved',
      zone: NEIGHBORHOOD,
      point: { lat: 20.7, lng: -103.37 },
    });
  });

  it('(EC-RZ2) direccion_resuelve_a_municipio_de_catalogo (fallback bbox de menor área, #232.1)', async () => {
    mock_fetch_place_location.mockResolvedValue({ lat: 19.0, lng: -99.0 });
    mock_resolve_place_at_point.mockResolvedValue(MUNICIPALITY);

    const result = await resolve_address_to_zone('place-2');

    expect(result).toEqual({
      kind: 'resolved',
      zone: MUNICIPALITY,
      point: { lat: 19.0, lng: -99.0 },
    });
  });

  it('(EC-RZ3) cero_filas_de_place_at_point_es_out_of_coverage_con_point', async () => {
    mock_fetch_place_location.mockResolvedValue({ lat: 32.5, lng: -117.0 });
    mock_resolve_place_at_point.mockResolvedValue(null);

    const result = await resolve_address_to_zone('place-3');

    expect(result).toEqual({ kind: 'out_of_coverage', point: { lat: 32.5, lng: -117.0 } });
  });

  it('(EC-RZ4) sin_location_lanza_mensaje_distinguible: fetch_place_location null → throw', async () => {
    mock_fetch_place_location.mockResolvedValue(null);

    await expect(resolve_address_to_zone('place-4')).rejects.toThrow(
      /ubicaci[oó]n/i,
    );
    expect(mock_resolve_place_at_point).not.toHaveBeenCalled();
  });

  it('(EC-RZ5) error_de_place_at_point_se_propaga', async () => {
    mock_fetch_place_location.mockResolvedValue({ lat: 20.7, lng: -103.37 });
    mock_resolve_place_at_point.mockRejectedValue(new Error('se cayó place_at_point'));

    await expect(resolve_address_to_zone('place-5')).rejects.toThrow('se cayó place_at_point');
  });

  it('(EC-RZ6) error_de_fetch_location_se_propaga', async () => {
    mock_fetch_place_location.mockRejectedValue(new Error('Place details: 500'));

    await expect(resolve_address_to_zone('place-6')).rejects.toThrow('Place details: 500');
    expect(mock_resolve_place_at_point).not.toHaveBeenCalled();
  });
});
