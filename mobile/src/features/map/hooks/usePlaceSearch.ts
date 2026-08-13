/**
 * usePlaceSearch — hook del autocomplete de lugares del mapa (#157.7).
 *
 * Espejo estructural de useZoneAutocomplete (debounce 300ms con useRef +
 * setTimeout, sin dependencias nuevas) con una diferencia de fondo: cada
 * búsqueda es un ROUND-TRIP de red (RPC search_places vía lib/placeSearch),
 * no un filtro client-side — el catálogo es nacional (~75k colonias DCAH).
 *
 * Guard ANTI-STALE: contador de request en ref; solo el response del ÚLTIMO
 * request setea suggestions/error. Sin él, la respuesta lenta de "provi"
 * pisaría la respuesta fresca de "providencia" (out-of-order clásico de
 * autocompletes con red). useZoneAutocomplete no lo necesita porque nunca
 * sale de memoria.
 *
 * Contrato completo en __tests__/usePlaceSearch.test.tsx (EC-H1..EC-H8).
 *
 * ponytail: DI opcional de deps (PlaceSearchDeps) para tests; en prod la lib
 * hace lazy-require del cliente singleton.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { search_places, type PlaceSearchDeps, type PlaceSuggestion } from '../lib/placeSearch';

const DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 2;

export interface UsePlaceSearchState {
  /** Texto tecleado (controla el TextInput — se actualiza inmediato). */
  query: string;
  set_query: (text: string) => void;
  /** Sugerencias del último request completado (debounced + anti-stale). */
  suggestions: PlaceSuggestion[];
  /** true mientras hay una búsqueda en vuelo. */
  loading: boolean;
  error: string | null;
  /** Resetea query/suggestions/error y cancela el debounce pendiente. */
  clear: () => void;
}

export function usePlaceSearch(deps?: PlaceSearchDeps): UsePlaceSearchState {
  const [query, set_query_raw] = useState('');
  const [suggestions, set_suggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const debounce_ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Anti-stale: cada búsqueda disparada incrementa el contador; el response
  // solo aplica si su id sigue siendo el vigente al resolver.
  const request_id_ref = useRef(0);

  // Limpieza al desmontar: cancela debounce e invalida cualquier request en vuelo.
  useEffect(() => {
    return () => {
      if (debounce_ref.current) clearTimeout(debounce_ref.current);
      request_id_ref.current += 1;
    };
  }, []);

  const run_search = useCallback(
    async (text: string) => {
      const request_id = ++request_id_ref.current;
      set_loading(true);
      set_error(null);
      try {
        const result = await search_places(text, deps);
        if (request_id !== request_id_ref.current) return; // response viejo — descartar
        set_suggestions(result);
      } catch (e) {
        if (request_id !== request_id_ref.current) return;
        set_error(e instanceof Error ? e.message : 'Error al buscar lugares');
        set_suggestions([]);
      } finally {
        if (request_id === request_id_ref.current) set_loading(false);
      }
    },
    // ponytail: deps solo cambia en tests (DI); en prod es undefined estable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const set_query = useCallback(
    (text: string) => {
      set_query_raw(text);

      if (debounce_ref.current) clearTimeout(debounce_ref.current);
      debounce_ref.current = setTimeout(() => {
        if (text.trim().length < MIN_QUERY_LENGTH) {
          // Query corta: limpiar sin round-trip e invalidar lo que esté en vuelo.
          request_id_ref.current += 1;
          set_suggestions([]);
          set_loading(false);
          set_error(null);
          return;
        }
        void run_search(text);
      }, DEBOUNCE_MS);
    },
    [run_search],
  );

  const clear = useCallback(() => {
    if (debounce_ref.current) clearTimeout(debounce_ref.current);
    request_id_ref.current += 1; // invalida requests en vuelo
    set_query_raw('');
    set_suggestions([]);
    set_loading(false);
    set_error(null);
  }, []);

  return { query, set_query, suggestions, loading, error, clear };
}
