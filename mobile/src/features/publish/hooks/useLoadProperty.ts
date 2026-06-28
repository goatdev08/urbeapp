/**
 * useLoadProperty — carga una propiedad existente por property_id y la mapea
 * al shape de PublishFormState para pre-llenar el wizard en modo edición.
 *
 * STUB — lanza 'not_implemented'. Implementar en fase GREEN (subtarea 17.8).
 *
 * Contrato (GREEN):
 *   useLoadProperty(property_id, deps?) → { formState, loading, error }
 *   - Si property_id es null, no hace query; devuelve loading=false, formState=null, error=null.
 *   - Invoca supabase.from('properties').select('...').eq('id', property_id).single()
 *     con embed de property_videos (position=1, status=ready).
 *   - Mapea la fila DB → Partial<PublishFormState>.
 *   - not-found (PGRST116) → error='not_found', formState=null.
 *   - Error genérico → error=mensaje, formState=null.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import type { PublishFormState } from '../store/types';

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface UseLoadPropertyResult {
  /** Partial del form state mapeado desde DB — null si error/no-encontrado */
  formState: Partial<PublishFormState> | null;
  loading: boolean;
  error: string | null;
}

export interface UseLoadPropertyDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
}

// ---------------------------------------------------------------------------
// Hook stub — NO implementar hasta fase GREEN
// ---------------------------------------------------------------------------

export function useLoadProperty(
  property_id: string | null,
  deps?: UseLoadPropertyDeps,
): UseLoadPropertyResult {
  // stub: not_implemented — reemplazar en fase GREEN con la lógica real.
  // Los tests de la fase RED invocan este hook y esperan fallar por excepción.
  throw new Error('not_implemented: useLoadProperty — implementar en fase GREEN (17.8)');
}
