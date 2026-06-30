/**
 * useMapProperties — hook React que envuelve fetchMapProperties.
 *
 * Expone: data, loading, error, refetch.
 * Auto-fetch en mount; refetch manual disponible.
 *
 * ponytail: sin paginación (el mapa muestra todas las propiedades activas);
 * DI opcional de supabase para facilitar tests de integración.
 */

import { useState, useEffect, useCallback } from 'react';

import { fetchMapProperties } from '../lib/mapProperties';
import type { MapProperty } from '../types';

export interface UseMapPropertiesState {
  data: MapProperty[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useMapProperties(supabase?: any): UseMapPropertiesState {
  const [data, set_data] = useState<MapProperty[]>([]);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  const fetch_data = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      const result = await fetchMapProperties(supabase ? { supabase } : undefined);
      set_data(result);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar propiedades del mapa');
    } finally {
      set_loading(false);
    }
  // ponytail: supabase solo cambia en tests; stable en prod (singleton)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetch_data();
  }, [fetch_data]);

  return { data, loading, error, refetch: fetch_data };
}
