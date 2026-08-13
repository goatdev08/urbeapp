/**
 * bboxRegion.ts — bbox de una sugerencia → Region de react-native-maps (#157.5).
 *
 * Función PURA (misma entrada → misma salida). Se usa al seleccionar un
 * MUNICIPIO en el autocomplete (bbox precalculado, decisión D4) para
 * `animateToRegion`; las colonias encuadran con `fitToCoordinates` del bbox.
 *
 * Contrato (ver __tests__/bboxRegion.test.ts):
 *   - centro = punto medio del bbox; deltas = span × padding_factor (1.2
 *     default — margen para que el contenido no toque los bordes).
 *   - MIN_DELTA (0.005 ≈ 500 m) evita zoom colapsado en bboxes diminutos o
 *     degenerados (mismo espíritu que MIN_RADIUS_M de viewportToArea).
 */

import type { Region } from './clusterMarkers';
import type { PlaceBBox } from './placeSearch';

/** Delta mínimo (~500 m) — un bbox puntual no colapsa el zoom a 0. */
export const MIN_DELTA = 0.005;

export function bbox_to_region(bbox: PlaceBBox, padding_factor = 1.2): Region {
  return {
    latitude: (bbox.min_lat + bbox.max_lat) / 2,
    longitude: (bbox.min_lng + bbox.max_lng) / 2,
    latitudeDelta: Math.max((bbox.max_lat - bbox.min_lat) * padding_factor, MIN_DELTA),
    longitudeDelta: Math.max((bbox.max_lng - bbox.min_lng) * padding_factor, MIN_DELTA),
  };
}
