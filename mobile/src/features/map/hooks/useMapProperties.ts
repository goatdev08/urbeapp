/**
 * useMapProperties — hook React que envuelve fetchMapProperties.
 *
 * Expone: data, loading, error, refetch.
 * Auto-fetch en mount; refetch manual disponible.
 *
 * `filters` (opcional, #12.7): al cambiar de identidad, fetch_data cambia de
 * identidad y el useEffect que depende de fetch_data se vuelve a disparar —
 * refetch automático al aplicar/limpiar filtros.
 *
 * Coords (#42.3): useLocation().coords fluye a fetchMapProperties vía deps
 * para la RPC de proximidad — mismo patrón que useFeedProperties (#42.2).
 * Mientras coords sea null se pasa deps=undefined (salvo `supabase` inyectado
 * en tests) y el lib usa su propio fallback GDL + lazy-require del cliente
 * real. coords entra a las deps de fetch_data → cuando la coord real llega
 * (null → objeto), fetch_data cambia de identidad y el efecto de abajo
 * dispara el refetch automáticamente.
 *
 * ponytail: sin paginación (el mapa muestra todas las propiedades activas);
 * DI opcional de supabase para facilitar tests de integración.
 */

import { useState, useEffect, useCallback } from 'react';

import { useLocation } from '@/features/location/LocationProvider';
import type { FilterState } from '@/features/search/types';

import { fetchMapProperties, type MapPropertiesDeps } from '../lib/mapProperties';
import type { MapProperty } from '../types';

export interface UseMapPropertiesState {
  data: MapProperty[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useMapProperties(

  supabase?: any,
  filters?: FilterState,
): UseMapPropertiesState {
  const { coords } = useLocation();
  const [data, set_data] = useState<MapProperty[]>([]);
  const [loading, set_loading] = useState(true);
  const [error, set_error] = useState<string | null>(null);

  // ponytail: deps solo se arma cuando hay `supabase` inyectado (tests) o ya
  // hay coords reales; sin ninguno de los dos se pasa undefined y
  // fetchMapProperties usa su propio lazy-require del singleton + fallback GDL.
  const build_deps = useCallback((): MapPropertiesDeps | undefined => {
    if (!supabase && !coords) return undefined;
    const client = supabase ?? (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
    return { supabase: client, ...(coords ? { coords } : {}) };
  }, [supabase, coords]);

  const fetch_data = useCallback(async () => {
    set_loading(true);
    set_error(null);
    try {
      const result = await fetchMapProperties(build_deps(), filters);
      set_data(result);
    } catch (e) {
      set_error(e instanceof Error ? e.message : 'Error al cargar propiedades del mapa');
    } finally {
      set_loading(false);
    }
  }, [filters, build_deps]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: dispara la carga async (fetch_data maneja su propio loading/error).
    void fetch_data();
  }, [fetch_data]);

  return { data, loading, error, refetch: fetch_data };
}
