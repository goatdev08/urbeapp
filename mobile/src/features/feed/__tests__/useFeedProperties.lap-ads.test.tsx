/**
 * RED — #285.4: anuncios cruzando la costura de VUELTA en useFeedProperties.
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts (GREEN de #285.3,
 * commits c78a3e9 + 4a6e842 — wrap de vuelta ya implementado, sin anuncios
 * como foco propio: la composición de anuncios de la vuelta la cablea
 * `compose_feed_items` reusando `already_shown_ref`/`since_last_ad_ref`, que
 * YA se arrastran entre loadInitial/loadMore/vueltas).
 * Doc: .taskmaster/docs/exploraciones/047-feed-infinito-reinicio.md §10
 * (checklist "Anuncios") y §20 Q7 ("recomponer con interleave_ads_with_state,
 * arrastrando already_shown_ref y since_last_ad_ref, respetando
 * ad_max_per_session").
 *
 * SEAM bajo test: la firma pública de `useFeedProperties` — `data`,
 * `lapCount`, `loadInitial`, `loadMore` — encadenando 1 loadInitial + 3
 * loadMore consecutivos (3 vueltas, mismo patrón que
 * useFeedProperties.lap-wrap.test.tsx). `fetchFeedProperties` (frontera,
 * mockeada por módulo), `supabase.rpc`/`supabase.functions.invoke` (frontera,
 * mock mutable como en useFeedProperties.ads.test.tsx) y `get_app_session_id`
 * (frontera, fija para no depender de expo-crypto). `interleave_ads_with_state`
 * (lib/interleaveAds.ts) y `compose_feed_items` (interno del hook) NO se
 * mockean: son colaboradores puros/reales, igual que en los archivos
 * hermanos 170.4/256.
 *
 * DECISIÓN DE SEAM (footprint subespecificado, fijada por este test-author):
 * el catálogo de anuncios de estos escenarios usa UN SOLO anuncio activo
 * (`ads_for_zone` siempre devuelve `[AD_UNICO]`) con `ad_frequency_n=8` sobre
 * páginas de 8 propiedades — los valores REALES de producción
 * (`wiki/log.md:127`: `ad_frequency_n=8`, `ad_max_per_session=5`). Con esa
 * combinación, cada llamada de composición (loadInitial y cada vuelta) coloca
 * EXACTAMENTE 1 anuncio, en la "pasada de cierre" de #247 (posición 8 relativa
 * a esa llamada) — el caso más simple donde el ÚNICO anuncio elegible se
 * repite entre llamadas consecutivas, y por tanto el más nítido para probar
 * si el hueco (`min_gap_between_repeats`) sobrevive A TRAVÉS de la costura de
 * vuelta.
 *
 * HALLAZGO DE ESTE test-author (no es un bug de #285.3, es una laguna de
 * `interleave_ads_with_state`, lib/interleaveAds.ts:180/183 — `last_shown_at`
 * y `pool_cursor` son variables LOCALES a cada llamada, se reinician en cada
 * composición): el caso (2) de la tarea ("ningún anuncio se repite con menos
 * de min_gap_between_repeats ítems entre medias A TRAVÉS DE LAS COSTURAS") NO
 * se sostiene hoy más allá de lo que ya cubre `since_last_ad_ref` (que evita
 * un anuncio EN LA PRIMERA posición de la vuelta, invariante 1 — "nunca dos
 * anuncios seguidos" — pero no evita que el MISMO anuncio reaparezca antes de
 * `min_gap_between_repeats` si cae en cualquier posición posterior de la
 * llamada siguiente). El (EC-LAP-ADS-2) de abajo es RED por esta razón: no se
 * arregla tocando el hook (`already_shown_ref`/`since_last_ad_ref` YA se
 * arrastran correctamente, ver EC-LAP-ADS-3), sino extendiendo
 * `interleave_ads_with_state` con una forma de recordar la ÚLTIMA posición
 * ABSOLUTA de cada anuncio entre llamadas (fuera del footprint que este
 * test-author puede tocar — `interleaveAds.ts` es explícitamente intocable
 * aquí). Se deja como hallazgo explícito para el guardian/mobile de 285.4:
 * quien cierre el GREEN decide si extiende `InterleaveAdsOptions` (p. ej. un
 * `last_ad_positions?: Record<string, number>` análogo a `since_last_ad`) o
 * si el alcance de 285.4 se ajusta.
 *
 * NO APLICA (caso 5 del pedido — "un anuncio ya mostrado en la vuelta 1 NO
 * vuelve a insertar fila en la cola de impresiones"): `adImpressionQueue.ts`
 * (`enqueue_impression`) NO participa de `useFeedProperties.ts` ni de
 * `compose_feed_items`/`interleave_ads_with_state` — se llama únicamente
 * desde `components/AdFeedItem.tsx` / `hooks/useFeedActiveIndex.ts`, cuando
 * el anuncio TERMINA de verse en pantalla (dedupe por sesión+ad_id, ver el
 * docblock de adImpressionQueue.ts). Ese seam es ajeno a este hook: forzar un
 * test aquí compararía contra un colaborador que useFeedProperties ni
 * siquiera importa. No se escribe.
 *
 * EDGE CASES (RED):
 * (1) tres_vueltas_seguidas_nunca_dos_anuncios_consecutivos_ni_en_las_costuras:
 *     con 1 loadInitial + 3 loadMore (vueltas), en la secuencia COMPLETA de
 *     `data` ningún ítem `kind:'ad'` es seguido inmediatamente por otro
 *     `kind:'ad'` — ni siquiera en las costuras (último ítem de la vuelta k /
 *     primero de la vuelta k+1). already_shown_ref/since_last_ad_ref YA
 *     resuelven esto (se arrastran, GREEN de #285.3).
 * (2) [RED — hallazgo] ningun_anuncio_se_repite_antes_del_min_gap_a_traves_de_las_costuras:
 *     con un único anuncio activo, sus 4 apariciones (loadInitial + 3
 *     vueltas) deberían distar >= min_gap_between_repeats (16) posiciones
 *     entre sí; hoy distan 9 en cada costura porque `interleave_ads_with_state`
 *     no recuerda la posición ABSOLUTA de una aparición previa entre llamadas.
 * (3) el_cap_de_sesion_es_de_sesion_no_por_vuelta: con `ad_max_per_session=3`
 *     (bajo a propósito), tras 1 loadInitial + 3 loadMore el total de
 *     anuncios en `data` es EXACTAMENTE 3 (no 4), y la 3ª vuelta en concreto
 *     no trae ningún ítem `kind:'ad'` nuevo — el presupuesto se agotó ANTES,
 *     acumulado entre llamadas, no reiniciado por vuelta.
 * (4) items_ad_de_una_vuelta_llevan_lap_y_feed_key_extractor_da_keys_unicas:
 *     el mismo `ad.id` reaparece en loadInitial (lap undefined) y en las 3
 *     vueltas (lap 1, 2, 3) — cada ocurrencia lleva el `lap` correspondiente y
 *     `feed_key_extractor` produce las 4 keys únicas
 *     (`ad:<id>`, `ad:<id>#1`, `ad:<id>#2`, `ad:<id>#3`).
 *
 * RNTL 14 async (`await renderHook`/`await act`), `jest.resetAllMocks` en vez
 * de `clearAllMocks` (285.3: la cola de `mockResolvedValueOnce` no se vacía
 * con clearAllMocks y contamina el test siguiente). Sin reloj fijo: ni el
 * hook ni `interleaveAds.ts`/`feedShuffle.ts` leen Date.now()/Math.random()
 * (confirmado por grep).
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
}));

// Semilla fija: el orden de barajado de la vuelta no importa para estos
// tests (nunca se afirma sobre el ORDEN de las propiedades, solo sobre
// posiciones/cantidades de los ítems 'ad'), pero fijarla evita depender de
// expo-crypto real dentro de Jest — mismo patrón que
// useFeedProperties.lap-wrap.test.tsx.
jest.mock('../lib/appSession', () => ({
  get_app_session_id: () => 'sesion-lap-ads-fija',
}));

const mock_use_location = jest
  .fn()
  .mockReturnValue({ coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// mock_supabase MUTABLE: cada test reconfigura `.rpc`/`.functions.invoke`,
// mismo patrón que useFeedProperties.ads.test.tsx.
const mock_supabase: { rpc?: jest.Mock; functions?: { invoke: jest.Mock } } = {};
jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase;
  },
}));

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import { feed_key_extractor, type LappedFeedItem } from '../lib/feedKeyExtractor';
import type { FeedAd, FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

const mock_fetch_feed_properties = fetchFeedProperties as jest.MockedFunction<
  typeof fetchFeedProperties
>;

function make_property(id: string): FeedPropertyWithUrl {
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
    owner_user_id: 'owner-uuid-lap-ads-test',
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
  };
}

function make_properties(n: number, prefix: string): FeedPropertyWithUrl[] {
  return Array.from({ length: n }, (_, i) => make_property(`${prefix}-${i + 1}`));
}

const AD_UNICO_ID = 'ad-unico-catalogo';

function make_ad_unico(): FeedAd {
  return {
    id: AD_UNICO_ID,
    creative_id: 'creative-ad-unico',
    title: 'Departamentos en preventa · Zapopan',
    description: 'Entrega 2027.',
    cta_type: 'external_url',
    cta_value: 'https://ejemplo.mx/preventa',
    cloudflare_uid: 'cf-ad-unico',
    agency_name: 'Constructora Ejemplo',
    agency_logo_url: null,
  };
}

function make_config(ad_max_per_session: number) {
  return { ads_enabled: true, ad_frequency_n: 8, ad_max_per_session };
}

/** mint-ad-urls firma TODO lo que se le pide (mismo patrón que ads.test.tsx). */
function make_mint_invoke() {
  return jest.fn().mockImplementation((_name: string, opts: { body: { creative_ids: string[] } }) => {
    const ids = opts?.body?.creative_ids ?? [];
    return Promise.resolve({
      data: {
        urls: ids.map((creative_id) => ({
          creative_id,
          posterUrl: `https://videodelivery.net/tok-${creative_id}/thumbnails/thumbnail.jpg`,
          videoUrl: `https://videodelivery.net/tok-${creative_id}/manifest/video.m3u8`,
        })),
      },
      error: null,
    });
  });
}

