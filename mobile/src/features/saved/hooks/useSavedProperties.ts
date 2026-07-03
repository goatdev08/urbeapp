/**
 * useSavedProperties — carga propiedades guardadas del usuario autenticado.
 *
 * Subtarea Taskmaster: 13.6 — pantalla "Guardados" (hook crítico, fase GREEN).
 *
 * Contrato:
 *   - Query: from('saves').select(embed properties+property_videos).order('created_at', { ascending: false })
 *   - RLS (saves_select) filtra por user_id automáticamente. NO filtrar por user_id en el select.
 *   - Sin sesión (user=null) → no consulta, properties: [], loading: false, error: null.
 *   - BUG1 FIX: saves NO tiene deleted_at (DELETE duro — migración 0006). Sin filtro deleted_at.
 *   - Transform: cada fila → GridProperty. thumbnail_url = video de menor position; null-safe.
 *   - Filas con properties=null → descartadas silenciosamente.
 *
 * Patrón de referencia: usePropertiesGrid.ts (query+embed+transform, mismo estilo).
 * DI del cliente Supabase vía deps para tests.
 *
 * ponytail: published_at y storage_path no se incluyen en el embed de saves (no se
 * necesitan en el card de "Guardados"); se fijan a null. El card usa thumbnail_url.
 */

import { useState, useEffect, useCallback } from 'react';

import { useAuth } from '@/features/auth/context';
import type { GridProperty } from '@/features/profile/types';

// ---------------------------------------------------------------------------
// Tipos locales para el embedded select
// ---------------------------------------------------------------------------

type VideoEmbed = { thumbnail_url: string | null; position: number };
type PropertyEmbed = {
  id: string;
  price: number;
  operation_type: string;
  property_type: string;
  status: string;
  address: string;
  property_videos: VideoEmbed[];
};
type SaveRow = { properties: PropertyEmbed | null };

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface UseSavedPropertiesReturn {
  properties: GridProperty[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Carga las propiedades guardadas del usuario autenticado.
 *
 * @param deps - Inyección de dependencias (supabase) para tests.
 */
 
export function useSavedProperties(deps?: { supabase?: any }): UseSavedPropertiesReturn {
  const { user } = useAuth();

  // ponytail: lazy require para el cliente por defecto — evita que el throw por
  // env vars ausentes (EXPO_PUBLIC_SUPABASE_URL) rompa el módulo en tests que no
  // necesitan el cliente real. Patrón idéntico a usePropertyActions.ts.
   
  const get_client = (): any => {
    if (deps?.supabase) return deps.supabase;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return (require('@/lib/supabase/client') as { supabase: unknown }).supabase;
  };

  const [properties, set_properties] = useState<GridProperty[]>([]);
  const [loading, set_loading] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  const fetch_saves = useCallback(async (): Promise<void> => {
    // EC-9: sin sesión → no consulta (RLS también protege en DB, pero evitamos el round-trip).
    if (!user) return;

    set_loading(true);
    set_error(null);

    const { data, error: query_error } = await get_client()
      .from('saves')
      .select(
        `properties(
          id,
          price,
          operation_type,
          property_type,
          status,
          address,
          property_videos(thumbnail_url, position)
        )`,
      )
      .order('created_at', { ascending: false });

    if (query_error) {
      set_loading(false);
      set_error(query_error.message);
      set_properties([]);
      return;
    }

    // EC-5: descartar filas donde el embed properties llegó null
    // (propiedad eliminada entre el save y la consulta).
    const valid_rows = ((data ?? []) as SaveRow[]).filter(
      (row): row is { properties: PropertyEmbed } => row.properties !== null,
    );

    // Transform: embed → GridProperty
    const mapped: GridProperty[] = valid_rows.map(({ properties: p }) => {
      // EC-4a: thumbnail = video con menor position (sort ASC, tomar [0]).
      const videos = (p.property_videos ?? []) as VideoEmbed[];
      const sorted = videos.slice().sort((a, b) => a.position - b.position);
      const first_video = sorted[0] ?? null;

      return {
        id: p.id,
        // ponytail: cast necesario porque el embed no viene tipado por supabase-js;
        // los valores reales son un subconjunto del enum de la DB.
        price: p.price,
        operation_type: p.operation_type as GridProperty['operation_type'],
        property_type: p.property_type as GridProperty['property_type'],
        status: p.status as GridProperty['status'],
        address: p.address,
        // ponytail: no se solicita published_at en el embed de saves (sin relevancia
        // para el card de "Guardados"); se fija a null para cumplir GridProperty.
        published_at: null,
        // EC-4b/4c: null-safe — sin videos o thumbnail_url nulo → null.
        thumbnail_url: first_video?.thumbnail_url ?? null,
        // ponytail: storage_path no solicitado en el embed de saves.
        storage_path: null,
      };
    });

    set_properties(mapped);
    set_loading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, deps?.supabase]);

  // Carga inicial y re-fetch cuando user o client cambian.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch-on-mount: dispara la carga async (fetch_saves maneja su propio loading/error).
    void fetch_saves();
  }, [fetch_saves]);

  // EC-8: refetch vuelve a ejecutar la query.
  const refetch = useCallback(async (): Promise<void> => {
    await fetch_saves();
  }, [fetch_saves]);

  return { properties, loading, error, refetch };
}
