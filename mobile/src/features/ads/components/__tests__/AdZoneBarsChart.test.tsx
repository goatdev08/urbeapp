/**
 * Smoke tests — AdZoneBarsChart
 * Archivo SUT: mobile/src/features/ads/components/AdZoneBarsChart.tsx
 * Subtarea Taskmaster: 212.4 — componente presentacional (no crítico por
 * regla determinista de CLAUDE.md §5), verificación ligera: monta sin
 * lanzar + estado vacío, con zonas reales, bucket "Otras zonas", y
 * resolución de nombre (con/sin mapa).
 *
 * SUT: <AdZoneBarsChart zones={AdStatsZoneRow[] | null | undefined} ... />
 *
 * NOTA RNTL v14: render() retorna Promise → await render(...).
 */
import React from 'react';
import { render } from '@testing-library/react-native';

import { AdZoneBarsChart, OTHER_ZONES_CAPTION, OTHER_ZONES_LABEL } from '../AdZoneBarsChart';
import type { AdStatsZoneRow } from '../../hooks/useAdStats';

const PROVIDENCIA: AdStatsZoneRow = {
  municipality_id: 'mun-1',
  neighborhood_id: 101,
  impressions: 2140,
  views: 560,
  cta_taps: 39,
};
const CHAPALITA: AdStatsZoneRow = {
  municipality_id: 'mun-1',
  neighborhood_id: 102,
  impressions: 1320,
  views: 340,
  cta_taps: 24,
};
const OTHER_BUCKET: AdStatsZoneRow = {
  municipality_id: null,
  neighborhood_id: null,
  impressions: 580,
  views: 150,
  cta_taps: 8,
};

describe('AdZoneBarsChart', () => {
  it('(EC-1) sin_zonas_muestra_estado_vacio_sin_lanzar: zones=[] → "Aún no hay datos por zona en este periodo."', async () => {
    const { getByText } = await render(<AdZoneBarsChart zones={[]} />);

    expect(getByText('Aún no hay datos por zona en este periodo.')).toBeTruthy();
  });

  it('(EC-2) zones_null_se_trata_como_vacio', async () => {
    const { getByText } = await render(<AdZoneBarsChart zones={null} />);

    expect(getByText('Aún no hay datos por zona en este periodo.')).toBeTruthy();
  });

  it('(EC-3) zones_undefined_se_trata_como_vacio', async () => {
    const { getByText } = await render(<AdZoneBarsChart zones={undefined} />);

    expect(getByText('Aún no hay datos por zona en este periodo.')).toBeTruthy();
  });

  it('(EC-4) sin_mapa_de_nombres_usa_fallback_humanizado: neighborhood_id sin match en el mapa → "Colonia sin nombre"', async () => {
    const { getByText } = await render(<AdZoneBarsChart zones={[PROVIDENCIA]} />);

    expect(getByText('Colonia sin nombre')).toBeTruthy();
  });

  it('(EC-5) con_mapa_de_nombres_resuelve_el_nombre_real', async () => {
    const { getByText, queryByText } = await render(
      <AdZoneBarsChart zones={[PROVIDENCIA]} neighborhood_names={{ 101: 'Providencia' }} />,
    );

    expect(getByText('Providencia')).toBeTruthy();
    expect(queryByText('Colonia sin nombre')).toBeNull();
  });

  it('(EC-6) bucket_otras_zonas_va_al_final_con_label_y_caption_fijos', async () => {
    const { getByText } = await render(
      <AdZoneBarsChart
        zones={[OTHER_BUCKET, PROVIDENCIA]}
        neighborhood_names={{ 101: 'Providencia' }}
      />,
    );

    expect(getByText(OTHER_ZONES_LABEL)).toBeTruthy();
    expect(getByText(OTHER_ZONES_CAPTION)).toBeTruthy();
  });

  it('(EC-7) zonas_reales_ordenan_descendente_por_impressions_y_muestran_conteo_completo', async () => {
    const { getByText } = await render(
      <AdZoneBarsChart
        zones={[CHAPALITA, PROVIDENCIA]}
        neighborhood_names={{ 101: 'Providencia', 102: 'Chapalita' }}
      />,
    );

    // Conteo con separador de miles completo (NO compactado a "k").
    expect(getByText('2,140 · 560 · 39')).toBeTruthy();
    expect(getByText('1,320 · 340 · 24')).toBeTruthy();
  });

  it('(EC-8) solo_bucket_sin_zonas_reales_no_lanza', async () => {
    const { getByText } = await render(<AdZoneBarsChart zones={[OTHER_BUCKET]} />);

    expect(getByText(OTHER_ZONES_LABEL)).toBeTruthy();
  });

  it('(EC-9) accessibilityLabel_describe_el_desglose', async () => {
    const { getByLabelText } = await render(
      <AdZoneBarsChart zones={[PROVIDENCIA, CHAPALITA, OTHER_BUCKET]} />,
    );

    expect(getByLabelText('Desglose de audiencia por zona — 2 zonas + otras zonas.')).toBeTruthy();
  });
});
