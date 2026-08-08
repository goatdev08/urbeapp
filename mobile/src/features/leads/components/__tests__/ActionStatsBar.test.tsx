/**
 * Smoke tests — ActionStatsBar component
 * Archivo SUT: mobile/src/features/leads/components/ActionStatsBar.tsx
 * Subtarea Taskmaster: 112.4 — componente presentacional (no crítico por
 * regla determinista de CLAUDE.md §5), verificación ligera: monta sin
 * lanzar + las dos ramas de contenido (con/sin estadísticas, compact/full).
 *
 * SUT: <ActionStatsBar stats={LeadStats | undefined} compact?={boolean} />
 *
 * Contrato (ver header del SUT):
 *   - stats=undefined → texto "Sin señales todavía", sin barra.
 *   - stats definido, compact=false (default) → barra + 4 etiquetas de tramo
 *     ("Like", "Video completo", "Guardó", "Volvió a ver").
 *   - stats definido, compact=true → barra SIN etiquetas (lista de leads).
 *   - "Contactó" NUNCA aparece como etiqueta (decisión del dueño — tramo
 *     siempre lleno, sin información).
 *
 * NOTA RNTL v14: render() retorna Promise → await render(...).
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActionStatsBar } from '../ActionStatsBar';
import type { LeadStats } from '../../types';

const STATS: LeadStats = {
  vio_completo: true,
  veces_visto: 2,
  guardo: true,
  ultima_actividad: '2026-08-07T12:00:00Z',
};

describe('ActionStatsBar', () => {
  it('(EC-1) sin_stats_muestra_sin_senales_todavia_sin_lanzar: stats=undefined → "Sin señales todavía", sin barra', async () => {
    const { getByText, queryByText } = await render(<ActionStatsBar stats={undefined} />);

    expect(getByText('Sin señales todavía')).toBeTruthy();
    expect(queryByText('Like')).toBeNull();
  });

  it('(EC-2) con_stats_full_muestra_las_4_etiquetas_de_tramo_sin_contacto: compact=false (default) → 4 labels, "Contactó" nunca aparece', async () => {
    const { getByText, queryByText } = await render(<ActionStatsBar stats={STATS} />);

    expect(getByText('Like')).toBeTruthy();
    expect(getByText('Video completo')).toBeTruthy();
    expect(getByText('Guardó')).toBeTruthy();
    expect(getByText('Volvió a ver')).toBeTruthy();
    expect(queryByText('Contactó')).toBeNull();
  });

  it('(EC-3) con_stats_compact_no_muestra_etiquetas: compact=true (LeadCard) → sin etiquetas de tramo, se lee de un vistazo', async () => {
    const { queryByText } = await render(<ActionStatsBar stats={STATS} compact />);

    expect(queryByText('Like')).toBeNull();
    expect(queryByText('Video completo')).toBeNull();
  });

  it('(EC-4) stats_undefined_compact_tambien_muestra_sin_senales: el estado "sin señales" no depende de compact', async () => {
    const { getByText } = await render(<ActionStatsBar stats={undefined} compact />);

    expect(getByText('Sin señales todavía')).toBeTruthy();
  });
});
