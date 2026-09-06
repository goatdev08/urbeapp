/**
 * Test — cacheKey estable en expo-image para el avatar de ProfileHeader (#263).
 * Archivo SUT: mobile/src/features/profile/components/ProfileHeader.tsx
 *
 * POR QUÉ (tarea #263, feedback de Abraham 2026-09-05 — fotos de perfil
 * lentas en TODOS los tipos de perfil): la URL presigned de R2 cambia en
 * cada invoke a mint-r2-url, así que expo-image nunca acertaba su caché en
 * disco por URL. `source.cacheKey` (la KEY de R2, estable) permite que
 * expo-image acierte su caché aunque la URL firmada cambie entre sesiones.
 *
 * Mismo patrón de mock que AgentCard.test.tsx: useR2Urls como jest.fn()
 * a nivel de módulo, valor por test vía mockReturnValue.
 *
 * EDGE CASES CUBIERTOS:
 * - (CK-1) key_r2_real_pasa_como_cacheKey: profile_photo_url es una key R2
 *   (sin prefijo http) → <Image> recibe source.cacheKey === esa key.
 * - (CK-2) url_legacy_http_sin_cacheKey: profile_photo_url es una URL legacy
 *   http(s) → <Image> recibe source SIN cacheKey (la URL ya es estable).
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { useR2Urls } from '@/hooks/useR2Urls';
import { ProfileHeader } from '../ProfileHeader';
import type { AgentProfile } from '../../types';

const mock_image = jest.fn((_props: Record<string, unknown>) => null);

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => mock_image(props),
}));

jest.mock('@/hooks/useR2Urls', () => ({
  useR2Urls: jest.fn(),
}));

jest.mock('../ProfessionalStats', () => ({
  ProfessionalStats: () => null,
}));

jest.mock('../ProfileActions', () => ({
  ProfileActions: () => null,
}));

const mock_use_r2_urls = useR2Urls as jest.MockedFunction<typeof useR2Urls>;

const FIXTURE_AGENT_USER_ID = 'agente-uuid-fixture-263';
const TEST_KEY = 'avatars/user-1/uuid-1';
const TEST_URL = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-1/uuid-1?sig=1';
const TEST_LEGACY_URL = 'https://xyzproj.supabase.co/storage/v1/object/public/profile-photos/user-9/avatar.jpg';

function make_profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    full_name: 'Andrea Landeros',
    profile_photo_url: TEST_KEY,
    bio: null,
    has_phone: false,
    member_since: '2026-08-01T10:00:00Z',
    agency_name: null,
    ...overrides,
  };
}

beforeEach(() => {
  mock_image.mockClear();
  mock_use_r2_urls.mockReset();
});

describe('ProfileHeader — cacheKey estable en expo-image (#263)', () => {
  it('(CK-1) key_r2_real_pasa_como_cacheKey: Image recibe source.cacheKey igual a la key R2', async () => {
    mock_use_r2_urls.mockReturnValue({ urls: [TEST_URL], loading: false });

    await render(
      <ProfileHeader
        profile={make_profile({ profile_photo_url: TEST_KEY })}
        agent_user_id={FIXTURE_AGENT_USER_ID}
      />,
    );

    expect(mock_image).toHaveBeenCalledWith(
      expect.objectContaining({
        source: expect.objectContaining({ uri: TEST_URL, cacheKey: TEST_KEY }),
      }),
    );
  });

  it('(CK-2) url_legacy_http_sin_cacheKey: Image recibe source SIN cacheKey para una URL legacy', async () => {
    mock_use_r2_urls.mockReturnValue({ urls: [TEST_LEGACY_URL], loading: false });

    await render(
      <ProfileHeader
        profile={make_profile({ profile_photo_url: TEST_LEGACY_URL })}
        agent_user_id={FIXTURE_AGENT_USER_ID}
      />,
    );

    const [call_props] = mock_image.mock.calls[mock_image.mock.calls.length - 1]!;
    const source = (call_props as { source: { uri: string; cacheKey?: string } }).source;
    expect(source.uri).toBe(TEST_LEGACY_URL);
    expect(source.cacheKey).toBeUndefined();
  });
});
