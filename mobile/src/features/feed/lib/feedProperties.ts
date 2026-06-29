/**
 * feedProperties.ts — capa de datos del feed vertical.
 *
 * fetchFeedProperties(cursor?, deps?):
 *   - Consulta properties activas con video ready.
 *   - Invoca mint-video-url EF para obtener signed URLs.
 *   - Merge fail-closed: propiedades sin URL se omiten.
 *   - Paginación por cursor (created_at), LIMIT 10.
 *
 * STUB — subtarea 9.5 fase RED.
 * Implementación real: fase GREEN (otro agente).
 */

import type { FeedPropertyWithUrl } from '../types';

// ponytail: DI opcional para testabilidad; prod usa el singleton de @/lib/supabase/client
export interface FeedPropertiesDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
}

export async function fetchFeedProperties(
  _cursor?: string,
  _deps?: FeedPropertiesDeps,
): Promise<{ data: FeedPropertyWithUrl[]; nextCursor: string | null }> {
  throw new Error('not_implemented');
}
