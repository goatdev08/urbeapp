/**
 * Tests — nombre público en la cabecera del perfil (#254).
 * Archivo SUT: mobile/src/features/profile/components/ProfileHeader.tsx
 *
 * POR QUÉ (smoke de producción #222, paso 7, 2026-09-03)
 *   Andrea (role='user', con nombre puesto en «Editar perfil») se mostraba como
 *   «Agente Urbea». La causa estaba en el backend — la vista agent_public_profiles
 *   excluía role='user' y el registro no sembraba user_preferences.full_name —,
 *   pero el fallback del componente es lo que el usuario ve, así que aquí se fija
 *   el contrato: el nombre que llega SIEMPRE gana, y «Agente Urbea» aparece
 *   ÚNICAMENTE cuando de verdad no hay nombre.
 *
 * EDGE CASES:
 * - (PH-1) nombre_presente_se_muestra_tal_cual (cualquier rol, incluido role=user)
 * - (PH-2) fallback_agente_urbea_solo_con_nombre_null
 * - (PH-3) sin_fila_de_users_el_perfil_igual_pinta_el_nombre (member_since null, #250)
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ProfileHeader } from '../ProfileHeader';
import type { AgentProfile } from '../../types';

jest.mock('@/hooks/useR2Urls', () => ({
  useR2Urls: () => ({ urls: [null], loading: false }),
}));

jest.mock('../ProfessionalStats', () => ({
  ProfessionalStats: () => null,
}));

jest.mock('../ProfileActions', () => ({
  ProfileActions: () => null,
}));

// `agent_user_id` es requerido en ProfileHeaderProps (post-guardian, #255) —
// ProfileActions está mockeado aquí y no le importa el valor, solo hace
// falta satisfacer el tipo.
const FIXTURE_AGENT_USER_ID = 'agente-uuid-fixture-254';

function make_profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    full_name: 'Andrea Landeros',
    profile_photo_url: null,
    bio: null,
    // #255: `phone` salió de AgentProfile (reemplazado por `has_phone`,
    // derivado). ProfileActions está mockeado en esta suite (no le importa
    // el valor), así que false es un fixture neutro.
    has_phone: false,
    member_since: '2026-08-01T10:00:00Z',
    agency_name: null,
    ...overrides,
  };
}

describe('ProfileHeader — nombre público (#254)', () => {
  it('(PH-1) nombre_presente_se_muestra_tal_cual: el nombre de «Editar perfil» gana, sea cual sea el rol', async () => {
    const { getByText, queryByText } = await render(
      <ProfileHeader profile={make_profile()} agent_user_id={FIXTURE_AGENT_USER_ID} />,
    );

    expect(getByText('Andrea Landeros')).toBeTruthy();
    expect(queryByText('Agente Urbea')).toBeNull();
  });

  it('(PH-2) fallback_agente_urbea_solo_con_nombre_null: sin nombre (y solo entonces) cae al genérico', async () => {
    const { getByText } = await render(
      <ProfileHeader profile={make_profile({ full_name: null })} agent_user_id={FIXTURE_AGENT_USER_ID} />,
    );

    expect(getByText('Agente Urbea')).toBeTruthy();
  });

  it('(PH-3) sin_fila_de_users_el_perfil_igual_pinta_el_nombre: member_since null (users invisible por RLS, #250) no rompe la cabecera', async () => {
    const { getByText, queryByText } = await render(
      <ProfileHeader profile={make_profile({ member_since: null })} agent_user_id={FIXTURE_AGENT_USER_ID} />,
    );

    expect(getByText('Andrea Landeros')).toBeTruthy();
    expect(queryByText(/Miembro desde/)).toBeNull();
  });
});
