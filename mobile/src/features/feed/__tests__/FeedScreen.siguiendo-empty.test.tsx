/**
 * GREEN — #296.4 (parte D, discreción del implementador): empty state del
 * tab "Siguiendo" en FeedScreen.
 *
 * SUT: mobile/src/features/feed/FeedScreen.tsx
 *
 * useAuth() se mockea con user=null: «Siguiendo» sin sesión resuelve vacío
 * vía fetch_feed_page (feedSources.ts real, sin mock: user_id null → early
 * return sin tocar `properties`). Este test verifica SOLO la UI: el CTA
 * aparece y regresa el tab a "para_ti".
 *
 * Mismo patrón de mocks que FeedScreen.filters.test.tsx (harness compartido).
 */

import React, { useEffect } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
  mint_videos: jest.fn().mockResolvedValue([]),
}));

jest.mock('@/features/location/LocationProvider', () => {
  const location = { coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' };
  return { useLocation: () => location };
});

jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));
// 296.4: FeedScreen lee useAuth() para el user_id de «Siguiendo»; sin AuthProvider el hook lanza.
jest.mock('@/features/auth/context', () => ({ useAuth: () => ({ user: null }) }));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useEffect } = require('react');
    useEffect(callback, [callback]);
  },
}));

jest.mock('@/lib/splash-gate', () => ({ release_splash: jest.fn() }));
// Evita el lazy-require real de @react-native-async-storage/async-storage
// (su mock de jest.setup.js no expone `.default`, ver feedTabStorage.ts) —
// mismo mock que filterStore.test.tsx (296.3) para ejercer set_feed_tab.
jest.mock('@/features/search/lib/feedTabStorage', () => ({
  load_feed_tab: jest.fn().mockResolvedValue('para_ti'),
  save_feed_tab: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../components/VideoFeedItem', () => ({ VideoFeedItem: () => null }));
jest.mock('../components/AdFeedItem', () => ({ AdFeedItem: () => null }));
jest.mock('../../search/components/ZoneAutocomplete', () => ({ ZoneAutocomplete: () => null }));

import { FeedScreen } from '../FeedScreen';
import { FilterProvider, useFilters, type FilterContextValue } from '@/features/search/filterStore';
import { fetchFeedProperties } from '../lib/feedProperties';

const mock_fetch = fetchFeedProperties as jest.MockedFunction<typeof fetchFeedProperties>;

const filter_probe: { value: FilterContextValue | null } = { value: null };
function FilterProbe(): null {
  const context = useFilters();
  useEffect(() => {
    filter_probe.value = context;
  }, [context]);
  return null;
}

async function render_feed_screen() {
  return render(
    <FilterProvider>
      <FilterProbe />
      <FeedScreen />
    </FilterProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  filter_probe.value = null;
  mock_fetch.mockResolvedValue({ data: [], nextCursor: null });
});

describe('FeedScreen — empty state del tab "Siguiendo" (#296.4)', () => {
  it('siguiendo_vacio_muestra_cta_y_regresa_a_para_ti: tab "siguiendo" sin follows muestra el CTA "Explorar el feed"; al presionarlo, feed_tab vuelve a "para_ti"', async () => {
    const screen = await render_feed_screen();
    await act(async () => {});

    await act(async () => {
      filter_probe.value!.set_feed_tab('siguiendo');
    });
    await act(async () => {});

    expect(screen.getByText('Aún no sigues a nadie con propiedades')).toBeTruthy();
    const cta = screen.getByLabelText('Explorar el feed');

    await act(async () => {
      fireEvent.press(cta);
    });

    expect(filter_probe.value!.feed_tab).toBe('para_ti');
  });
});
