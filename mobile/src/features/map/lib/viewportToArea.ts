/**
 * viewportToArea.ts — conversión del viewport del mapa (rectángulo) a
 * {center, radius_m} para reusar el RPC `properties_within_radius` (#56.1).
 *
 * Función PURA (sin side-effects, sin estado): misma Region → mismo resultado.
 *
 * Trade-off círculo vs rectángulo — CÍRCULO INSCRITO (decisión de Abraham
 * 2026-09-08, exploración 046 §"Círculo de zona", opción B). Revierte la
 * decisión 1 (G1, circunscrito) de la exploración 030/#56.1, tomada cuando
 * el círculo todavía no se dibujaba en el mapa: ahora que SÍ se dibuja
 * (281.2/281.3), el circunscrito rompía WYSIWYG — el usuario ve el círculo
 * pero la búsqueda incluía además las 4 esquinas del rectángulo, fuera de lo
 * dibujado. El inscrito es WYSIWYG estricto (lo que se ve es lo que se
 * busca) a costa de NO cubrir esquinas ni, en viewports muy asimétricos, las
 * franjas sobrantes del lado más largo — trade-off aceptado: buscar "en esta
 * zona" y traer menos de lo visible confunde más que traer menos que el
 * rectángulo completo.
 *
 * Contrato:
 *   - center = { lat: region.latitude, lng: region.longitude } (passthrough exacto).
 *   - radius_m = mínimo entre dos distancias Haversine desde el centro:
 *       (a) centro → (lat + latitudeDelta/2, lng)  — media ALTURA.
 *       (b) centro → (lat, lng + longitudeDelta/2) — media ANCHURA.
 *     Es decir, el radio del círculo INSCRITO en el rectángulo (el lado más
 *     corto manda), no la diagonal.
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
  const half_height_m = haversine_distance_m(
    region.latitude,
    region.longitude,
    region.latitude + region.latitudeDelta / 2,
    region.longitude
  );
  const half_width_m = haversine_distance_m(
    region.latitude,
    region.longitude,
    region.latitude,
    region.longitude + region.longitudeDelta / 2
  );
  const raw_radius_m = Math.min(half_height_m, half_width_m);

  return {
    center: { lat: region.latitude, lng: region.longitude },
    radius_m: Math.max(MIN_RADIUS_M, Math.min(raw_radius_m, MAX_RADIUS_M)),
  };
}
