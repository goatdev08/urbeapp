/**
 * Tests — ProfessionalStats (tarea #78 «follow de cuentas F1», subtarea 78.4)
 * Archivo SUT: mobile/src/features/profile/components/ProfessionalStats.tsx
 *
 * Columnas unificadas (78.4): propio Y ajeno muestran las MISMAS 3
 * (Publicaciones · Seguidores · Me gusta) — "Guardados" salió del todo.
 * `follower_count` es prop nueva (agent_public_profiles.follower_count).
 *
 * EDGE CASES:
 * - (PS-1) muestra_seguidores_con_el_conteo
 * - (PS-2) no_muestra_guardados
 * - (PS-3) loading_muestra_guiones_pero_seguidores_no_depende_de_loading
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ProfessionalStats } from '../ProfessionalStats';
import type { AgentStats } from '../../hooks/useAgentStats';

const STATS: AgentStats = { publications: 3, saves: 7, likes: 42 };

describe('ProfessionalStats — columnas unificadas (78.4)', () => {
  it('(PS-1) muestra_seguidores_con_el_conteo: la columna «Seguidores» pinta follower_count', async () => {
    const { getByText } = await render(
      <ProfessionalStats stats={STATS} loading={false} follower_count={128} />,
    );

    expect(getByText('Seguidores')).toBeTruthy();
    expect(getByText('128')).toBeTruthy();
  });

  it('(PS-2) no_muestra_guardados: la columna «Guardados» ya no existe', async () => {
    const { queryByText } = await render(
      <ProfessionalStats stats={STATS} loading={false} follower_count={0} />,
    );

    expect(queryByText('Guardados')).toBeNull();
  });

  it('(PS-3) loading_muestra_guiones_pero_seguidores_no_depende_de_loading: con loading=true, Publicaciones/Me gusta caen a "—" pero Seguidores sigue mostrando su conteo', async () => {
    const { getByText, getAllByText } = await render(
      <ProfessionalStats stats={null} loading={true} follower_count={5} />,
    );

    expect(getByText('5')).toBeTruthy();
    // Publicaciones y Me gusta, ambas en "—" (stats aún no resuelve).
    expect(getAllByText('—')).toHaveLength(2);
  });
});
