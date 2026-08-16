/**
 * formatPrice.ts — formato ÚNICO de precio para toda la app (quick fix 2026-08-15).
 *
 * "$15,000 MXN" / "$1,500 USD": sin decimales, miles con coma, "$" como prefijo
 * y la divisa SIEMPRE como sufijo (decisión 2026-08-15 — pesos y dólares se
 * leen igual de claros; el catálogo previo, todo en pesos, queda "$X MXN").
 *
 * ponytail: se evita Intl con style:'currency' porque para USD en es-MX
 *   produce "US$1,500" (asimétrico con "$15,000" de MXN). Se formatea solo
 *   el número y se arma la cadena a mano. currency null/undefined → 'MXN'.
 */

const NUMBER_FORMATTER = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

export function format_price(price: number, currency?: string | null): string {
  return `$${NUMBER_FORMATTER.format(price)} ${currency ?? 'MXN'}`;
}
