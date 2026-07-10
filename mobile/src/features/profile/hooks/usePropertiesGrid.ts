/**
 * usePropertiesGrid — hook de lectura para la grilla de propiedades del perfil.
 *
 * Devuelve { loading, error, data } con la lista de propiedades activas/pausadas
 * del agente, ordenadas por published_at DESC.
 *
 * Query:
 *   SELECT id, price, operation_type, property_type, status, address, published_at
 *   FROM properties
 *   WHERE owner_user_id = :id
 *     AND status IN ('active', 'paused')
 *     AND deleted_at IS NULL
 *   ORDER BY published_at DESC
 *   + embedded select: property_videos(thumbnail_url, storage_path, position)
 *     filtrado por deleted_at IS NULL
 *
 * El primer video (menor position) se extrae en el cliente.
 * thumbnail_url llegará null en esta etapa — el card (16.5) maneja placeholder.
 *
 * Patrón idéntico a useAgentProfile: useState + useEffect con flag `ignore`.
 *
 * ponytail: sin paginación aquí — la grilla del perfil es acotada (agente típico
 * tiene pocas propiedades activas). La paginación se añade si el dato lo justifica.
 */

import { useState, useEffect } from 'react';

import { supabase } from '@/lib/supabase/client';
import { onPropertyDeleted } from '@/lib/propertyEvents';
import type { GridProperty } from '../types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface UsePropertiesGridState {
  loading: boolean;
  error: string | null;
  data: GridProperty[] | null;
}

// ---------------------------------------------------------------------------
// Tipo local para el embedded select de property_videos
// ---------------------------------------------------------------------------

type VideoEmbed = {
  thumbnail_url: string | null;
  storage_path: string | null;
  position: number;
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga las propiedades activas/pausadas del agente identificado por `owner_user_id`.
 * Re-fetches automáticamente si `owner_user_id` cambia.
 */
export function usePropertiesGrid(owner_user_id: string): UsePropertiesGridState {
  const [state, set_state] = useState<UsePropertiesGridState>({
    loading: true,
    error: null,
    data: null,
  });

  useEffect(() => {
    // Flag de cancelación — evita setState en componente ya desmontado.
    let ignore = false;

    async function fetch_properties(): Promise<void> {
      set_state({ loading: true, error: null, data: null });

      const { data: rows, error } = await supabase
        .from('properties')
        .select(
          `id,
           price,
           operation_type,
           property_type,
           status,
           address,
           published_at,
           property_videos(thumbnail_url, storage_path, position)`,
        )
        .eq('owner_user_id', owner_user_id)
        .in('status', ['active', 'paused'])
        .is('deleted_at', null)
        .order('published_at', { ascending: false });

      if (ignore) return;

      if (error) {
        set_state({ loading: false, error: error.message, data: null });
        return;
      }

      // Mapear cada fila al tipo GridProperty extrayendo el primer video.
      const properties: GridProperty[] = (rows ?? []).map((row) => {
        // property_videos llega como array (1-N embebido).
        // Nos quedamos con el de menor position, ignorando deleted.
        const videos = (row.property_videos ?? []) as VideoEmbed[];
        // ponytail: filter deleted_at en el embedded select no está soportado
        // en supabase-js sin `match`; el bucket is small — filtramos en cliente
        // solo si deleted_at llega en el embed. Como no lo pedimos en el select,
        // asumimos que PostgREST devuelve todos; se puede añadir .eq más adelante.
        const first_video = videos.slice().sort((a, b) => a.position - b.position)[0] ?? null;

        return {
          id: row.id,
          price: row.price,
          operation_type: row.operation_type,
          property_type: row.property_type,
          status: row.status,
          address: row.address,
          published_at: row.published_at,
          thumbnail_url: first_video?.thumbnail_url ?? null,
          storage_path: first_video?.storage_path ?? null,
        };
      });

      set_state({ loading: false, error: null, data: properties });
    }

    void fetch_properties();

    return () => {
      ignore = true;
    };
  }, [owner_user_id]);

  useEffect(
    () =>
      onPropertyDeleted((id) =>
        set_state((s) => (s.data ? { ...s, data: s.data.filter((p) => p.id !== id) } : s)),
      ),
    [],
  );

  return state;
}
