/**
 * Tests fase RED — format_radius_m
 * Archivo SUT: mobile/src/features/map/lib/formatRadius.ts (stub, lanza '')
 * Subtarea Taskmaster: 281.1 — viewport_to_area inscrito + format_radius_m.
 * Doc de exploración: .taskmaster/docs/exploraciones/046-zona-visible-y-buscador-claro.md
 * (label del chip "Zona activa · 2.4 km · Quitar" reusa esta función).
 *
 * SUT: format_radius_m(radius_m: number): string
 *
 * Contrato:
 *   - radius_m < 1000            → metros ENTEROS redondeados + " m".
 *   - 1000 <= radius_m < 10000    → 1 decimal + " km" (colapsa a entero si el
 *                                    redondeo a 1 decimal da x.0, p.ej. 9950).
 *   - radius_m >= 10000           → entero redondeado + " km".
 *   - Separador decimal: PUNTO (es-MX visual del PRD usa punto, no coma).
 *   - Exactamente UN espacio antes de la unidad.
 *
 * Ejemplos ancla (del enunciado, valores independientes del código):
 *   800     → "800 m"
 *   100     → "100 m"    (piso MIN_RADIUS_M)
 *   999.6   → "1.0 km"   (redondeo a metros cruza 1000 → pasa a km)
 *   1000    → "1.0 km"   (frontera exacta m → km)
 *   2400    → "2.4 km"
 *   6245.5  → "6.2 km"
 *   9950    → "10 km"    (redondeo a 1 decimal da 10.0 → se colapsa a entero)
 *   10000   → "10 km"    (frontera exacta banda decimal → entera)
 *   12499   → "12 km"
 *   12500   → "13 km"    (redondeo half-up)
 *   50000   → "50 km"    (techo MAX_RADIUS_M)
 *
 * EDGE CASES CUBIERTOS (11 casos):
 *
 * ### Happy path
 * - (EC-1) metros_simples_800_da_800_m
 * - (EC-2) kilometros_con_decimal_2400_da_2_4_km
 *
 * ### Edge cases del PRD (exploración 046 — chip "Zona activa · X km · Quitar")
 * - (EC-3) piso_min_radius_m_100_da_100_m
 * - (EC-4) techo_max_radius_m_50000_da_50_km
 *
 * ### Ramas de reglas no obvias (cruces de banda por redondeo)
 * - (EC-5) redondeo_cruza_umbral_999_6_pasa_a_1_0_km
 * - (EC-6) redondeo_1_decimal_colapsa_a_entero_9950_da_10_km
 * - (EC-7) redondeo_half_up_banda_entera_12499_da_12_km
 * - (EC-8) redondeo_half_up_banda_entera_12500_da_13_km
 *
 * ### Boundary — fronteras exactas entre bandas
 * - (EC-9) frontera_exacta_1000_da_1_0_km
 * - (EC-10) frontera_exacta_10000_da_10_km
 *
 * ### Formato — separador y espaciado (locale es-MX, punto)
 * - (EC-11) separador_decimal_es_punto_no_coma_y_un_solo_espacio_antes_de_la_unidad
 */

import { format_radius_m } from '../lib/formatRadius';

describe('format_radius_m', () => {
  it('(EC-1) metros_simples_800_da_800_m', () => {
    expect(format_radius_m(800)).toBe('800 m');
  });

  it('(EC-2) kilometros_con_decimal_2400_da_2_4_km', () => {
    expect(format_radius_m(2400)).toBe('2.4 km');
  });

  it('(EC-3) piso_min_radius_m_100_da_100_m', () => {
    expect(format_radius_m(100)).toBe('100 m');
  });

  it('(EC-4) techo_max_radius_m_50000_da_50_km', () => {
    expect(format_radius_m(50000)).toBe('50 km');
  });

  it('(EC-5) redondeo_cruza_umbral_999_6_pasa_a_1_0_km', () => {
    expect(format_radius_m(999.6)).toBe('1.0 km');
  });

  it('(EC-6) redondeo_1_decimal_colapsa_a_entero_9950_da_10_km', () => {
    expect(format_radius_m(9950)).toBe('10 km');
  });

  it('(EC-7) redondeo_half_up_banda_entera_12499_da_12_km', () => {
    expect(format_radius_m(12499)).toBe('12 km');
  });

  it('(EC-8) redondeo_half_up_banda_entera_12500_da_13_km', () => {
    expect(format_radius_m(12500)).toBe('13 km');
  });

  it('(EC-9) frontera_exacta_1000_da_1_0_km', () => {
    expect(format_radius_m(1000)).toBe('1.0 km');
  });

  it('(EC-10) frontera_exacta_10000_da_10_km', () => {
    expect(format_radius_m(10000)).toBe('10 km');
  });

  it('(EC-11) separador_decimal_es_punto_no_coma_y_un_solo_espacio_antes_de_la_unidad', () => {
    const salida = format_radius_m(6245.5);

    expect(salida).toBe('6.2 km');
    expect(salida).not.toContain(',');
    expect(salida).toMatch(/^\d+(\.\d)? (m|km)$/);
  });
});
