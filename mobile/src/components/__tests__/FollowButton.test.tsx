/**
 * Tests — FollowButton (tarea #78 «follow de cuentas F1», subtarea 78.4)
 * Archivo SUT: mobile/src/components/FollowButton.tsx
 *
 * Píldora reusable que envuelve useFollow (78.3) — mockeado aquí a nivel de
 * módulo (SEAM: el hook ya tiene su propia suite, useFollow.test.tsx; aquí
 * se prueba solo el comportamiento observable del componente sobre lo que
 * useFollow devuelve).
 *
 * EDGE CASES:
 * - (FB-1) is_own_no_renderiza_nada
 * - (FB-2) loading_deshabilita_la_pildora
 * - (FB-3) no_sigue_label_seguir_y_press_llama_toggle_follow
 * - (FB-4) sigue_label_siguiendo_y_accessibility_state_selected
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

import { useFollow } from '@/features/profile/hooks/useFollow';
import { FollowButton } from '../FollowButton';

jest.mock('@/features/profile/hooks/useFollow', () => ({
  useFollow: jest.fn(),
}));

const mock_use_follow = useFollow as jest.MockedFunction<typeof useFollow>;

const FOLLOWED_USER_ID = 'agente-uuid-78-4';

function mock_follow_state(overrides: Partial<ReturnType<typeof useFollow>> = {}) {
  const toggle_follow = jest.fn().mockResolvedValue(undefined);
  mock_use_follow.mockReturnValue({
    is_following: false,
    loading: false,
    is_own: false,
    toggle_follow,
    ...overrides,
  });
  return toggle_follow;
}

beforeEach(() => {
  mock_use_follow.mockReset();
});

describe('FollowButton — píldora reusable (78.4)', () => {
  it('(FB-1) is_own_no_renderiza_nada: is_own=true → el componente no pinta nada', async () => {
    mock_follow_state({ is_own: true });

    const { toJSON } = await render(
      <FollowButton followed_user_id={FOLLOWED_USER_ID} variant="dark" testID="follow-button" />,
    );

    expect(toJSON()).toBeNull();
  });

  it('(FB-2) loading_deshabilita_la_pildora: loading=true → la píldora se renderiza deshabilitada (sin spinner)', async () => {
    mock_follow_state({ loading: true });

    const { getByTestId } = await render(
      <FollowButton followed_user_id={FOLLOWED_USER_ID} variant="dark" testID="follow-button" />,
    );

    expect(getByTestId('follow-button').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it('(FB-3) no_sigue_label_seguir_y_press_llama_toggle_follow: is_following=false → label "Seguir" y el press invoca toggle_follow', async () => {
    const toggle_follow = mock_follow_state({ is_following: false });

    const { getByText, getByTestId } = await render(
      <FollowButton followed_user_id={FOLLOWED_USER_ID} variant="light" testID="follow-button" />,
    );

    expect(getByText('Seguir')).toBeTruthy();

    await fireEvent.press(getByTestId('follow-button'));

    expect(toggle_follow).toHaveBeenCalledTimes(1);
  });

  it('(FB-4) sigue_label_siguiendo_y_accessibility_state_selected: is_following=true → label "Siguiendo" y accessibilityState.selected=true', async () => {
    mock_follow_state({ is_following: true });

    const { getByText, getByTestId } = await render(
      <FollowButton followed_user_id={FOLLOWED_USER_ID} variant="dark" testID="follow-button" />,
    );

    expect(getByText('Siguiendo')).toBeTruthy();
    expect(getByTestId('follow-button').props.accessibilityState).toEqual(
      expect.objectContaining({ selected: true }),
    );
  });
});
