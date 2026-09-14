/**
 * PropertyOverlay.like-count.test.tsx — 293.3: conteo bajo el corazón.
 * Archivo SUT: mobile/src/features/feed/components/PropertyOverlay.tsx
 *
 * PropertyOverlay es presentacional: pinta `likeCount` tal cual se lo pasan
 * (la regla optimista `max(0, property.like_count + (isLiked?1:0))` vive en
 * VideoFeedItem.tsx, cubierta en VideoFeedItem.test.tsx LC-1/LC-2/LC-3). Aquí
 * solo se prueba el formato (format_count de LikeButton.tsx) y la ocultación
 * en 0 — mismo criterio que comment_count (PropertyOverlay.comments.test.tsx).
 *
 * Calca el patrón de mocks de PropertyOverlay.comments.test.tsx (mismo
 * archivo SUT, mismos módulos nativos a stubear).
 *
 * EDGE CASES:
 * - (LK-1) conteo_formateado_visible_con_like_count_1200: "1.2k" visible.
 * - (LK-2) conteo_ausente_con_like_count_cero: sin texto "0" bajo el corazón.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { useR2Urls } from '@/hooks/useR2Urls';
import { PropertyOverlay } from '../PropertyOverlay';
import type { FeedPropertyWithUrl } from '../../types';

jest.mock('expo-image', () => ({
  Image: () => null,
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
  ChatCircle: () => null,
}));

jest.mock('@/hooks/useR2Urls', () => ({
  useR2Urls: jest.fn(),
}));

// FollowButton (78.4) llama useFollow → useAuth; esta suite no envuelve en
// AuthProvider (no es lo que se prueba aquí).
jest.mock('@/features/profile/hooks/useFollow', () => ({
  useFollow: () => ({ is_following: false, loading: false, is_own: false, toggle_follow: jest.fn() }),
}));

const mock_use_r2_urls = useR2Urls as jest.MockedFunction<typeof useR2Urls>;

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
    agent_photo_url: null,
    video: { id: 'video-uuid-A', storage_path: 'x/y.mp4', position: 0, thumbnail_url: null },
    signed_url: 'https://cdn.example/video-A.mp4',
    video_id: 'video-uuid-A',
    posterUrl: null,
    ...overrides,
  };
}

const NOOP = () => {};

beforeEach(() => {
  mock_use_r2_urls.mockReset();
  mock_use_r2_urls.mockReturnValue({ urls: [null], loading: false });
});

describe('PropertyOverlay — conteo bajo el corazón (293.3)', () => {
  it('(LK-1) conteo_formateado_visible_con_like_count_1200: likeCount=1200 → el texto "1.2k" es visible', async () => {
    const { queryByText } = await render(
      <PropertyOverlay
        property={make_property()}
        isLiked={false}
        isSaved={false}
        onLike={NOOP}
        onSave={NOOP}
        onAgentPress={NOOP}
        onPropertyPress={NOOP}
        onWhatsApp={null}
        onShare={NOOP}
        likeCount={1200}
      />,
    );

    expect(queryByText('1.2k')).not.toBeNull();
  });

  it('(LK-2) conteo_ausente_con_like_count_cero: likeCount=0 → no hay texto "0" bajo el corazón', async () => {
    const { queryByText } = await render(
      <PropertyOverlay
        property={make_property()}
        isLiked={false}
        isSaved={false}
        onLike={NOOP}
        onSave={NOOP}
        onAgentPress={NOOP}
        onPropertyPress={NOOP}
        onWhatsApp={null}
        onShare={NOOP}
        likeCount={0}
      />,
    );

    expect(queryByText('0')).toBeNull();
  });
});
