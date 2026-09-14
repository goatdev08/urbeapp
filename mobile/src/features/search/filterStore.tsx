/**
 * filterStore.tsx — Context + Provider + hook para el estado de filtros del feed/mapa (#12.6/#12.7).
 *
 * Patrón: igual que features/publish/store/PublishFormContext.tsx y features/auth/context.tsx
 *   - Context con undefined como default → el hook lanza si se usa fuera del Provider.
 *   - Estado con useReducer (set_filter por campo + clear_filters + hydrate).
 *   - active_filter_count derivado de get_active_filter_count (lib/filterQuery.ts).
 *   - Persistencia (#12.7): hidrata desde AsyncStorage al montar (load_filters,
 *     fail-safe → EMPTY_FILTERS) y persiste en cada cambio con debounce de 500ms
 *     (save_filters) tras completar la hidratación inicial.
 *
 * FeedTab (#296.3 — sustituye la `section` de 2 valores de #241.1): el eje de
 *   FUENTE del feed (Para ti · Siguiendo · Nuevos · Venta · Renta) vive como
 *   estado PROPIO `feed_tab`, SEPARADO del reducer de FilterState (nunca entra
 *   como key — el mapa no debe heredar «Siguiendo»). Los `filters` que el
 *   contexto expone son SIEMPRE `with_tab(raw, feed_tab)`: operation_types
 *   derivado, el tab manda incluso sobre un JSON de filtros legacy persistido
 *   antes de #296. `feed_tab` se hidrata por su cuenta (feedTabStorage.ts,
 *   fail-safe → 'para_ti') y se persiste de INMEDIATO en `set_feed_tab` (sin
 *   debounce: un tap de tab es un evento discreto, no una escritura continua
 *   como el sheet de filtros — decisión ponytail, /tm-plan 296). `clear_filters`
 *   ya no necesita conservar nada del tab explícitamente: al no tocar
 *   `feed_tab`, la derivación lo conserva sola.
 *
 * NO conecta el FilterSheet a este Context (eso es el wiring de FilterSheet.tsx).
 *
 * ponytail: React Context estándar — no Zustand (ya usado en el repo para stores
 *   de feature con este mismo tamaño; cero dependencias nuevas).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { DEFAULT_FEED_TAB, with_tab, type FeedTab } from './lib/feedSection';
import { EMPTY_FILTERS, get_active_filter_count } from './lib/filterQuery';
import { load_filters, save_filters } from './lib/filterStorage';
import { load_feed_tab, save_feed_tab } from './lib/feedTabStorage';
import type { FilterState } from './types';

/** Debounce de escritura a AsyncStorage — evita un write por cada tecla/tap. */
const PERSIST_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// Contrato del contexto
// ---------------------------------------------------------------------------

export interface FilterContextValue {
  filters: FilterState;
  /** Actualiza un solo campo del estado de filtros. */
  set_filter: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
  /** Resetea los filtros a EMPTY_FILTERS conservando el feed_tab (#296.3). */
  clear_filters: () => void;
  /** Conteo de grupos de filtro activos (badge del FilterSheet). El tab no cuenta. */
  active_filter_count: number;
  /** Tab del feed activo — estado propio, NUNCA dentro de FilterState (#296.3). */
  feed_tab: FeedTab;
  /** Cambia de tab: deriva operation_types y persiste de inmediato. */
  set_feed_tab: (tab: FeedTab) => void;
}

// ---------------------------------------------------------------------------
// Reducer — SOLO FilterState; el feed_tab vive fuera (useState propio abajo).
// ---------------------------------------------------------------------------

type FilterAction =
  | { type: 'set_filter'; key: keyof FilterState; value: FilterState[keyof FilterState] }
  | { type: 'clear_filters' }
  | { type: 'hydrate'; filters: FilterState };

function filter_reducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'set_filter':
      return { ...state, [action.key]: action.value };
    case 'clear_filters':
      return EMPTY_FILTERS;
    case 'hydrate':
      return action.filters;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Context — undefined activa el guard del hook
// ---------------------------------------------------------------------------

const FilterContext = createContext<FilterContextValue | undefined>(undefined);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function FilterProvider({ children }: { children: React.ReactNode }) {
  const [raw_filters, dispatch] = useReducer(filter_reducer, EMPTY_FILTERS);
  const [feed_tab, set_feed_tab_state] = useState<FeedTab>(DEFAULT_FEED_TAB);
  // ponytail: refs (no state) — no necesitan disparar render propio.
  const is_hydrated = useRef(false);
  const debounce_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hidrata filtros + feed_tab desde AsyncStorage al montar (una sola vez,
  // dos fuentes independientes). Ambas cargas son fail-safe (nunca lanzan en
  // producción); el .catch es un guard defensivo adicional para que un
  // rechazo inesperado de load_feed_tab no rompa el provider (EC-ST-4).
  useEffect(() => {
    let cancelled = false;
    load_filters()
      .then((loaded) => {
        if (cancelled) return;
        dispatch({ type: 'hydrate', filters: loaded });
      })
      .finally(() => {
        if (!cancelled) is_hydrated.current = true;
      });
    load_feed_tab()
      .then((loaded) => {
        if (cancelled) return;
        set_feed_tab_state(loaded);
      })
      .catch(() => {
        // fail-safe: se queda en DEFAULT_FEED_TAB.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persiste con debounce en cada cambio, solo tras completar la hidratación
  // inicial (evita pisar el valor guardado con el EMPTY_FILTERS de arranque).
  useEffect(() => {
    if (!is_hydrated.current) return;
    if (debounce_timer.current) clearTimeout(debounce_timer.current);
    debounce_timer.current = setTimeout(() => {
      void save_filters(raw_filters);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (debounce_timer.current) clearTimeout(debounce_timer.current);
    };
  }, [raw_filters]);

  const set_filter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      dispatch({ type: 'set_filter', key, value });
    },
    [],
  );

  const clear_filters = useCallback(() => {
    dispatch({ type: 'clear_filters' });
  }, []);

  // Un tap de tab es un evento discreto (no una escritura continua como el
  // sheet) → persiste de inmediato, sin el debounce de save_filters.
  const set_feed_tab = useCallback((tab: FeedTab) => {
    set_feed_tab_state(tab);
    void save_feed_tab(tab);
  }, []);

  const filters = useMemo(() => with_tab(raw_filters, feed_tab), [raw_filters, feed_tab]);
  const active_filter_count = useMemo(() => get_active_filter_count(filters), [filters]);

  const value: FilterContextValue = {
    filters,
    set_filter,
    clear_filters,
    active_filter_count,
    feed_tab,
    set_feed_tab,
  };

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

// ---------------------------------------------------------------------------
// useFilters — guard: lanza si se usa fuera de FilterProvider
// ---------------------------------------------------------------------------

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext);
  if (ctx === undefined) {
    throw new Error('useFilters must be used within a FilterProvider');
  }
  return ctx;
}
