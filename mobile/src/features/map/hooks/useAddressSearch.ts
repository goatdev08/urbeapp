/**
 * useAddressSearch — predicciones de dirección dirigidas por query externa
 * (#232.2, sección "Direcciones" del buscador unificado).
 *
 * A diferencia de usePlaceSearch (que POSEE su propio `query`/`set_query`),
 * este hook recibe `query` como argumento: el buscador unificado tiene UN
 * solo input, y PlaceSearch.tsx lo usa junto con usePlaceSearch (catálogo)
 * sobre el MISMO texto — dos búsquedas independientes, un solo TextInput.
 * El debounce corre en un useEffect keyed por `query` (se cancela y
 * reprograma en cada cambio; RN limpia el timer anterior automáticamente).
 *
 * Guard ANTI-STALE: mismo patrón que usePlaceSearch — un contador de
 * request en ref; solo la respuesta del ÚLTIMO request setea predictions.
 *
 * Contrato completo en __tests__/useAddressSearch.test.tsx (EC-AS1..EC-AS7).
 */

import { useEffect, useRef, useState } from 'react';

import {
  fetch_address_predictions,
  has_google_places_key,
  type AddressPlacesDeps,
  type AddressPrediction,
} from '../lib/addressPlaces';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;

export interface UseAddressSearchState {
  predictions: AddressPrediction[];
  loading: boolean;
  error: string | null;
  /** true si hay API key configurada — sin ella la sección no aparece. */
  available: boolean;
}

export function useAddressSearch(query: string, deps?: AddressPlacesDeps): UseAddressSearchState {
  const [predictions, set_predictions] = useState<AddressPrediction[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const request_id_ref = useRef(0);

  const available = has_google_places_key(deps);

  useEffect(() => {
    const trimmed = query.trim();

    if (!available || trimmed.length < MIN_QUERY_LENGTH) {
      request_id_ref.current += 1; // invalida cualquier request en vuelo
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset síncrono del guard (query corta/sin key): no dispara fetch, solo limpia estado ya obsoleto antes de la próxima búsqueda.
      set_predictions([]);
      set_loading(false);
      set_error(null);
      return;
    }

    const request_id = ++request_id_ref.current;
    set_loading(true);
    set_error(null);

    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await fetch_address_predictions(trimmed, deps);
          if (request_id !== request_id_ref.current) return; // respuesta vieja — descartar
          set_predictions(result);
        } catch (e) {
          if (request_id !== request_id_ref.current) return;
          set_error(e instanceof Error ? e.message : 'Error al buscar direcciones');
          set_predictions([]);
        } finally {
          if (request_id === request_id_ref.current) set_loading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // ponytail: `deps` solo cambia en tests (DI); en prod es undefined estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, available]);

  return { predictions, loading, error, available };
}
