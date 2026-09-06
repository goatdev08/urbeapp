/**
 * Test — cacheKey estable en expo-image para el avatar del agente en el
 * overlay del feed (#263).
 * Archivo SUT: mobile/src/features/feed/components/PropertyOverlay.tsx
 *
 * POR QUÉ (tarea #263): la URL presigned de R2 cambia en cada invoke a
 * mint-r2-url, así que expo-image nunca acertaba su caché en disco por URL —
 * en el feed, varias propiedades del mismo publicador repetían la descarga
 * de la misma foto. `source.cacheKey` (la KEY de R2, estable) resuelve esto.
 *
 * EDGE CASES CUBIERTOS:
 * - (CK-1) key_r2_real_pasa_como_cacheKey: agent_photo_url es una key R2
 *   (sin prefijo http) → <Image> recibe source.cacheKey === esa key.
 * - (CK-2) url_legacy_http_sin_cacheKey: agent_photo_url es una URL legacy
 *   http(s) → <Image> recibe source SIN cacheKey (la URL ya es estable).
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { useR2Urls } from '@/hooks/useR2Urls';
import { PropertyOverlay } from '../PropertyOverlay';
import type { FeedPropertyWithUrl } from '../../types';

const mock_image = jest.fn((_props: Record<string, unknown>) => null);

jest.mock('expo-image', () => ({
  Image: (props: Record<string, unknown>) => mock_image(props),
}));

jest.mock('expo-linear-gradient', () => ({
  LinearGradient: () => null,
}));

jest.mock('phosphor-react-native', () => ({
  Bathtub: () => null,
  Bed: () => null,
  BookmarkSimple: () => null,
  Heart: () => null,
  ShareNetwork: () => null,
  WhatsappLogo: () => null,
}));

jest.mock('@/hooks/useR2Urls', () => ({
  useR2Urls: jest.fn(),
}));

const mock_use_r2_urls = useR2Urls as jest.MockedFunction<typeof useR2Urls>;

const TEST_KEY = 'avatars/user-1/uuid-1';
const TEST_URL = 'https://abc.r2.cloudflarestorage.com/urbea-assets/avatars/user-1/uuid-1?sig=1';
const TEST_LEGACY_URL = 'https://xyzproj.supabase.co/storage/v1/object/public/profile-photos/user-9/avatar.jpg';

function make_property(overrides: Partial<FeedPropertyWithUrl> = {}): FeedPropertyWithUrl {
  return {
    id: 'propiedad-uuid-A',
    price: 15000,
    operation_type: 'rent',
    property_type: 'departamento',
    currency: 'MXN',
    price_visible: true,
    address: 'Calle Falsa 123, CDMX',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'agente-uuid-1',
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_has_phone: false,
    agent_name: 'Vladimir Ramos',
    agent_photo_url: TEST_KEY,
    video: { id: 'video-uuid-A', storage_path: 'x/y.mp4', position: 0, thumbnail_url: null },
    signed_url: 'https://cdn.example/video-A.mp4',
    video_id: 'video-uuid-A',
    posterUrl: null,
    ...overrides,
  };
}

const NOOP = () => {};

beforeEach(() => {
  mock_image.mockClear();
  mock_use_r2_urls.mockReset();
});

describe('PropertyOverlay — cacheKey estable en expo-image (#263)', () => {
  it('(CK-1) key_r2_real_pasa_como_cacheKey: Image recibe source.cacheKey igual a la key R2', async () => {
    mock_use_r2_urls.mockReturnValue({ urls: [TEST_URL], loading: false });

    await render(
      <PropertyOverlay
        property={make_property({ agent_photo_url: TEST_KEY })}
        isLiked={false}
        isSaved={false}
        onLike={NOOP}
        onSave={NOOP}
        onAgentPress={NOOP}
        onPropertyPress={NOOP}
        onWhatsApp={null}
        onShare={NOOP}
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
      <PropertyOverlay
        property={make_property({ agent_photo_url: TEST_LEGACY_URL })}
        isLiked={false}
        isSaved={false}
        onLike={NOOP}
        onSave={NOOP}
        onAgentPress={NOOP}
        onPropertyPress={NOOP}
        onWhatsApp={null}
        onShare={NOOP}
      />,
    );

    const [call_props] = mock_image.mock.calls[mock_image.mock.calls.length - 1]!;
    const source = (call_props as { source: { uri: string; cacheKey?: string } }).source;
    expect(source.uri).toBe(TEST_LEGACY_URL);
    expect(source.cacheKey).toBeUndefined();
  });
});
