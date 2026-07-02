/**
 * useSavedProperties — stub NOT IMPLEMENTED (fase RED).
 *
 * Subtarea Taskmaster: 13.6 — pantalla "Guardados".
 *
 * Contrato (pendiente de implementar en fase GREEN):
 *   - Carga propiedades guardadas del usuario autenticado desde public.saves.
 *   - Query: from('saves').select(embed properties+property_videos).order('created_at', { ascending: false }).
 *   - RLS filtra automáticamente por user_id (policy saves_select). NO filtrar por user_id en el .select.
 *   - Sin sesión → no consulta, properties: [].
 *   - BUG1 FIX: saves NO tiene deleted_at (DELETE duro vía useSaveProperty — migración 0006).
 *   - Transform: cada fila → GridProperty. thumbnail_url = video de menor position; null-safe.
 *   - Filas con properties=null → descartadas.
 *
 * STUB: retorna estado vacío sin ejecutar ninguna query.
 * Los tests de negocio (EC-1, EC-2, EC-4a–c, EC-5, EC-7, EC-8) fallan por aserción.
 * EC-3/EC-6/EC-9 pueden pasar trivialmente (comportamiento coincide con estado vacío).
 */

import { useState, useCallback } from 'react';
import type { GridProperty } from '@/features/profile/types';

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
// Stub — fase RED
// ---------------------------------------------------------------------------

/**
 * STUB — no implementado. Devuelve estado vacío sin ejecutar ninguna query.
 * Los tests de negocio fallan por aserción contra estos valores predeterminados.
 */
export function useSavedProperties(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  _deps?: { supabase?: any }
): UseSavedPropertiesReturn {
  // ponytail: useState mínimo para cumplir Rules of Hooks dentro de renderHook.
  const [properties] = useState<GridProperty[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  const refetch = useCallback(async () => {}, []);

  return { properties, loading: false, error: null, refetch };
}
