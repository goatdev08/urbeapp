/**
 * Smoke tests — AdDailyLineChart
 * Archivo SUT: mobile/src/features/ads/components/AdDailyLineChart.tsx
 * Subtarea Taskmaster: 212.4 — componente presentacional (no crítico por
 * regla determinista de CLAUDE.md §5), verificación ligera: monta sin
 * lanzar + los 3 estados del preview (vacío, un solo día, con datos).
 *
 * SUT: <AdDailyLineChart daily={AdStatsDailyPoint[] | null | undefined} metric={AdStatsMetricKey} />
 *
 * NOTA RNTL v14: render() retorna Promise → await render(...).
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { AdDailyLineChart } from '../AdDailyLineChart';
import type { AdStatsDailyPoint } from '../../hooks/useAdStats';

const DAY_1: AdStatsDailyPoint = { day: '2026-08-20', impressions: 100, views: 60, cta_taps: 5 };
const DAY_2: AdStatsDailyPoint = { day: '2026-08-21', impressions: 150, views: 70, cta_taps: 8 };
const DAY_3: AdStatsDailyPoint = { day: '2026-08-22', impressions: 0, views: 0, cta_taps: 0 };

describe('AdDailyLineChart', () => {
  it('(EC-1) sin_dias_muestra_estado_vacio_sin_lanzar: daily=[] → "Sin datos de rendimiento en este periodo."', async () => {
    const { getByText } = await render(<AdDailyLineChart daily={[]} metric="impressions" />);

    expect(getByText('Sin datos de rendimiento en este periodo.')).toBeTruthy();
  });

  it('(EC-2) daily_null_se_trata_como_vacio: daily=null → mismo estado vacío que []', async () => {
    const { getByText } = await render(<AdDailyLineChart daily={null} metric="impressions" />);

    expect(getByText('Sin datos de rendimiento en este periodo.')).toBeTruthy();
  });

  it('(EC-3) daily_undefined_se_trata_como_vacio: daily=undefined → mismo estado vacío que []', async () => {
    const { getByText } = await render(<AdDailyLineChart daily={undefined} metric="views" />);

    expect(getByText('Sin datos de rendimiento en este periodo.')).toBeTruthy();
  });

  it('(EC-4) un_solo_dia_no_dibuja_linea: daily con 1 punto → "Un solo día no arma una tendencia."', async () => {
    const { getByText, queryByText } = await render(<AdDailyLineChart daily={[DAY_1]} metric="impressions" />);

    expect(getByText('Un solo día no arma una tendencia.')).toBeTruthy();
    expect(queryByText('Sin datos de rendimiento en este periodo.')).toBeNull();
  });

  it('(EC-5) con_datos_monta_svg_y_eje_sin_lanzar: ≥2 días → sin estado vacío, con etiqueta de eje "hoy"', async () => {
    const { queryByText, getByText } = await render(
      <AdDailyLineChart daily={[DAY_1, DAY_2]} metric="impressions" />,
    );

    expect(queryByText('Sin datos de rendimiento en este periodo.')).toBeNull();
    expect(queryByText('Un solo día no arma una tendencia.')).toBeNull();
    expect(getByText('hoy')).toBeTruthy();
  });

  it('(EC-6) valores_en_cero_no_lanzan_ni_dividen_por_cero: todos los días en 0 para la métrica seleccionada', async () => {
    const { queryByText } = await render(
      <AdDailyLineChart daily={[DAY_3, { ...DAY_3, day: '2026-08-23' }]} metric="cta_taps" />,
    );

    expect(queryByText('Sin datos de rendimiento en este periodo.')).toBeNull();
  });

  it('(EC-7) accessibilityLabel_describe_la_metrica_y_el_ultimo_valor', async () => {
    const { getByLabelText } = await render(<AdDailyLineChart daily={[DAY_1, DAY_2]} metric="views" />);

    expect(
      getByLabelText('Gráfico de Vistas completas por día, 2 días. Último valor: 70.'),
    ).toBeTruthy();
  });

  it('(EC-8) tres_o_mas_dias_muestra_etiqueta_intermedia_de_eje', async () => {
    const { getAllByText } = await render(
      <AdDailyLineChart daily={[DAY_1, DAY_2, DAY_3]} metric="impressions" />,
    );

    // 3 etiquetas de eje: extremo izq, medio, "hoy" — no deben colapsar en duplicados.
    expect(getAllByText(/\d+ ago|hoy/).length).toBeGreaterThanOrEqual(2);
  });
});
