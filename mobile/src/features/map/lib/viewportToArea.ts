/**
 * viewportToArea.ts — conversión del viewport del mapa (rectángulo) a
 * {center, radius_m} para reusar el RPC `properties_within_radius` (#56.1,
 * approach G1 — ver .taskmaster/docs/exploraciones/030-buscar-en-esta-zona.md).
 *
 * Función PURA (sin side-effects, sin estado): misma Region → mismo resultado.
 *
 * Trade-off círculo vs rectángulo (regla no obvia #6 de la exploración 030):
 * el viewport visible es un RECTÁNGULO, pero `properties_within_radius` solo
 * acepta {center, radius_m} (círculo). Usamos radius_m = mitad de la diagonal
 * del rectángulo (Haversine del centro a la esquina), así el círculo
 * SIEMPRE cubre el viewport completo — a costa de sobre-incluir las 4
 * esquinas del rectángulo (propiedades fuera de la vista pero dentro del
 * círculo circunscrito). Aceptado para la demo: más resultados de más no es
 * un bug visible, menos resultados de menos sí lo sería.
 *
 * Contrato:
 *   - center = { lat: region.latitude, lng: region.longitude } (passthrough exacto).
 *   - radius_m = distancia Haversine del centro a la esquina del viewport,
 *     usando (latitudeDelta/2, longitudeDelta/2) como offset — es decir, la
 *     mitad de la diagonal del rectángulo visible.
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

/** Radio terrestre medio (m), estándar para Haversine. */
const EARTH_RADIUS_M = 6_371_000;

export interface ViewportArea {
  center: { lat: number; lng: number };
  radius_m: number;
}

function to_radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Distancia Haversine (m) entre dos puntos (lat/lng en grados). */
function haversine_distance_m(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const d_lat = to_radians(lat2 - lat1);
  const d_lng = to_radians(lng2 - lng1);
  const a =
    Math.sin(d_lat / 2) ** 2 +
    Math.cos(to_radians(lat1)) * Math.cos(to_radians(lat2)) * Math.sin(d_lng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function viewport_to_area(region: Region): ViewportArea {
  const corner_lat = region.latitude + region.latitudeDelta / 2;
  const corner_lng = region.longitude + region.longitudeDelta / 2;

  const raw_radius_m = haversine_distance_m(
    region.latitude,
    region.longitude,
    corner_lat,
    corner_lng
  );

  return {
    center: { lat: region.latitude, lng: region.longitude },
    radius_m: Math.max(MIN_RADIUS_M, Math.min(raw_radius_m, MAX_RADIUS_M)),
  };
}
