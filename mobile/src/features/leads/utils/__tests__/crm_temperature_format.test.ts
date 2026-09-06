/**
 * crm_temperature_format.test.ts — RED (subtarea 267.3).
 *
 * Contrato: formateo puro de temperatura/delta para la UI del CRM.
 * Fuente del default de ventana: coalesce(...,3) en
 * supabase/migrations/20260906100003_crm_leads_page_funnel.sql:155-158.
 */

import { colors } from '@/theme/theme';

import {
  CRM_TREND_WINDOW_DAYS,
  format_degrees,
  format_delta,
  temperature_color,
} from '../crm_temperature_format';

describe('CRM_TREND_WINDOW_DAYS', () => {
  it('espeja el default de app_config crm_trend_window_days: exactamente 3', () => {
    expect(CRM_TREND_WINDOW_DAYS).toBe(3);
  });
});

describe('format_degrees', () => {
  it('formatea un entero con el símbolo de grado', () => {
    expect(format_degrees(94)).toBe('94°');
  });

  it('redondea decimales (93.6 → 94°)', () => {
    expect(format_degrees(93.6)).toBe('94°');
  });

  it('clampa el piso: -3 → 0°', () => {
    expect(format_degrees(-3)).toBe('0°');
  });

  it('clampa el techo: 140 → 100°', () => {
    expect(format_degrees(140)).toBe('100°');
  });
});

describe('format_delta', () => {
  it('positivo: 22 → "+22 en 3 d"', () => {
    expect(format_delta(22)).toBe('+22 en 3 d');
  });

  it('negativo: -5 → "−5 en 3 d" (signo menos tipográfico U+2212, NO guion ASCII)', () => {
    const result = format_delta(-5);
    expect(result).toBe('−5 en 3 d');
    expect(result).not.toBe('-5 en 3 d');
  });

  it('cero: 0 → "sin cambio" (sin signo, plantilla propia)', () => {
    expect(format_delta(0)).toBe('sin cambio');
  });

  it('respeta un days custom: días=7 → "+22 en 7 d"', () => {
    expect(format_delta(22, 7)).toBe('+22 en 7 d');
  });

  it('redondea decimales pequeños a sin cambio: 0.4 → "sin cambio"', () => {
    expect(format_delta(0.4)).toBe('sin cambio');
  });

  it('redondea decimales hacia el entero más cercano: 1.6 → "+2 en 3 d"', () => {
    expect(format_delta(1.6)).toBe('+2 en 3 d');
  });
});

describe('temperature_color', () => {
  it('banda silent en el borde inferior: 29 → temp_silent', () => {
    expect(temperature_color(29)).toBe(colors.temp_silent);
  });

  it('cruza a warming en el borde: 30 → temp_warming', () => {
    expect(temperature_color(30)).toBe(colors.temp_warming);
  });

  it('banda warming en su borde superior: 59 → temp_warming', () => {
    expect(temperature_color(59)).toBe(colors.temp_warming);
  });

  it('cruza a cooling en el borde: 60 → temp_cooling', () => {
    expect(temperature_color(60)).toBe(colors.temp_cooling);
  });

  it('banda cooling en su borde superior: 79 → temp_cooling', () => {
    expect(temperature_color(79)).toBe(colors.temp_cooling);
  });

  it('cruza a hot en el borde: 80 → temp_hot', () => {
    expect(temperature_color(80)).toBe(colors.temp_hot);
  });

  it('extremo inferior: 0 → temp_silent', () => {
    expect(temperature_color(0)).toBe(colors.temp_silent);
  });

  it('extremo superior: 100 → temp_hot', () => {
    expect(temperature_color(100)).toBe(colors.temp_hot);
  });

  it('clamp fuera de rango por abajo: -20 → temp_silent (no explota, no NaN)', () => {
    expect(temperature_color(-20)).toBe(colors.temp_silent);
  });

  it('clamp fuera de rango por arriba: 150 → temp_hot', () => {
    expect(temperature_color(150)).toBe(colors.temp_hot);
  });
});