/** Configura supabase.rpc con el config de anuncios fijo y ads_for_zone → [AD_UNICO]. */
function configure_ads_rpc(ad_max_per_session: number) {
  mock_supabase.rpc = jest.fn().mockImplementation((fn: string) => {
    if (fn === 'ads_feed_config') return Promise.resolve({ data: [make_config(ad_max_per_session)], error: null });
    if (fn === 'ads_for_zone') return Promise.resolve({ data: [make_ad_unico()], error: null });
    throw new Error(`llamada inesperada a ${fn}`);
  });
  mock_supabase.functions = { invoke: make_mint_invoke() };
}

type FeedAdItem = Extract<FeedItem, { kind: 'ad' }>;
const is_ad = (item: FeedItem): item is FeedAdItem => item.kind === 'ad';
const ad_items = (items: FeedItem[]): FeedAdItem[] => items.filter(is_ad);

/** Corre 1 loadInitial (8 propiedades) + N loadMore consecutivos (vueltas, mismas 8 propiedades reshuffled). */
async function run_initial_plus_laps(vueltas: number) {
  mock_fetch_feed_properties.mockResolvedValueOnce({
    data: make_properties(8, 'inicial'),
    nextCursor: null,
  });
  const { result } = await renderHook(() => useFeedProperties());
  await act(async () => {
    await result.current.loadInitial();
  });

  for (let v = 1; v <= vueltas; v++) {
    mock_fetch_feed_properties.mockResolvedValueOnce({
      data: make_properties(8, `vuelta-${v}`),
      nextCursor: null,
    });
    await act(async () => {
      await result.current.loadMore();
    });
  }

  return result;
}

