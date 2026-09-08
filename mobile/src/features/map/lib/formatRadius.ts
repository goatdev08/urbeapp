/**
 * formatRadius.ts — format_radius_m(radius_m) → label corto para humanos.
 * Contrato: <1000 → metros enteros ("800 m"); [1000,10000) → km a 1 decimal
 * ("2.4 km", colapsa a entero si el redondeo da x.0, p.ej. 9950 → "10 km");
 * >=10000 → km entero ("50 km"). Punto decimal, un espacio antes de la unidad.
 * Uso: label del ZoneActiveChip ("Zona activa · 2.4 km · Quitar", 281.3).
 * Ver mobile/src/features/map/__tests__/formatRadius.test.ts para el contrato
 * completo y cada edge case (redondeo half-up, cruces de banda).
 */

export function format_radius_m(radius_m: number): string {
  const rounded_m = Math.round(radius_m);
  if (rounded_m < 1000) {
    return `${rounded_m} m`;
  }

  const km = radius_m / 1000;
  if (km < 10) {
    const km_1dec = Math.round(km * 10) / 10;
    if (km_1dec < 10) {
      return `${km_1dec.toFixed(1)} km`;
    }
  }

  return `${Math.round(km)} km`;
}
