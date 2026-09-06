/**
 * zoneSearchEvent.ts — STUB fase RED, subtarea Taskmaster 268.2.
 *
 * Contrato completo bajo test en:
 *   mobile/src/features/map/__tests__/zoneSearchEvent.test.ts
 *
 * NO CONTIENE LÓGICA — solo firmas que lanzan, para que la suite falle por
 * excepción/aserción (nunca por "module not found"). La implementación real
 * la escribe la fase GREEN (268.2).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tipo de evento y payload
// ─────────────────────────────────────────────────────────────────────────────

export const ZONE_SEARCH_EVENT_TYPE = 'zone_search' as const;

export type ZoneSearchPayload =
  | { kind: 'neighborhood'; neighborhood_id: string }
  | { kind: 'municipality'; municipality_id: string }
  | { kind: 'area'; center: { lat: number; lng: number }; radius_m: number };

// ─────────────────────────────────────────────────────────────────────────────
// Normalización (redondeo determinista para dedupe de área)
// ─────────────────────────────────────────────────────────────────────────────

export function normalize_zone_search_payload(
  _input: ZoneSearchPayload
): ZoneSearchPayload {
  throw new Error('not_implemented');
}

// ─────────────────────────────────────────────────────────────────────────────
// Clave de dedupe determinista por (sesión, zona)
// ─────────────────────────────────────────────────────────────────────────────

export function zone_search_key(
  _session_id: string,
  _payload: ZoneSearchPayload
): string {
  throw new Error('not_implemented');
}

// ─────────────────────────────────────────────────────────────────────────────
// Store de dedupe en memoria
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoneSearchStore {
  /** true si esta clave ya se registró. */
  has_seen(key: string): boolean;
  /** Marca la clave como ya registrada. Idempotente. */
  mark_seen(key: string): void;
}

export function create_zone_search_store(): ZoneSearchStore {
  throw new Error('not_implemented');
}