beforeEach(() => {
  // resetAllMocks (no clearAllMocks): vacía también la cola de
  // mockResolvedValueOnce entre tests (285.3, useFeedProperties.lap-wrap.test.tsx).
  jest.resetAllMocks();
  mock_use_location.mockReturnValue({ coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' });
});

describe('useFeedProperties — anuncios cruzando la costura de vuelta (#285.4)', () => {
  it('(EC-LAP-ADS-1) tres_vueltas_seguidas_nunca_dos_anuncios_consecutivos_ni_en_las_costuras: en la secuencia completa de data (loadInitial + 3 vueltas), ningún ad es seguido inmediatamente por otro ad', async () => {
    configure_ads_rpc(5); // ad_max_per_session real de producción, no interfiere (4 ads posibles < 5)
    const result = await run_initial_plus_laps(3);

    const data = result.current.data as LappedFeedItem[];
    // Presencia: sí hubo anuncios que probar (si esto fuera 0, la ausencia de
    // abajo sería vacua).
    expect(ad_items(data).length).toBeGreaterThan(0);

    for (let i = 0; i < data.length - 1; i++) {
      if (data[i]!.kind === 'ad') {
        expect(data[i + 1]!.kind).not.toBe('ad');
      }
    }
  });

  it('(EC-LAP-ADS-2) ningun_anuncio_se_repite_antes_del_min_gap_a_traves_de_las_costuras: las apariciones del ÚNICO anuncio activo distan >= min_gap_between_repeats (16 = 2×ad_frequency_n) posiciones entre sí, incluso cruzando la costura de vuelta', async () => {
    configure_ads_rpc(5);
    const result = await run_initial_plus_laps(3);

    const data = result.current.data as LappedFeedItem[];
    const positions = data.flatMap((item, index) => (item.kind === 'ad' ? [index] : []));

    // Presencia (no vacua): el único anuncio se sirvió más de una vez —
    // condición necesaria para que el hueco entre apariciones sea evaluable.
    expect(positions.length).toBeGreaterThanOrEqual(2);

    const MIN_GAP = 16; // ad_frequency_n(8) * 2, fórmula de useFeedProperties.ts
    for (let i = 1; i < positions.length; i++) {
      const gap = positions[i]! - positions[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(MIN_GAP);
    }
  });

  it('(EC-LAP-ADS-3) el_cap_de_sesion_es_de_sesion_no_por_vuelta: con ad_max_per_session=3, tras 1 loadInitial + 3 vueltas hay EXACTAMENTE 3 ads en total y la 3ª vuelta no trae ningún ad nuevo', async () => {
    configure_ads_rpc(3);
    const result = await run_initial_plus_laps(2); // loadInitial + vuelta 1 + vuelta 2 → agota el cupo (1+1+1=3)

    const data_tras_2_vueltas = result.current.data as LappedFeedItem[];
    expect(ad_items(data_tras_2_vueltas)).toHaveLength(3);

    const longitud_antes_de_la_3a_vuelta = data_tras_2_vueltas.length;
    mock_fetch_feed_properties.mockResolvedValueOnce({ data: make_properties(8, 'vuelta-3'), nextCursor: null });
    await act(async () => {
      await result.current.loadMore();
    });

    const data_final = result.current.data as LappedFeedItem[];
    // Sí avanzó la vuelta (lapCount llega a 3) y sí se apendearon las 8
    // propiedades nuevas — la ausencia de ads nuevos no es "no hizo nada".
    expect(result.current.lapCount).toBe(3);
    expect(data_final.length).toBe(longitud_antes_de_la_3a_vuelta + 8);
    // El total de ads en TODA la sesión sigue en 3 (el cupo, no 4): la 3ª
    // vuelta no aportó ningún ad nuevo porque el presupuesto ya se agotó.
    expect(ad_items(data_final)).toHaveLength(3);
    const ads_en_la_3a_vuelta = ad_items(data_final).filter((item) => (item as LappedFeedItem).lap === 3);
    expect(ads_en_la_3a_vuelta).toHaveLength(0);
  });

  it('(EC-LAP-ADS-4) items_ad_de_una_vuelta_llevan_lap_y_feed_key_extractor_da_keys_unicas: el mismo ad.id reaparece en loadInitial (lap undefined) y en las 3 vueltas (lap 1,2,3); cada ocurrencia lleva su lap y las 4 keys son únicas', async () => {
    configure_ads_rpc(5);
    const result = await run_initial_plus_laps(3);

    const data = result.current.data as LappedFeedItem[];
    const ads = ad_items(data) as (FeedAdItem & { lap?: number })[];

    expect(ads).toHaveLength(4);
    expect(ads.every((ad) => ad.ad.id === AD_UNICO_ID)).toBe(true);
    expect(ads.map((ad) => ad.lap)).toEqual([undefined, 1, 2, 3]);

    const keys = ads.map((ad) => feed_key_extractor(ad));
    expect(keys).toEqual([
      `ad:${AD_UNICO_ID}`,
      `ad:${AD_UNICO_ID}#1`,
      `ad:${AD_UNICO_ID}#2`,
      `ad:${AD_UNICO_ID}#3`,
    ]);
    expect(new Set(keys).size).toBe(4);
  });
});
