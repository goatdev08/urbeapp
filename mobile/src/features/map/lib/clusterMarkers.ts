/**
 * clusterMarkers.ts — agrupamiento de marcadores en el mapa global (#11.3).
 *
 * cluster_properties(properties, region, options?):
 *   - Algoritmo grid absoluto anclado en (0,0).
 *   - cellLng = longitudeDelta / divisions  (default divisions=8)
 *   - cellLat = latitudeDelta / divisions
 *   - Cada propiedad cae en celda (floor(lng/cellLng), floor(lat/cellLat)).
 *   - Celda con 1 prop → { type:'point', property }.
 *   - Celda con >1 props → { type:'cluster', cluster } donde:
 *       id          = 'cluster_<cellX>_<cellY>'  (determinista)
 *       latitude    = media aritmética de latitudes de los miembros
 *       longitude   = media aritmética de longitudes de los miembros
 *       count       = número de miembros
 *       properties  = array de MapProperty miembros
 *   - GUARD: si latitudeDelta<=0 o longitudeDelta<=0 → todas las props
 *     se devuelven como {type:'point'} individuales (sin NaN, sin clusterizar).
 *   - Orden de salida determinista (por clave de celda ascendente).
 *
 * ponytail: lógica pura, sin dependencias externas; sin estado.
 */

import type { MapProperty } from '../types';

// ---------------------------------------------------------------------------
// Tipos de salida exportados
// ---------------------------------------------------------------------------

export type ClusterResult =
  | { type: 'point'; property: MapProperty }
  | {
      type: 'cluster';
      cluster: {
        /** Formato: 'cluster_<cellX>_<cellY>' — derivado de coords de celda. */
        id: string;
        latitude: number;
        longitude: number;
        count: number;
        properties: MapProperty[];
      };
    };

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type ClusterOptions = {
  /** Número de divisiones por eje. Default: 8. */
  divisions?: number;
};

// ---------------------------------------------------------------------------
// Implementación — fase GREEN (11.3).
// Algoritmo: grid absoluto anclado en (0,0), sin dependencias externas.
// ponytail: función pura, O(n) sobre el input.
// ---------------------------------------------------------------------------

export function cluster_properties(
  properties: MapProperty[],
  region: Region,
  options?: ClusterOptions,
): ClusterResult[] {
  if (properties.length === 0) return [];

  // Guard: delta inválido → todas las props como points individuales, sin NaN.
  if (region.latitudeDelta <= 0 || region.longitudeDelta <= 0) {
    return properties.map((property) => ({ type: 'point', property }));
  }

  const divisions = options?.divisions ?? 8;
  const cell_lng = region.longitudeDelta / divisions;
  const cell_lat = region.latitudeDelta / divisions;

  // Agrupar por clave de celda.
  const cells = new Map<string, { cell_x: number; cell_y: number; members: MapProperty[] }>();

  for (const prop of properties) {
    const cell_x = Math.floor(prop.lng / cell_lng);
    const cell_y = Math.floor(prop.lat / cell_lat);
    const key = `${cell_x}_${cell_y}`;

    const existing = cells.get(key);
    if (existing) {
      existing.members.push(prop);
    } else {
      cells.set(key, { cell_x, cell_y, members: [prop] });
    }
  }

  // Construir resultados ordenados por clave de celda (determinista).
  const sorted_keys = Array.from(cells.keys()).sort((a, b) => {
    const [ax, ay] = a.split('_').map(Number) as [number, number];
    const [bx, by] = b.split('_').map(Number) as [number, number];
    return ax !== bx ? ax - bx : ay - by;
  });

  const results: ClusterResult[] = [];

  for (const key of sorted_keys) {
    const cell = cells.get(key)!;
    if (cell.members.length === 1) {
      results.push({ type: 'point', property: cell.members[0]! });
    } else {
      const count = cell.members.length;
      const lat_sum = cell.members.reduce((sum, p) => sum + p.lat, 0);
      const lng_sum = cell.members.reduce((sum, p) => sum + p.lng, 0);
      results.push({
        type: 'cluster',
        cluster: {
          id: `cluster_${cell.cell_x}_${cell.cell_y}`,
          latitude: lat_sum / count,
          longitude: lng_sum / count,
          count,
          properties: cell.members,
        },
      });
    }
  }

  return results;
}
