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
 * NO conecta el FilterSheet a este Context (eso es el wiring de FilterSheet.tsx).
 *
 * ponytail: React Context estándar — no Zustand (ya usado en el repo para stores
 *   de feature con este mismo tamaño; cero dependencias nuevas).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';

import { EMPTY_FILTERS, get_active_filter_count } from './lib/filterQuery';
import { load_filters, save_filters } from './lib/filterStorage';
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
  /** Resetea el estado completo a EMPTY_FILTERS. */
  clear_filters: () => void;
  /** Conteo de grupos de filtro activos (badge del FilterSheet). */
  active_filter_count: number;
}

// ---------------------------------------------------------------------------
// Reducer
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
  const [filters, dispatch] = useReducer(filter_reducer, EMPTY_FILTERS);
  // ponytail: refs (no state) — no necesitan disparar render propio.
  const is_hydrated = useRef(false);
  const debounce_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Hidrata desde AsyncStorage al montar (una sola vez). load_filters es
  // fail-safe (nunca lanza) — el .catch es un guard defensivo adicional.
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
      void save_filters(filters);
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (debounce_timer.current) clearTimeout(debounce_timer.current);
    };
  }, [filters]);

  const set_filter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      dispatch({ type: 'set_filter', key, value });
    },
    [],
  );

  const clear_filters = useCallback(() => {
    dispatch({ type: 'clear_filters' });
  }, []);

  const active_filter_count = useMemo(() => get_active_filter_count(filters), [filters]);

  const value: FilterContextValue = { filters, set_filter, clear_filters, active_filter_count };

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
