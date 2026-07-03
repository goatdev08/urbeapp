/**
 * useMyProperties — propiedades del agente autenticado para "Mis publicaciones".
 *
 * Diferencias clave vs usePropertiesGrid:
 *   - Usa useAuth() internamente (es siempre el usuario propio, no un perfil público).
 *   - NO filtra por status → devuelve draft/active/paused/closed.
 *   - Ordena por created_at DESC (no published_at).
 *   - Expone video_count + contadores reales (view_count, like_count, save_count, contact_count).
 *
 * video_count: se cuenta en cliente a partir del mismo embedded select que trae
 * el thumbnail, sin query extra.
 * ponytail: sin paginación — la lista propia es acotada (agente típico tiene pocas
 * propiedades). Agregar cursor si el dato lo justifica.
 */

import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '@/features/auth/context';
import { supabase } from '@/lib/supabase/client';
import type { MyProperty } from '../types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface UseMyPropertiesState {
  loading: boolean;
  error: string | null;
  data: MyProperty[] | null;
  /** Fuerza un re-fetch de la lista (por ej. tras una mutación exitosa). */
  refetch: () => void;
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
 * Carga todas las propiedades del usuario autenticado (todos los status,
 * excluye soft-deleted), ordenadas por created_at DESC.
 *
 * Devuelve null en `data` mientras carga o si el usuario no está autenticado.
 */
export function useMyProperties(): UseMyPropertiesState {
  const { user } = useAuth();

  // tick se incrementa en refetch() para disparar el useEffect sin cambio de user.id
  const [tick, set_tick] = useState(0);
  const refetch = useCallback(() => set_tick((t) => t + 1), []);

  const [state, set_state] = useState<Omit<UseMyPropertiesState, 'refetch'>>({
    loading: true,
    error: null,
    data: null,
  });

  useEffect(() => {
    if (!user?.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- guard "sin usuario" del efecto de carga; resetea estado, no deriva UI.
      set_state({ loading: false, error: null, data: null });
      return;
    }

    let ignore = false;

    async function fetch_my_properties(): Promise<void> {
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
           created_at,
           closed_reason,
           view_count,
           like_count,
           save_count,
           contact_count,
           property_videos(thumbnail_url, storage_path, position)`,
        )
        .eq('owner_user_id', user!.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (ignore) return;

      if (error) {
        set_state({ loading: false, error: error.message, data: null });
        return;
      }

      const properties: MyProperty[] = (rows ?? []).map((row) => {
        const videos = (row.property_videos ?? []) as VideoEmbed[];
        // Primer video por menor position; thumbnail para la card.
        const first_video =
          videos.slice().sort((a, b) => a.position - b.position)[0] ?? null;

        return {
          id: row.id,
          price: row.price,
          operation_type: row.operation_type,
          property_type: row.property_type,
          // ponytail: status tipado vía PropertyRow — el cast no es necesario
          // con los tipos generados actuales, pero se deja explícito por paridad
          // con el patrón del repo en caso de regenrar tipos.
          status: row.status,
          address: row.address,
          created_at: row.created_at,
          closed_reason: row.closed_reason,
          view_count: row.view_count,
          like_count: row.like_count,
          save_count: row.save_count,
          contact_count: row.contact_count,
          // ponytail: video_count = .length del embedded; sin query extra.
          // Techo conocido: no excluye videos con deleted_at (no lo pedimos en
          // el select). Si hace falta el conteo preciso de videos vivos, añadir
          // .is('property_videos.deleted_at', null) cuando supabase-js lo soporte
          // directamente en el embedded select, o mover a una RPC.
          video_count: videos.length,
          thumbnail_url: first_video?.thumbnail_url ?? null,
          storage_path: first_video?.storage_path ?? null,
        };
      });

      set_state({ loading: false, error: null, data: properties });
    }

    void fetch_my_properties();

    return () => {
      ignore = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, tick]);

  return { ...state, refetch };
}
