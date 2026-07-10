/**
 * useFeedProperties — hook React que envuelve fetchFeedProperties.
 *
 * Expone: data, isLoading, error, nextCursor, loadInitial, refetch, loadMore.
 * Paginación acumulativa: loadMore apende al array existente.
 *
 * `filters` (opcional, #12.7): al cambiar de identidad (el FilterProvider crea
 * un objeto nuevo en cada set_filter/clear_filters), loadInitial cambia de
 * identidad y el efecto de FeedScreen que depende de loadInitial se vuelve a
 * disparar — refetch automático al aplicar/limpiar filtros, sin plumbing extra.
 *
 * Coords (#42.2): useLocation().coords fluye a fetchFeedProperties vía deps
 * para la RPC de proximidad. Mientras coords sea null (gate de ubicación en
 * 'loading', ver (protected)/_layout.tsx) se pasa deps=undefined y el lib usa
 * su propio fallback GDL + lazy-require del cliente real. Igual que `filters`,
 * coords entra a las deps de loadInitial/loadMore → cuando la coord real llega
 * (cambia de null a objeto), loadInitial cambia de identidad y el efecto de
 * FeedScreen dispara el refetch automáticamente.
 *
 * ponytail: sin estado extra — loading único para initial y loadMore;
 * techo conocido: sin abort controller (el feed es efímero, sin race visible).
 */

import { useState, useCallback, useEffect } from 'react';

import { useLocation } from '@/features/location/LocationProvider';
import type { FilterState } from '@/features/search/types';
import { onPropertyDeleted } from '@/lib/propertyEvents';

import { fetchFeedProperties, type FeedPropertiesDeps } from '../lib/feedProperties';
import type { FeedPropertyWithUrl } from '../types';

export interface UseFeedPropertiesState {
  data: FeedPropertyWithUrl[];
  isLoading: boolean;
  error: string | null;
  nextCursor: string | null;
  /** Carga la primera página (descarta estado previo). */
  loadInitial: () => Promise<void>;
  /** Alias de loadInitial para el patrón pull-to-refresh. */
  refetch: () => Promise<void>;
  /** Carga la siguiente página y apende al array existente. */
  loadMore: () => Promise<void>;
}

export function useFeedProperties(filters?: FilterState): UseFeedPropertiesState {
  const { coords } = useLocation();
  const [data, set_data] = useState<FeedPropertyWithUrl[]>([]);
  // ponytail: arranca en true — FeedScreen siempre llama loadInitial en mount;
  // esto evita un frame de "empty state" antes de que useEffect dispare.
  const [isLoading, set_is_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);
  const [nextCursor, set_next_cursor] = useState<string | null>(null);

  // ponytail: deps solo se arma cuando ya hay coords reales; sin ellas se pasa
  // undefined y fetchFeedProperties usa su propio lazy-require del singleton
  // + fallback GDL (evita importar '@/lib/supabase/client' en top-level aquí,
  // que lanza sin env vars — mismo motivo que en feedProperties.ts).
  const build_deps = useCallback((): FeedPropertiesDeps | undefined => {
    if (!coords) return undefined;
    const { supabase } = require('@/lib/supabase/client') as { supabase: unknown };
    return { supabase, coords };
  }, [coords]);

  const load_initial = useCallback(async () => {
    set_is_loading(true);
    set_error(null);
    try {
      const result = await fetchFeedProperties(undefined, build_deps(), filters);
      set_data(result.data);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar el feed');
    } finally {
      set_is_loading(false);
    }
  }, [filters, build_deps]);

  const load_more = useCallback(async () => {
    if (!nextCursor || isLoading) return;
    set_is_loading(true);
    set_error(null);
    try {
      const result = await fetchFeedProperties(nextCursor, build_deps(), filters);
      set_data((prev) => [...prev, ...result.data]);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar más');
    } finally {
      set_is_loading(false);
    }
  }, [nextCursor, isLoading, filters, build_deps]);

  useEffect(
    () => onPropertyDeleted((id) => set_data((prev) => prev.filter((p) => p.id !== id))),
    [],
  );

  return {
    data,
    isLoading,
    error,
    nextCursor,
    loadInitial: load_initial,
    refetch: load_initial,
    loadMore: load_more,
  };
}
