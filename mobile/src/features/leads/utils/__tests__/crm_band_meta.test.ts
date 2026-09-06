/**
 * crm_band_meta.test.ts — RED (subtarea 267.3).
 *
 * Contrato: metadatos visuales por banda de tendencia (CrmBand) + reglas de
 * quién ve el radar anónimo. Exploración 045 §7.3/§7.4, decisiones de Abraham
 * 2026-09-06. Fuente de los literales de copy: enunciado de la subtarea.
 */

import { colors } from '@/theme/theme';

import type { CrmBand } from '../../types';
import { BAND_META, BAND_ORDER, band_accepts_anon, band_color } from '../crm_band_meta';
import { temperature_color } from '../crm_temperature_format';

describe('BAND_ORDER', () => {
  it('es exactamente [hot, cooling, warming, silent], en ese orden', () => {
    expect(BAND_ORDER).toEqual(['hot', 'cooling', 'warming', 'silent']);
  });
});

describe('BAND_META', () => {
  it('hot: copy, color y collapsed_by_default correctos', () => {
    expect(BAND_META.hot).toEqual({
      label: 'Háblales hoy',
      subtitle: 'Señal fuerte en las últimas 24 h',
      color: colors.temp_hot,
      collapsed_by_default: false,
    });
  });

  it('cooling: copy, color y collapsed_by_default correctos', () => {
    expect(BAND_META.cooling).toEqual({
      label: 'Se están enfriando',
      subtitle: 'Estuvieron listos y nadie los alcanzó',
      color: colors.temp_cooling,
      collapsed_by_default: false,
    });
  });

  it('warming: copy, color y collapsed_by_default correctos', () => {
    expect(BAND_META.warming).toEqual({
      label: 'Calentando',
      subtitle: 'Suben, pero aún no levantan la mano',
      color: colors.temp_warming,
      collapsed_by_default: false,
    });
  });

  it('silent: copy, color y collapsed_by_default TRUE (decisión de Abraham — colapsada por defecto)', () => {
    expect(BAND_META.silent).toEqual({
      label: 'En silencio',
      subtitle: 'Sin actividad reciente',
      color: colors.temp_silent,
      collapsed_by_default: true,
    });
  });
});

describe('band_color', () => {
  it('devuelve el color de la banda (uno por cada banda del dominio)', () => {
    expect(band_color('hot')).toBe(colors.temp_hot);
    expect(band_color('cooling')).toBe(colors.temp_cooling);
    expect(band_color('warming')).toBe(colors.temp_warming);
    expect(band_color('silent')).toBe(colors.temp_silent);
  });

  it('decoupling: el color de FILA depende de la banda, NO de la temperatura numérica', () => {
    // Una fila 'warming' con temperature=68 se pinta con el color de warming,
    // aunque temperature_color(68) (escala continua) caiga en cooling.
    const band: CrmBand = 'warming';
    const temperature = 68;
    expect(band_color(band)).toBe(colors.temp_warming);
    expect(temperature_color(temperature)).toBe(colors.temp_cooling);
    expect(band_color(band)).not.toBe(temperature_color(temperature));
  });
});

describe('band_accepts_anon', () => {
  it('warming acepta anónimos (true)', () => {
    expect(band_accepts_anon('warming')).toBe(true);
  });

  it('silent acepta anónimos (true)', () => {
    expect(band_accepts_anon('silent')).toBe(true);
  });

  it('hot NO acepta anónimos (false — 🔒 solo leads)', () => {
    expect(band_accepts_anon('hot')).toBe(false);
  });

  it('cooling NO acepta anónimos (false — 🔒 solo leads)', () => {
    expect(band_accepts_anon('cooling')).toBe(false);
  });
});
