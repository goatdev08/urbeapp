/**
 * addressPlaces.ts — Google Places API New para la sección "Direcciones" del
 * buscador unificado (#232.2).
 *
 * Recrea las llamadas de red de src/features/publish/components/
 * AddressAutocomplete.tsx (NO se importa ese componente — es JSX acoplado al
 * form del wizard de publicación; aquí se aísla la lógica de red pura y
 * testeable para que la reuse el buscador unificado, PlaceSearch.tsx).
 *
 * Contrato (ver __tests__/addressPlaces.test.ts):
 *   - has_google_places_key(deps?) → true solo con api_key no vacía.
 *   - fetch_address_predictions(query, deps?):
 *     · sin key, o query < 3 chars útiles (trim) → [] SIN round-trip
 *       (degradación silenciosa, igual que AddressAutocomplete).
 *     · POST .../v1/places:autocomplete, body {input, includedRegionCodes:['mx']}.
 *     · !ok o fetch rechaza → throw (el caller decide qué mostrar).
 *     · recorta a MAX_SUGGESTIONS (5, mismo techo que AddressAutocomplete).
 *   - fetch_place_location(place_id, deps?):
 *     · sin key → null.
 *     · GET .../v1/places/{placeId} + X-Goog-FieldMask: location.
 *     · location ausente/no finito → null; válido → {lat, lng}.
 *
 * ponytail: DI de fetch_impl + api_key (deps?) — mismo espíritu que el DI de
 * supabase en placeSearch.ts; en prod usa el fetch global + env var.
 */

const PLACES_AUTOCOMPLETE_URL = 'https://places.googleapis.com/v1/places:autocomplete';
const PLACES_DETAILS_URL = 'https://places.googleapis.com/v1/places';
const MIN_QUERY_LENGTH = 3;
const MAX_SUGGESTIONS = 5;

export interface AddressPlacesDeps {
  api_key?: string;
  fetch_impl?: typeof fetch;
}

export interface AddressPrediction {
  place_id: string;
  main_text: string;
  secondary_text: string | null;
}

type PlacePrediction = {
  placeId: string;
  text: { text: string };
  structuredFormat?: {
    mainText: { text: string };
    secondaryText?: { text: string };
  };
};

type AutocompleteResponse = {
  suggestions?: { placePrediction: PlacePrediction }[];
};

function resolve_api_key(deps?: AddressPlacesDeps): string {
  return deps?.api_key ?? process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY ?? '';
}

function resolve_fetch(deps?: AddressPlacesDeps): typeof fetch {
  return deps?.fetch_impl ?? fetch;
}

export function has_google_places_key(deps?: AddressPlacesDeps): boolean {
  return resolve_api_key(deps).length > 0;
}

/** Predicciones de dirección para lo tecleado. [] sin key o con < 3 chars. */
export async function fetch_address_predictions(
  query: string,
  deps?: AddressPlacesDeps,
): Promise<AddressPrediction[]> {
  const api_key = resolve_api_key(deps);
  const trimmed = query.trim();
  if (api_key.length === 0 || trimmed.length < MIN_QUERY_LENGTH) return [];

  const fetch_impl = resolve_fetch(deps);
  const res = await fetch_impl(PLACES_AUTOCOMPLETE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': api_key,
    },
    body: JSON.stringify({ input: trimmed, includedRegionCodes: ['mx'] }),
  });

  if (!res.ok) throw new Error(`Places autocomplete: ${res.status}`);

  const data = (await res.json()) as AutocompleteResponse;
  return (data.suggestions ?? []).slice(0, MAX_SUGGESTIONS).map(({ placePrediction }) => ({
    place_id: placePrediction.placeId,
    main_text: placePrediction.structuredFormat?.mainText.text ?? placePrediction.text.text,
    secondary_text: placePrediction.structuredFormat?.secondaryText?.text ?? null,
  }));
}

/** lat/lng de un place_id resuelto. null sin key o sin location válida. */
export async function fetch_place_location(
  place_id: string,
  deps?: AddressPlacesDeps,
): Promise<{ lat: number; lng: number } | null> {
  const api_key = resolve_api_key(deps);
  if (api_key.length === 0) return null;

  const fetch_impl = resolve_fetch(deps);
  const res = await fetch_impl(`${PLACES_DETAILS_URL}/${place_id}`, {
    method: 'GET',
    headers: {
      'X-Goog-Api-Key': api_key,
      'X-Goog-FieldMask': 'location',
    },
  });

  if (!res.ok) throw new Error(`Place details: ${res.status}`);

  const data = (await res.json()) as { location?: { latitude: number; longitude: number } };
  const loc = data.location;
  if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) return null;

  return { lat: loc.latitude, lng: loc.longitude };
}
