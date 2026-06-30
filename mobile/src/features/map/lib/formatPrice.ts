/**
 * formatPrice.ts — utilidades de formato de precio para el mapa global (#11.4).
 *
 * format_compact_price: precio compacto para el price tag del pin
 *   ($15k, $2.4M, $950). Sin dependencias externas — matemática pura.
 *
 * format_full_price: precio completo con separadores de miles (es-MX).
 *   Reutilizado por el mini-card en 11.5.
 *
 * ponytail: funciones puras sin estado; Intl.NumberFormat vía toLocaleString
 *   —disponible en Hermes/JSC desde RN 0.71.
 */

/**
 * Precio compacto para el price tag del marcador en el mapa.
 *
 * Reglas:
 *   n >= 1_000_000 → "$1.5M"  (1 decimal si el decimal != 0, si no entero)
 *   n >= 1_000     → "$15k"   (entero: no decimal para k)
 *   n < 1_000      → "$950"   (tal cual)
 *
 * Ejemplos: 2_400_000 → "$2.4M" | 2_000_000 → "$2M"
 *           15_000    → "$15k"  | 950        → "$950"
 */
export function format_compact_price(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    // Un decimal si no es entero exacto; evita "$2.0M" → "$2M"
    const formatted = m % 1 === 0 ? `${m}` : m.toFixed(1);
    return `$${formatted}M`;
  }
  if (n >= 1_000) {
    return `$${Math.round(n / 1_000)}k`;
  }
  return `$${Math.round(n)}`;
}

/**
 * Precio completo con separadores de miles (locale es-MX).
 * Destinado al mini-card (11.5) y a cualquier vista que necesite el precio completo.
 *
 * Ejemplo: 2_400_000 → "$2,400,000"
 */
export function format_full_price(n: number): string {
  return `$${n.toLocaleString('es-MX')}`;
}
