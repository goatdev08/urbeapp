/**
 * Tests fase RED — addressPlaces (Google Places API New, sección "Direcciones"
 * del buscador unificado, #232.2)
 * Archivo SUT: mobile/src/features/map/lib/addressPlaces.ts
 *
 * Mismas 3 llamadas que src/features/publish/components/AddressAutocomplete.tsx
 * (NO se importa ese componente — se recrea la lógica de red aquí, testeable
 * y sin JSX, para que PlaceSearch.tsx la reuse):
 *   - Autocomplete (New): POST .../v1/places:autocomplete
 *     body { input, includedRegionCodes: ['mx'] }, header X-Goog-Api-Key.
 *   - Place Details (New): GET .../v1/places/{placeId} + X-Goog-FieldMask: location.
 *
 * Contrato:
 *   - has_google_places_key(deps?) → true solo si hay api_key (env o deps.api_key).
 *   - fetch_address_predictions(query, deps?):
 *     · sin key → [] SIN round-trip.
 *     · query < 3 caracteres (tras trim) → [] SIN round-trip (mismo MIN que
 *       AddressAutocomplete.MIN_GEOCODE_LEN... en realidad MAX_SUGGESTIONS/
 *       min de autocomplete es 3, ver AddressAutocomplete fetch_suggestions).
 *     · !res.ok → throw Error con el status.
 *     · red caída (fetch rechaza) → throw.
 *     · respuesta ok → mapea suggestions[].placePrediction a AddressPrediction,
 *       recortado a 5 (MAX_SUGGESTIONS, mismo techo que AddressAutocomplete).
 *   - fetch_place_location(place_id, deps?):
 *     · sin key → null (degradación silenciosa).
 *     · !res.ok → throw.
 *     · location ausente o no finito → null.
 *     · location válido → {lat, lng}.
 *
 * EDGE CASES:
 * - (EC-AP1) sin_key_predictions_vacio_sin_fetch
 * - (EC-AP2) query_corta_vacio_sin_fetch
 * - (EC-AP3) query_valida_llama_autocomplete_con_body_correcto
 * - (EC-AP4) respuesta_ok_mapea_predictions_recortadas_a_5
 * - (EC-AP5) respuesta_no_ok_lanza
 * - (EC-AP6) fetch_rechaza_lanza
 * - (EC-AP7) sin_key_location_null_sin_fetch
 * - (EC-AP8) location_valido_devuelve_lat_lng
 * - (EC-AP9) location_ausente_devuelve_null
 */

import {
  fetch_address_predictions,
  fetch_place_location,
  has_google_places_key,
} from '../lib/addressPlaces';

function make_fetch_impl(response: { ok: boolean; status?: number; json: () => Promise<unknown> }) {
  return jest.fn().mockResolvedValue(response);
}

const DEPS = { api_key: 'test-key' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('has_google_places_key', () => {
  it('sin api_key → false; con api_key → true', () => {
    expect(has_google_places_key({ api_key: '' })).toBe(false);
    expect(has_google_places_key({ api_key: 'abc' })).toBe(true);
  });
});

describe('fetch_address_predictions — autocomplete de direcciones (#232)', () => {
  it('(EC-AP1) sin_key_predictions_vacio_sin_fetch', async () => {
    const fetch_impl = make_fetch_impl({ ok: true, json: async () => ({ suggestions: [] }) });

    const result = await fetch_address_predictions('Av. Chapultepec 123', {
      api_key: '',
      fetch_impl,
    });

    expect(result).toEqual([]);
    expect(fetch_impl).not.toHaveBeenCalled();
  });

  it('(EC-AP2) query_corta_vacio_sin_fetch: 2 caracteres → [] sin round-trip', async () => {
    const fetch_impl = make_fetch_impl({ ok: true, json: async () => ({ suggestions: [] }) });

    const result = await fetch_address_predictions('Av', { ...DEPS, fetch_impl });

    expect(result).toEqual([]);
    expect(fetch_impl).not.toHaveBeenCalled();
  });

  it('(EC-AP3) query_valida_llama_autocomplete_con_body_correcto', async () => {
    const fetch_impl = make_fetch_impl({ ok: true, json: async () => ({ suggestions: [] }) });

    await fetch_address_predictions('Av. Chapultepec 123', { ...DEPS, fetch_impl });

    expect(fetch_impl).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places:autocomplete',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-Goog-Api-Key': 'test-key' }),
        body: JSON.stringify({ input: 'Av. Chapultepec 123', includedRegionCodes: ['mx'] }),
      }),
    );
  });

  it('(EC-AP4) respuesta_ok_mapea_predictions_recortadas_a_5', async () => {
    const raw = Array.from({ length: 7 }, (_, i) => ({
      placePrediction: {
        placeId: `place-${i}`,
        text: { text: `Dirección ${i}` },
        structuredFormat: {
          mainText: { text: `Calle ${i}` },
          secondaryText: { text: 'Guadalajara, Jal.' },
        },
      },
    }));
    const fetch_impl = make_fetch_impl({ ok: true, json: async () => ({ suggestions: raw }) });

    const result = await fetch_address_predictions('Calle Providencia', { ...DEPS, fetch_impl });

    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({
      place_id: 'place-0',
      main_text: 'Calle 0',
      secondary_text: 'Guadalajara, Jal.',
    });
  });

  it('(EC-AP5) respuesta_no_ok_lanza', async () => {
    const fetch_impl = make_fetch_impl({ ok: false, status: 403, json: async () => ({}) });

    await expect(
      fetch_address_predictions('Calle Providencia', { ...DEPS, fetch_impl }),
    ).rejects.toThrow();
  });

  it('(EC-AP6) fetch_rechaza_lanza: red caída → throw', async () => {
    const fetch_impl = jest.fn().mockRejectedValue(new Error('network down'));

    await expect(
      fetch_address_predictions('Calle Providencia', { ...DEPS, fetch_impl }),
    ).rejects.toThrow();
  });
});

describe('fetch_place_location — Place Details New (#232)', () => {
  it('(EC-AP7) sin_key_location_null_sin_fetch', async () => {
    const fetch_impl = make_fetch_impl({ ok: true, json: async () => ({}) });

    const result = await fetch_place_location('place-1', { api_key: '', fetch_impl });

    expect(result).toBeNull();
    expect(fetch_impl).not.toHaveBeenCalled();
  });

  it('(EC-AP8) location_valido_devuelve_lat_lng', async () => {
    const fetch_impl = make_fetch_impl({
      ok: true,
      json: async () => ({ location: { latitude: 20.67, longitude: -103.35 } }),
    });

    const result = await fetch_place_location('place-1', { ...DEPS, fetch_impl });

    expect(result).toEqual({ lat: 20.67, lng: -103.35 });
    expect(fetch_impl).toHaveBeenCalledWith(
      'https://places.googleapis.com/v1/places/place-1',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          'X-Goog-Api-Key': 'test-key',
          'X-Goog-FieldMask': 'location',
        }),
      }),
    );
  });

  it('(EC-AP9) location_ausente_devuelve_null', async () => {
    const fetch_impl = make_fetch_impl({ ok: true, json: async () => ({}) });

    const result = await fetch_place_location('place-1', { ...DEPS, fetch_impl });

    expect(result).toBeNull();
  });
});
