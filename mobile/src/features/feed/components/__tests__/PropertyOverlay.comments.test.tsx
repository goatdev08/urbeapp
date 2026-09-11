/**
 * PropertyOverlay.comments.test.tsx — RED de la subtarea 289.10 (tarea #289).
 * Archivo SUT: mobile/src/features/feed/components/PropertyOverlay.tsx
 *
 * Decisión de Abraham (2026-09-11, tras el smoke): el botón de comentarios
 * vive en el rail del feed (PropertyOverlay), junto a like/guardar/WhatsApp/
 * compartir, con el contador `comment_count`. `onComments`/`commentCount` son
 * PROPS NUEVAS (stub de tipo en PropertyOverlay.tsx, opcionales para no
 * romper PropertyOverlay.cacheKey.test.tsx) — el componente hoy NO las
 * destructura ni renderiza el botón: los 4 casos de abajo fallan hasta GREEN.
 *
 * Calca el patrón de mocks de PropertyOverlay.cacheKey.test.tsx (mismo
 * archivo SUT, mismos módulos nativos a stubear).
 *
 * SEAM: <PropertyOverlay onComments commentCount ...demás props existentes />
 * — comportamiento observable (testID + accessibilityLabel + tap + contador),
 * no estructura interna.
 *
 * EDGE CASES:
 * - (OC-1) boton_comentarios_tiene_testid_y_accesibilidad
 * - (OC-2) tap_boton_comentarios_invoca_on_comments_una_vez
 * - (OC-3) contador_visible_cuando_comment_count_mayor_a_cero
 * - (OC-4) contador_ausente_cuando_comment_count_es_cero
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

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
  ChatCircle: () => null,
}));

jest.mock('@/hooks/useR2Urls', () => ({
  useR2Urls: jest.fn(),
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
    comment_count: 5,
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
  mock_use_r2_urls.mockReturnValue({ urls: [null], loading: false });
});

describe('PropertyOverlay — botón de comentarios en el rail (289.10)', () => {
  it('(OC-1) boton_comentarios_tiene_testid_y_accesibilidad: el rail expone un botón con testID "overlay-comments-btn" y accessibilityLabel "Comentarios"', async () => {
    const { queryByTestId, queryByLabelText } = await render(
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
        onComments={NOOP}
        commentCount={5}
      />,
    );

    expect(queryByTestId('overlay-comments-btn')).not.toBeNull();
    expect(queryByLabelText('Comentarios')).not.toBeNull();
  });

  it('(OC-2) tap_boton_comentarios_invoca_on_comments_una_vez: press en el botón → onComments se invoca exactamente 1 vez', async () => {
    const on_comments = jest.fn();

    const { queryByTestId } = await render(
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
        onComments={on_comments}
        commentCount={5}
      />,
    );

    const btn = queryByTestId('overlay-comments-btn');
    expect(btn).not.toBeNull();
    fireEvent.press(btn!);

    expect(on_comments).toHaveBeenCalledTimes(1);
  });

  it('(OC-3) contador_visible_cuando_comment_count_mayor_a_cero: commentCount=12 → el texto "12" es visible en el rail', async () => {
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
        onComments={NOOP}
        commentCount={12}
      />,
    );

    expect(queryByText('12')).not.toBeNull();
  });

  it('(OC-4) contador_ausente_cuando_comment_count_es_cero: commentCount=0 → el botón sigue visible pero sin texto "0" (mismo criterio que el rail del detalle)', async () => {
    const { queryByTestId, queryByText } = await render(
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
        onComments={NOOP}
        commentCount={0}
      />,
    );

    expect(queryByTestId('overlay-comments-btn')).not.toBeNull();
    expect(queryByText('0')).toBeNull();
  });
});
