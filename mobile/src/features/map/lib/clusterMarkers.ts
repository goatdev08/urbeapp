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
// STUB — fase RED: la implementación real va en subtarea 11.3 (GREEN).
// Lanza para que los tests fallen por excepción significativa, no por import.
// ---------------------------------------------------------------------------

export function cluster_properties(
  _properties: MapProperty[],
  _region: Region,
  _options?: ClusterOptions,
): ClusterResult[] {
  throw new Error('not_implemented');
}
