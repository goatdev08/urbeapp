/**
 * viewportToArea.ts — conversión del viewport del mapa (rectángulo) a
 * {center, radius_m} para reusar el RPC `properties_within_radius` (#56.1,
 * approach G1 — ver .taskmaster/docs/exploraciones/030-buscar-en-esta-zona.md).
 *
 * STUB fase RED — sin lógica de negocio. Lanza `not_implemented` para que
 * los tests fallen por aserción/excepción, no por import.
 *
 * Contrato completo (a implementar en GREEN):
 *   - center = { lat: region.latitude, lng: region.longitude } (passthrough exacto).
 *   - radius_m = distancia Haversine del centro a la esquina del viewport,
 *     usando (latitudeDelta/2, longitudeDelta/2) como offset — es decir, la
 *     mitad de la diagonal del rectángulo visible (decisión G1: círculo que
 *     SOBRE-incluye esquinas, aceptado para la demo).
 *   - Clamp: MIN_RADIUS_M <= radius_m <= MAX_RADIUS_M.
 *   - 🔒 Invariante A1 (igual que `radius_m` de #42/#58): el `area` resultante
 *     NUNCA viaja por `build_filter_query` — es SOLO parámetro del RPC
 *     `properties_within_radius` (ver search/lib/filterQuery.ts header).
 *
 * Ver mobile/src/features/map/__tests__/viewportToArea.test.ts para el
 * contrato completo y el detalle de cada edge case.
 */

import type { Region } from './clusterMarkers';

/** Radio mínimo permitido (m) — zoom extremo (una cuadra) no colapsa a 0. */
export const MIN_RADIUS_M = 100;

/** Radio máximo permitido (m) — zoom extremo (país entero) no explota el RPC. */
export const MAX_RADIUS_M = 50_000;

export interface ViewportArea {
  center: { lat: number; lng: number };
  radius_m: number;
}

export function viewport_to_area(_region: Region): ViewportArea {
  throw new Error('not_implemented');
}
