/**
 * formatPrice.test.ts — helper único de formato de precio (quick fix 2026-08-15).
 *
 * Antes cada superficie (feed, detalle, grid del perfil, share) tenía su
 * propio Intl.NumberFormat con currency:'MXN' hardcodeado. Al entrar la
 * divisa (MXN/USD) el formato se centraliza aquí para que TODAS pinten igual.
 *
 * INVARIANTES:
 *   - Sin decimales, separador de miles, prefijo "$" y la divisa como SUFIJO
 *     siempre ("$15,000 MXN" / "$1,500 USD") — decisión 2026-08-15.
 *   - currency omitida/null → 'MXN' (todo el catálogo previo es en pesos).
 *
 * EDGE CASES:
 * - (FP-1) mxn_con_miles
 * - (FP-2) usd_sufijo
 * - (FP-3) sin_currency_cae_a_mxn
 * - (FP-4) redondea_sin_decimales
 */

import { format_price } from '../formatPrice';

describe('format_price', () => {
  it('(FP-1) mxn_con_miles', () => {
    expect(format_price(15000, 'MXN')).toBe('$15,000 MXN');
    expect(format_price(2400000, 'MXN')).toBe('$2,400,000 MXN');
  });

  it('(FP-2) usd_sufijo', () => {
    expect(format_price(1500, 'USD')).toBe('$1,500 USD');
  });

  it('(FP-3) sin_currency_cae_a_mxn', () => {
    expect(format_price(9500)).toBe('$9,500 MXN');
    expect(format_price(9500, null)).toBe('$9,500 MXN');
    expect(format_price(9500, undefined)).toBe('$9,500 MXN');
  });

  it('(FP-4) redondea_sin_decimales', () => {
    expect(format_price(1234.56, 'MXN')).toBe('$1,235 MXN');
  });
});
