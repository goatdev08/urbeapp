/**
 * Smoke — AdminAdsQueueScreen (mobile/app/admin/ads/index.tsx), 213.4
 *
 * Pantalla NO crítica (verificación ligera, CLAUDE.md §5: screens/**). Solo
 * verifica el cambio de esta subtarea: una promo (property_id no nulo) se
 * distingue de un display con el prefijo "Promoción · <título>" en AMBOS
 * segmentos ("Revisión" y "Activos") — el resto de la pantalla (aprobar,
 * rechazar, pausar, bajar) ya está cubierto por las suites de
 * usePendingAds/useActiveAds/useModerateAd.
 */
import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';

import { usePendingAds, type PendingAd } from '@/features/ads/hooks/usePendingAds';
import { useActiveAds, type ActiveAd } from '@/features/ads/hooks/useActiveAds';
import { useModerateAd } from '@/features/ads/hooks/useModerateAd';
import { supabase } from '@/lib/supabase/client';
import { mint_videos } from '@/features/feed/lib/feedProperties';
import AdminAdsQueueScreen from '../index';

jest.mock('@/features/ads/hooks/usePendingAds', () => ({ usePendingAds: jest.fn() }));
jest.mock('@/features/ads/hooks/useActiveAds', () => ({ useActiveAds: jest.fn() }));
jest.mock('@/features/ads/hooks/useModerateAd', () => ({ useModerateAd: jest.fn() }));
jest.mock('@/lib/supabase/client', () => ({ supabase: { functions: { invoke: jest.fn() } } }));
jest.mock('@/features/feed/lib/feedProperties', () => ({ mint_videos: jest.fn() }));
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: () => null }));

const mock_use_pending_ads = usePendingAds as jest.MockedFunction<typeof usePendingAds>;
const mock_use_active_ads = useActiveAds as jest.MockedFunction<typeof useActiveAds>;
const mock_use_moderate_ad = useModerateAd as jest.MockedFunction<typeof useModerateAd>;
const mock_mint_videos = mint_videos as jest.MockedFunction<typeof mint_videos>;
const mock_invoke = supabase.functions.invoke as jest.Mock;

const DISPLAY_PENDING: PendingAd = {
  id: 'ad-display-pending',
  title: 'Créditos hipotecarios sin aval',
  description: 'Cotiza hoy',
  agency_id: 'agency-1',
  creative_id: 'creative-1',
  cta_type: 'whatsapp',
  cta_value: '+523310000000',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-09-01T00:00:00Z',
  created_at: '2026-08-01T00:00:00Z',
  agencies: { name: 'Financiera Ejemplo' },
  property_id: null,
};

const PROMO_PENDING: PendingAd = {
  ...DISPLAY_PENDING,
  id: 'ad-promo-pending',
  title: 'Av. Chapultepec 100, Col. Juárez',
  creative_id: null,
  cta_type: null,
  cta_value: null,
  property_id: 'property-uuid-1',
};

const DISPLAY_ACTIVE: ActiveAd = {
  id: 'ad-display-active',
  title: 'Seguro de arrendamiento Zapopan',
  description: 'Protege tu renta',
  agency_id: 'agency-1',
  starts_at: '2026-08-01T00:00:00Z',
  ends_at: '2026-09-15T00:00:00Z',
  paused_at: null,
  paused_by_suspension: false,
  agencies: { name: 'Seguros del Valle' },
  property_id: null,
};

const PROMO_ACTIVE: ActiveAd = {
  ...DISPLAY_ACTIVE,
  id: 'ad-promo-active',
  title: 'Av. Vallarta 2000, Col. Americana',
  property_id: 'property-uuid-2',
};

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_pending_ads.mockReturnValue({
    ads: [DISPLAY_PENDING, PROMO_PENDING],
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
  mock_use_active_ads.mockReturnValue({
    ads: [DISPLAY_ACTIVE, PROMO_ACTIVE],
    loading: false,
    error: null,
    refetch: jest.fn(),
  });
  mock_use_moderate_ad.mockReturnValue({
    approve: jest.fn(),
    reject: jest.fn(),
    pause: jest.fn(),
    resume: jest.fn(),
    is_moderating: false,
    error: null,
  } as unknown as ReturnType<typeof useModerateAd>);
  mock_mint_videos.mockResolvedValue([]);
});

describe('AdminAdsQueueScreen — 213: distingue promo de display', () => {
  it('(EC-1) segmento "Revisión": la promo muestra "Promoción · <título>", el display muestra el título tal cual', async () => {
    await render(<AdminAdsQueueScreen />);
    expect(screen.getByText('Créditos hipotecarios sin aval')).toBeTruthy();
    expect(screen.getByText('Promoción · Av. Chapultepec 100, Col. Juárez')).toBeTruthy();
  });

  it('(EC-2) segmento "Activos": la promo muestra "Promoción · <título>", el display muestra el título tal cual', async () => {
    const { getByTestId } = await render(<AdminAdsQueueScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('segment-active'));
    });
    expect(screen.getByText('Seguro de arrendamiento Zapopan')).toBeTruthy();
    expect(screen.getByText('Promoción · Av. Vallarta 2000, Col. Americana')).toBeTruthy();
  });

  it('(EC-3) revisar una promo carga su video con mint_videos(property_id), NUNCA con mint-ad-urls', async () => {
    const { getByTestId } = await render(<AdminAdsQueueScreen />);
    await act(async () => {
      fireEvent.press(getByTestId('pending-ad-ad-promo-pending'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('load-video'));
    });

    expect(mock_mint_videos).toHaveBeenCalledWith(supabase, ['property-uuid-1']);
    // Ausencia: una promo no tiene creative_id — mint-ad-urls jamás debe
    // recibir esta llamada (mutante: `mint_one(ad.creative_id)` sin guard).
    expect(mock_invoke).not.toHaveBeenCalledWith(
      'mint-ad-urls',
      expect.anything(),
    );
  });
});
