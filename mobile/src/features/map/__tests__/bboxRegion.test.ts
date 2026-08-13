/**
 * Tests fase RED — bbox_to_region (encuadre de bbox, #157.5)
 * Archivo SUT: mobile/src/features/map/lib/bboxRegion.ts
 *
 * Función PURA: bbox {min/max lat/lng} → Region de react-native-maps
 * ({latitude, longitude, latitudeDelta, longitudeDelta}) para animateToRegion.
 *
 * Contrato:
 *   - centro = punto medio del bbox en ambos ejes.
 *   - deltas = span del bbox × padding_factor (default 1.2 — margen visual para
 *     que el perímetro no toque los bordes de la pantalla).
 *   - deltas mínimos MIN_DELTA (0.005 ≈ 500 m): una colonia diminuta o un bbox
 *     degenerado (punto) no colapsa el zoom a 0 (mismo espíritu que
 *     MIN_RADIUS_M de viewportToArea).
 *
 * EDGE CASES:
 * - (EC-BR1) centro_es_punto_medio_y_deltas_con_padding
 * - (EC-BR2) padding_factor_custom
 * - (EC-BR3) bbox_diminuto_respeta_delta_minimo
 */

import { bbox_to_region, MIN_DELTA } from '../lib/bboxRegion';

describe('bbox_to_region — bbox → Region (#157)', () => {
  it('(EC-BR1) centro_es_punto_medio_y_deltas_con_padding: bbox de 0.02×0.02 → centro medio y deltas 0.024 (×1.2)', () => {
    const region = bbox_to_region({
      min_lat: 20.69,
      min_lng: -103.38,
      max_lat: 20.71,
      max_lng: -103.36,
    });

    expect(region.latitude).toBeCloseTo(20.7, 10);
    expect(region.longitude).toBeCloseTo(-103.37, 10);
    expect(region.latitudeDelta).toBeCloseTo(0.024, 10);
    expect(region.longitudeDelta).toBeCloseTo(0.024, 10);
  });

  it('(EC-BR2) padding_factor_custom: mismo bbox con padding 2 → deltas 0.04', () => {
    const region = bbox_to_region(
      { min_lat: 20.69, min_lng: -103.38, max_lat: 20.71, max_lng: -103.36 },
      2,
    );

    expect(region.latitudeDelta).toBeCloseTo(0.04, 10);
    expect(region.longitudeDelta).toBeCloseTo(0.04, 10);
  });

  it('(EC-BR3) bbox_diminuto_respeta_delta_minimo: bbox de un punto → deltas = MIN_DELTA, centro intacto', () => {
    const region = bbox_to_region({
      min_lat: 20.7,
      min_lng: -103.37,
      max_lat: 20.7,
      max_lng: -103.37,
    });

    expect(region.latitude).toBeCloseTo(20.7, 10);
    expect(region.longitude).toBeCloseTo(-103.37, 10);
    expect(region.latitudeDelta).toBe(MIN_DELTA);
    expect(region.longitudeDelta).toBe(MIN_DELTA);
  });
});
