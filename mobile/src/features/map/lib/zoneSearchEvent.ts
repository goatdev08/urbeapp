/**
 * zoneSearchEvent.ts — lógica pura de normalización y dedupe del evento
 * `zone_search` (búsqueda de zona en el mapa: colonia, municipio o el pill
 * "Buscar en esta zona").
 *
 * Subtarea Taskmaster: 268.2. Implementación completa (GREEN); contrato
 * verificado en mobile/src/features/map/__tests__/zoneSearchEvent.test.ts.
 *
 * Por qué existe (mismo espíritu que videoEngagementDedupe.ts):
 *   - El pill "Buscar en esta zona" dispara sobre un CÍRCULO
 *     (viewport_to_area → {center:{lat,lng}, radius_m}), y dos paneos casi
 *     idénticos del mapa producirían coordenadas ligeramente distintas sin
 *     redondear — normalize_zone_search_payload fija el redondeo para que
 *     zone_search_key trate paneos equivalentes como la MISMA zona.
 *   - neighborhood/municipality son passthrough por id (no hay coords que
 *     redondear); NUNCA llevan property_id (una zona no es una propiedad).
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

/** Redondea a 3 decimales evitando -0 (Object.is(-0, 0) === false engañaría al dedupe). */
function round_coord(value: number): number {
  const rounded = Math.round(value * 1000) / 1000;
  return rounded === 0 ? 0 : rounded;
}

export function normalize_zone_search_payload(
  input: ZoneSearchPayload
): ZoneSearchPayload {
  if (input.kind === 'area') {
    return {
      kind: 'area',
      center: {
        lat: round_coord(input.center.lat),
        lng: round_coord(input.center.lng),
      },
      radius_m: Math.round(input.radius_m),
    };
  }
  return input;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clave de dedupe determinista por (sesión, zona)
// ─────────────────────────────────────────────────────────────────────────────

export function zone_search_key(
  session_id: string,
  payload: ZoneSearchPayload
): string {
  const normalized = normalize_zone_search_payload(payload);
  if (normalized.kind === 'neighborhood') {
    return `${session_id}::neighborhood::${normalized.neighborhood_id}`;
  }
  if (normalized.kind === 'municipality') {
    return `${session_id}::municipality::${normalized.municipality_id}`;
  }
  return `${session_id}::area::${normalized.center.lat}:${normalized.center.lng}:${normalized.radius_m}`;
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
  // ponytail: Set<string> — mismo patrón que create_video_engagement_store,
  // dedupe en memoria sin BD ni dependencia nueva; la clave ya viene resuelta
  // por zone_search_key, así que el store no necesita conocer su forma.
  const seen = new Set<string>();
  return {
    has_seen: (key) => seen.has(key),
    mark_seen: (key) => {
      seen.add(key);
    },
  };
}
