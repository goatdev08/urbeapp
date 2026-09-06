/**
 * useZoneSearchEvent.ts — STUB fase RED, subtarea Taskmaster 268.2.
 *
 * Contrato completo bajo test en:
 *   mobile/src/features/map/__tests__/useZoneSearchEvent.test.tsx
 *
 * NO CONTIENE LÓGICA — solo la firma pública, lanza para que la suite falle
 * por excepción/aserción (nunca por "module not found"). La implementación
 * real la escribe la fase GREEN (268.2).
 */

import type { ZoneSearchPayload, ZoneSearchStore } from '../lib/zoneSearchEvent';

export interface UseZoneSearchEventOpts {
  session_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any;
  store?: ZoneSearchStore;
}

export interface UseZoneSearchEventReturn {
  report_zone_search: (payload: ZoneSearchPayload) => Promise<void>;
}

export function useZoneSearchEvent(
  _opts: UseZoneSearchEventOpts
): UseZoneSearchEventReturn {
  throw new Error('not_implemented');
}
