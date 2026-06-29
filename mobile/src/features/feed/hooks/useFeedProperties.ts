/**
 * useFeedProperties — hook React que envuelve fetchFeedProperties.
 *
 * Expone: data, isLoading, error, nextCursor, loadInitial, refetch, loadMore.
 * Paginación acumulativa: loadMore apende al array existente.
 *
 * ponytail: sin estado extra — loading único para initial y loadMore;
 * techo conocido: sin abort controller (el feed es efímero, sin race visible).
 */

import { useState, useCallback } from 'react';

import { fetchFeedProperties } from '../lib/feedProperties';
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

export function useFeedProperties(): UseFeedPropertiesState {
  const [data, set_data] = useState<FeedPropertyWithUrl[]>([]);
  const [isLoading, set_is_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);
  const [nextCursor, set_next_cursor] = useState<string | null>(null);

  const load_initial = useCallback(async () => {
    set_is_loading(true);
    set_error(null);
    try {
      const result = await fetchFeedProperties();
      set_data(result.data);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar el feed');
    } finally {
      set_is_loading(false);
    }
  }, []);

  const load_more = useCallback(async () => {
    if (!nextCursor || isLoading) return;
    set_is_loading(true);
    set_error(null);
    try {
      const result = await fetchFeedProperties(nextCursor);
      set_data((prev) => [...prev, ...result.data]);
      set_next_cursor(result.nextCursor);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar más');
    } finally {
      set_is_loading(false);
    }
  }, [nextCursor, isLoading]);

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
