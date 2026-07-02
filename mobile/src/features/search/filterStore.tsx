/**
 * filterStore.tsx — Context + Provider + hook para el estado de filtros del feed/mapa (#12.6).
 *
 * Patrón: igual que features/publish/store/PublishFormContext.tsx y features/auth/context.tsx
 *   - Context con undefined como default → el hook lanza si se usa fuera del Provider.
 *   - Estado con useReducer (set_filter por campo + clear_filters).
 *   - active_filter_count derivado de get_active_filter_count (lib/filterQuery.ts).
 *
 * NO integra AsyncStorage ni las queries del feed/mapa (eso es 12.7).
 * NO conecta el FilterSheet a este Context (12.7 hace el wiring de apply/clear).
 *
 * ponytail: React Context estándar — no Zustand (ya usado en el repo para stores
 *   de feature con este mismo tamaño; cero dependencias nuevas).
 */
import React, { createContext, useCallback, useContext, useMemo, useReducer } from 'react';

import { EMPTY_FILTERS, get_active_filter_count } from './lib/filterQuery';
import type { FilterState } from './types';

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
  | { type: 'clear_filters' };

function filter_reducer(state: FilterState, action: FilterAction): FilterState {
  switch (action.type) {
    case 'set_filter':
      return { ...state, [action.key]: action.value };
    case 'clear_filters':
      return EMPTY_FILTERS;
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
