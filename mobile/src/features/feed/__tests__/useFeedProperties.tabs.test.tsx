/**
 * RED — #296.4: useFeedProperties despacha por feed_tab vía fetch_feed_page
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts
 *
 * Firma NUEVA (296.4-C):
 *   useFeedProperties(filters?: FilterState, feed_tab: FeedTab = 'para_ti', user_id: string | null = null)
 * El hook NO llama a useAuth — FeedScreen es quien resuelve y pasa `user_id`.
 * load_initial/load_more llaman `fetch_feed_page(cursor, deps, filters, { tab: feed_tab, user_id })`
 * en vez de `fetchFeedProperties` directo (mock de frontera: ../lib/feedSources).
 * `feed_tab` y `user_id` entran a las deps de useCallback de load_initial/load_more.
 *
 * Vuelta (lap) de "Nuevos": se re-sirve la página 1 SIN barajar (shuffle_with_seed
 * NUNCA se llama y el orden apendeado es idéntico al que devolvió fetch_feed_page).
 * "Para ti" (y el resto de tabs) sigue barajando la vuelta (shuffle_with_seed SÍ
 * se llama) — mecánica #285.3/#288.2 intacta.
 *
 * SEAMS bajo test: la firma pública de useFeedProperties (data/isLoading/
 * nextCursor/loadInitial/loadMore) y el cableo hacia fetch_feed_page (mock de
 * frontera) y shuffle_with_seed (mock de frontera, spy sobre la implementación
 * real vía requireActual — conserva hash_seed/avoid_adjacent_repeat reales).
 *
 * PATRÓN DE MOCK: mismo patrón que useFeedProperties.lap-wrap.test.tsx —
 * @/lib/supabase/client como `{}` (compose_feed_items cae en fail-soft
 * absoluto, sin .rpc; todos los items son kind:'property'), useLocation
 * mockeado con coords fijas, appSession con session_id fijo.
 *
 * EDGE CASES (RED):
 * (EC-TAB-1) sin argumentos → feed_tab default 'para_ti', user_id default null:
 *            loadInitial llama fetch_feed_page(undefined, deps, filters, {tab:'para_ti', user_id:null}).
 * (EC-TAB-2) feed_tab='nuevos' + user_id='user-abc' explícitos → loadInitial
 *            llama fetch_feed_page con ese ctx exacto.
 * (EC-TAB-3) loadMore (página, con cursor) reenvía el MISMO ctx {tab,user_id}
 *            además del cursor recibido de la página anterior.
 * (EC-TAB-4) vuelta con feed_tab='nuevos': nextCursor null + data no vacío →
 *            loadMore hace la vuelta SIN shuffle_with_seed (0 llamadas) y el
 *            orden apendeado es EXACTAMENTE el que devolvió fetch_feed_page.
 * (EC-TAB-5) vuelta con feed_tab='para_ti': la MISMA situación SÍ invoca
 *            shuffle_with_seed (mecánica #285.3 intacta para el resto de tabs).
 * (EC-TAB-6) rerender cambiando SOLO feed_tab (mismos filters/user_id) →
 *            loadInitial cambia de identidad (useCallback se recrea).
 * (EC-TAB-7) rerender con el MISMO feed_tab (misma referencia de filters,
 *            mismo user_id) → loadInitial CONSERVA su identidad.
 * (EC-TAB-8) rerender cambiando SOLO user_id (mismo feed_tab/filters) →
 *            loadInitial cambia de identidad.
 * (EC-TAB-9) user_id omitido en la llamada → el ctx que recibe fetch_feed_page
 *            trae user_id:null explícito (no se infiere de ningún lado).
 * (EC-TAB-10) feed_tab omitido en la llamada → el ctx trae tab:'para_ti'.
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
}));

jest.mock('../lib/feedSources', () => ({
  fetch_feed_page: jest.fn(),
}));

jest.mock('../lib/feedShuffle', () => {
  const actual = jest.requireActual('../lib/feedShuffle');
  return {
    ...actual,
    shuffle_with_seed: jest.fn(actual.shuffle_with_seed),
  };
});

const FIXED_SESSION_ID = 'sesion-tabs-fija';
jest.mock('../lib/appSession', () => ({
  get_app_session_id: () => FIXED_SESSION_ID,
}));

const mock_use_location = jest
  .fn()
  .mockReturnValue({ coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// Sin `.rpc`: compose_feed_items degrada a fail-soft absoluto (170.4) — todos
// los ítems de este archivo son kind:'property'.
jest.mock('@/lib/supabase/client', () => ({ supabase: {} }));

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetch_feed_page } from '../lib/feedSources';
import { shuffle_with_seed } from '../lib/feedShuffle';
import type { FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';
import { EMPTY_FILTERS } from '@/features/search/lib/filterQuery';
import type { FilterState } from '@/features/search/types';

const mock_fetch_feed_page = fetch_feed_page as jest.MockedFunction<typeof fetch_feed_page>;
const mock_shuffle_with_seed = shuffle_with_seed as jest.MockedFunction<typeof shuffle_with_seed>;

type FeedPropertyItem = Extract<FeedItem, { kind: 'property' }>;
const is_property = (it: FeedItem): it is FeedPropertyItem => it.kind === 'property';
const property_ids = (items: FeedItem[]): string[] =>
  items.filter(is_property).map((it) => it.property.id);

function make_feed_property(
  id: string,
  overrides: Partial<FeedPropertyWithUrl> = {},
): FeedPropertyWithUrl {
  return {
    id,
    price: 15000,
    operation_type: 'rent',
    property_type: 'departamento',
    currency: 'MXN',
    price_visible: true,
    address: 'Av. Chapultepec 100, Col. Juárez, CDMX',
    bedrooms: 2,
    bathrooms: 1,
    owner_user_id: 'owner-uuid-tabs-test',
    agent_name: null,
    agent_photo_url: null,
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_has_phone: false,
    video: {
      id: `video-${id}`,
      storage_path: `properties/${id}/video.mp4`,
      position: 0,
      thumbnail_url: null,
    },
    signed_url: `https://cdn.urbea.app/signed/${id}.mp4`,
    video_id: `video-${id}`,
    posterUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_location.mockReturnValue({
    coords: { latitude: 20.6597, longitude: -103.3496 },
    status: 'granted',
  });
});

describe('useFeedProperties — despacho por feed_tab (#296.4)', () => {
  it('(EC-TAB-1) sin_argumentos_usa_para_ti_y_user_id_null_por_default: loadInitial llama fetch_feed_page(undefined, deps, filters, {tab:"para_ti", user_id:null})', async () => {
    mock_fetch_feed_page.mockResolvedValueOnce({ data: [], nextCursor: null });

    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(1);
    const call = mock_fetch_feed_page.mock.calls[0]!;
    expect(call[0]).toBeUndefined();
    expect(call[3]).toEqual({ tab: 'para_ti', user_id: null });
  });

  it('(EC-TAB-2) feed_tab_y_user_id_explicitos_viajan_tal_cual: useFeedProperties(filters,"nuevos","user-abc") → ctx exacto {tab:"nuevos", user_id:"user-abc"}', async () => {
    mock_fetch_feed_page.mockResolvedValueOnce({ data: [], nextCursor: null });
    const filters: FilterState = { ...EMPTY_FILTERS, price_min: 5000 };

    const { result } = await renderHook(() => useFeedProperties(filters, 'nuevos', 'user-abc'));
    await act(async () => {
      await result.current.loadInitial();
    });

    const call = mock_fetch_feed_page.mock.calls[0]!;
    expect(call[2]).toBe(filters);
    expect(call[3]).toEqual({ tab: 'nuevos', user_id: 'user-abc' });
  });

  it('(EC-TAB-3) load_more_de_pagina_reenvia_el_mismo_ctx_junto_con_el_cursor: loadInitial con nextCursor="10" → loadMore llama fetch_feed_page("10", deps, filters, {tab,user_id}) — mismo ctx que la carga inicial', async () => {
    const A = make_feed_property('pag-a');
    const B = make_feed_property('pag-b');
    mock_fetch_feed_page.mockResolvedValueOnce({ data: [A], nextCursor: '10' });

    const { result } = await renderHook(() => useFeedProperties(undefined, 'venta', 'user-xyz'));
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.nextCursor).toBe('10');

    mock_fetch_feed_page.mockResolvedValueOnce({ data: [B], nextCursor: null });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mock_fetch_feed_page).toHaveBeenCalledTimes(2);
    const second_call = mock_fetch_feed_page.mock.calls[1]!;
    expect(second_call[0]).toBe('10');
    expect(second_call[3]).toEqual({ tab: 'venta', user_id: 'user-xyz' });
  });

  it('(EC-TAB-4) vuelta_en_nuevos_no_baraja_y_conserva_el_orden_exacto: feed_tab="nuevos", nextCursor null + data no vacío → loadMore hace la vuelta SIN llamar shuffle_with_seed y el orden apendeado es idéntico al que devolvió fetch_feed_page', async () => {
    const A = make_feed_property('new-a');
    const B = make_feed_property('new-b');
    const C = make_feed_property('new-c');
    const D = make_feed_property('new-d');

    mock_fetch_feed_page.mockResolvedValueOnce({ data: [A, B], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties(undefined, 'nuevos', null));
    await act(async () => {
      await result.current.loadInitial();
    });
    expect(result.current.data).toHaveLength(2);

    mock_fetch_feed_page.mockResolvedValueOnce({ data: [C, D], nextCursor: null });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mock_shuffle_with_seed).not.toHaveBeenCalled();
    expect(result.current.data).toHaveLength(4);
    expect(property_ids(result.current.data)).toEqual([A.id, B.id, C.id, D.id]);
    expect(result.current.lapCount).toBe(1);
  });

  it('(EC-TAB-5) vuelta_en_para_ti_si_baraja: la MISMA situación con feed_tab="para_ti" (default) SÍ invoca shuffle_with_seed — mecánica #285.3 intacta', async () => {
    const A = make_feed_property('shuf-a');
    const B = make_feed_property('shuf-b');
    const C = make_feed_property('shuf-c');

    mock_fetch_feed_page.mockResolvedValueOnce({ data: [A, B], nextCursor: null });
    const { result } = await renderHook(() => useFeedProperties());
    await act(async () => {
      await result.current.loadInitial();
    });

    mock_fetch_feed_page.mockResolvedValueOnce({ data: [C], nextCursor: null });
    await act(async () => {
      await result.current.loadMore();
    });

    expect(mock_shuffle_with_seed).toHaveBeenCalledTimes(1);
    expect(mock_shuffle_with_seed).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: C.id })]),
      expect.any(Number),
    );
  });

  it('(EC-TAB-6) rerender_cambiando_solo_feed_tab_cambia_la_identidad_de_loadinitial: mismos filters/user_id, feed_tab "para_ti"→"nuevos" → loadInitial es una función DISTINTA', async () => {
    mock_fetch_feed_page.mockResolvedValue({ data: [], nextCursor: null });
    const filters: FilterState = { ...EMPTY_FILTERS };

    const { result, rerender } = await renderHook(
      ({ tab }: { tab: 'para_ti' | 'nuevos' }) => useFeedProperties(filters, tab, 'u1'),
      { initialProps: { tab: 'para_ti' as const } },
    );
    const initial_load_initial = result.current.loadInitial;

    await act(async () => {
      rerender({ tab: 'nuevos' });
    });

    expect(result.current.loadInitial).not.toBe(initial_load_initial);
  });

  it('(EC-TAB-7) rerender_con_el_mismo_feed_tab_conserva_la_identidad_de_loadinitial: misma referencia de filters, mismo tab, mismo user_id → loadInitial NO cambia', async () => {
    mock_fetch_feed_page.mockResolvedValue({ data: [], nextCursor: null });
    const filters: FilterState = { ...EMPTY_FILTERS };

    const { result, rerender } = await renderHook(() => useFeedProperties(filters, 'renta', 'u1'));
    const initial_load_initial = result.current.loadInitial;

    await act(async () => {
      rerender(undefined);
    });

    expect(result.current.loadInitial).toBe(initial_load_initial);
  });

  it('(EC-TAB-8) rerender_cambiando_solo_user_id_cambia_la_identidad_de_loadinitial: mismo feed_tab/filters, user_id null→"u2" → loadInitial es una función DISTINTA', async () => {
    mock_fetch_feed_page.mockResolvedValue({ data: [], nextCursor: null });
    const filters: FilterState = { ...EMPTY_FILTERS };

    const { result, rerender } = await renderHook(
      ({ user_id }: { user_id: string | null }) => useFeedProperties(filters, 'siguiendo', user_id),
      { initialProps: { user_id: null as string | null } },
    );
    const initial_load_initial = result.current.loadInitial;

    await act(async () => {
      rerender({ user_id: 'u2' });
    });

    expect(result.current.loadInitial).not.toBe(initial_load_initial);
  });

  it('(EC-TAB-9) user_id_omitido_el_ctx_trae_null_explicito: useFeedProperties(filters,"siguiendo") sin 3er argumento → ctx.user_id === null (nunca se infiere)', async () => {
    mock_fetch_feed_page.mockResolvedValueOnce({ data: [], nextCursor: null });
    const filters: FilterState = { ...EMPTY_FILTERS };

    const { result } = await renderHook(() => useFeedProperties(filters, 'siguiendo'));
    await act(async () => {
      await result.current.loadInitial();
    });

    const call = mock_fetch_feed_page.mock.calls[0]!;
    expect(call[3]).toEqual({ tab: 'siguiendo', user_id: null });
  });

  it('(EC-TAB-10) feed_tab_omitido_el_ctx_trae_para_ti: useFeedProperties(filters) sin 2do/3er argumento → ctx.tab === "para_ti"', async () => {
    mock_fetch_feed_page.mockResolvedValueOnce({ data: [], nextCursor: null });
    const filters: FilterState = { ...EMPTY_FILTERS };

    const { result } = await renderHook(() => useFeedProperties(filters));
    await act(async () => {
      await result.current.loadInitial();
    });

    const call = mock_fetch_feed_page.mock.calls[0]!;
    expect(call[3]).toEqual({ tab: 'para_ti', user_id: null });
  });
});
