/**
 * useZoneAutocomplete — hook de autocomplete de zona/colonia (#12.4).
 *
 * Carga las zonas distintas UNA vez al montar (fetch_distinct_zones) y expone
 * las sugerencias filtradas client-side (filter_zones) sobre el texto que el
 * usuario va tecleando, con debounce ~300ms. El valor final seleccionado es
 * una zona EXACTA de la lista cargada (política del vault — sin ILIKE en DB).
 *
 * ponytail: debounce manual con useRef (mismo patrón que AddressAutocomplete
 * en features/publish), sin dependencias nuevas. DI opcional de supabase
 * (vía ZonesDeps) para tests — en prod, fetch_distinct_zones hace lazy-require
 * del cliente singleton.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { fetch_distinct_zones, filter_zones, type ZonesDeps } from '../lib/zones';

const DEBOUNCE_MS = 300;

export interface UseZoneAutocompleteState {
  /** Texto tecleado por el usuario (controla el TextInput). */
  query: string;
  set_query: (text: string) => void;
  /** Sugerencias filtradas (debounced) de la lista completa de zonas. */
  suggestions: string[];
  /** true mientras se cargan las zonas desde la DB (una sola vez, al montar). */
  loading: boolean;
  error: string | null;
  /** Zona exacta seleccionada por el usuario, o null si no ha elegido ninguna. */
  selected_zone: string | null;
  select_zone: (zone: string | null) => void;
}

export function useZoneAutocomplete(deps?: ZonesDeps): UseZoneAutocompleteState {
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  const [query, set_query_raw] = useState('');
  const [suggestions, set_suggestions] = useState<string[]>([]);
  const [selected_zone, set_selected_zone] = useState<string | null>(null);

  // Lista completa cargada una vez; ref para que el debounce siempre filtre
  // sobre el dato más reciente sin re-crear el callback.
  const zones_ref = useRef<string[]>([]);
  const debounce_ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Carga inicial de zonas (una vez al montar) ─────────────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      set_loading(true);
      set_error(null);
      try {
        const result = await fetch_distinct_zones(deps);
        if (cancelled) return;
        zones_ref.current = result;
        set_suggestions(result);
      } catch (e) {
        if (cancelled) return;
        set_error(e instanceof Error ? e.message : 'Error al cargar zonas');
      } finally {
        if (!cancelled) set_loading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // ponytail: deps solo cambia en tests (DI); en prod es estable (singleton) — carga única
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Limpieza del timer de debounce al desmontar
  useEffect(() => {
    return () => {
      if (debounce_ref.current) clearTimeout(debounce_ref.current);
    };
  }, []);

  // ── Texto tecleado → filtrado debounced sobre la lista ya cargada ─────────
  const set_query = useCallback((text: string) => {
    set_query_raw(text);

    if (debounce_ref.current) clearTimeout(debounce_ref.current);
    debounce_ref.current = setTimeout(() => {
      set_suggestions(filter_zones(zones_ref.current, text));
    }, DEBOUNCE_MS);
  }, []);

  const select_zone = useCallback((zone: string | null) => {
    set_selected_zone(zone);
    set_query_raw(zone ?? '');
    set_suggestions(zones_ref.current);
  }, []);

  return { query, set_query, suggestions, loading, error, selected_zone, select_zone };
}
