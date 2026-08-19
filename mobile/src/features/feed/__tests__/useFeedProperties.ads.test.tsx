/**
 * RED — useFeedProperties: composición de anuncios + tipo heterogéneo (170.4)
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts
 *
 * NO se toca mobile/src/features/feed/__tests__/useFeedProperties.test.tsx
 * (14 archivos preexistentes de feed/__tests__ deben seguir pasando SIN
 * modificarse, gate de 170.1). Este archivo es ADITIVO.
 *
 * SEAMS bajo test:
 *  - Firma pública de useFeedProperties(filters?) → UseFeedPropertiesState.
 *    `data` CAMBIA de tipo: FeedPropertyWithUrl[] → FeedItem[] (170.3).
 *  - fetchFeedProperties (lib/feedProperties.ts) contrato INTACTO — se
 *    mockea igual que en el archivo preexistente (jest.mock del módulo).
 *  - Cableo del hook contra `supabase.rpc('ads_feed_config')` y
 *    `supabase.rpc('ads_for_zone', {...})` — argumentos EXACTOS (lección de
 *    #73: un mock que acepta cualquier forma de argumentos no prueba el
 *    cableo).
 *  - interleave_ads (170.3, YA IMPLEMENTADA — no es un stub, no se mockea:
 *    es un colaborador interno real y determinista, no una frontera del
 *    sistema) se usa como pieza de composición; los resultados esperados de
 *    los tests de intercalado están trazados A MANO (ver comentarios "traza:"
 *    en cada test), no recomputados llamando a la función dentro del test.
 *
 * DECISIONES DE SEAM fijadas por este test-author (el footprint del
 * analista no las especificaba al 100%):
 *  1. ads_feed_config()/ads_for_zone() son funciones SET-RETURNING en
 *     Postgres (`returns table(...)`) → PostgREST/supabase-js las devuelve
 *     como ARRAY de filas (`data: [...]`), igual que `properties_within_radius`
 *     ya consumida en feedProperties.ts — NUNCA `data` como objeto suelto.
 *     Confirmado leyendo las migraciones 20260817000001 y 20260818000002.
 *  2. La composición de anuncios NO tiene "zona vista" propia en 170.4 (el
 *     footprint no toca FilterState ni agrega neighborhood_id/municipality_id
 *     — eso es #157/mapa, fuera de este footprint): el hook llama
 *     ads_for_zone con `p_neighborhood_id: null, p_municipality_id: null` y
 *     deja que el propio RPC (170.2) resuelva la zona por ST_Intersects
 *     sobre `p_lat`/`p_lng`. Si una subtarea futura conecta la zona vista
 *     del mapa al feed, es trabajo NUEVO (add-task), no parte de 170.4.
 *  3. min_gap_between_repeats = 2 × ad_frequency_n (documentado en el propio
 *     header de interleaveAds.ts: "2×every_n en producción; parámetro del
 *     caller, no derivado aquí" — el caller ES useFeedProperties).
 *  4. skip_first_position: true en loadInitial/refetch (primera página
 *     real), false en loadMore (página de continuación) — mismo contrato
 *     que fijó 170.3.
 *  5. already_shown_count se ACUMULA a través de loadInitial + loadMore +
 *     refetch en la vida del hook (nunca se resetea en refetch — así lo
 *     exige el plan de 170.4: "tiene que acumularse entre loadMore y
 *     refetch, o el cap de 5 por sesión no se sostiene").
 *  6. FAIL-SOFT ABSOLUTO cubre TAMBIÉN el caso "deps.supabase no tiene
 *     método .rpc" (exactamente el mock de los 14 archivos preexistentes:
 *     `jest.mock('@/lib/supabase/client', () => ({ supabase: {} }))`) — sin
 *     esto, el gate de no-regresión de 170.1 sería imposible de sostener:
 *     esos 14 archivos tronarían con un TypeError síncrono al intentar
 *     llamar `undefined(...)`.
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
}));

const mock_use_location = jest.fn().mockReturnValue({ coords: null, status: 'loading' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// mock_supabase es MUTABLE a propósito: cada test reconfigura `.rpc` (o lo
// borra por completo para reproducir el mock legado de los 14 archivos
// preexistentes). El prefijo `mock_` es lo que permite a Jest referenciarlo
// dentro del factory de jest.mock (hoisting).
const mock_supabase: { rpc?: jest.Mock } = { rpc: jest.fn() };
jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase;
  },
}));

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import type { FeedAd, FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

const mock_fetch_feed_properties = fetchFeedProperties as jest.MockedFunction<
  typeof fetchFeedProperties
>;

const DEFAULT_COORDS = { latitude: 20.6597, longitude: -103.3496 };

function make_property(id: string, overrides: Partial<FeedPropertyWithUrl> = {}): FeedPropertyWithUrl {
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
    owner_user_id: 'owner-uuid-ads-test',
    agent_name: null,
    agent_photo_url: null,
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_phone: null,
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

function make_ad(id: string, overrides: Partial<FeedAd> = {}): FeedAd {
  return {
    id,
    title: 'Departamentos en preventa · Zapopan',
    description: 'Entrega 2027.',
    cta_type: 'external_url',
    cta_value: 'https://ejemplo.mx/preventa',
    cloudflare_uid: `cf-${id}`,
    agency_name: 'Constructora Ejemplo',
    agency_logo_url: null,
    ...overrides,
  };
}

function make_config(overrides: { ads_enabled?: boolean; ad_frequency_n?: number; ad_max_per_session?: number } = {}) {
  return {
    ads_enabled: false,
    ad_frequency_n: 8,
    ad_max_per_session: 5,
    ...overrides,
  };
}

/** Property-only items — atajo para armar el esperado del feed sin anuncios. */
function props_only(properties: FeedPropertyWithUrl[]): FeedItem[] {
  return properties.map((property) => ({ kind: 'property', property }));
}

/**
 * Cast de conveniencia SOLO para el tipo estático de este archivo de test:
 * `UseFeedPropertiesState.data` sigue tipado `FeedPropertyWithUrl[]` hasta
 * que GREEN cambie la firma pública del hook a `FeedItem[]` (parte del
 * contrato de esta subtarea, no algo que el test-author deba/pueda tocar
 * sin implementar el SUT). El valor EN RUNTIME es lo que realmente se
 * compara con `toEqual`/`toBe` en cada test — este cast no relaja ninguna
 * aserción, solo evita ruido de tsc sobre un tipo que GREEN va a corregir.
 */
function as_feed_items(data: unknown): FeedItem[] {
  return data as FeedItem[];
}

function ads_for_zone_calls(): unknown[] {
  return (mock_supabase.rpc as jest.Mock).mock.calls.filter((call) => call[0] === 'ads_for_zone');
}

function ads_feed_config_calls(): unknown[] {
  return (mock_supabase.rpc as jest.Mock).mock.calls.filter((call) => call[0] === 'ads_feed_config');
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_use_location.mockReturnValue({ coords: DEFAULT_COORDS, status: 'granted' });
  mock_supabase.rpc = jest.fn();
});

async function render_loaded_hook() {
  const rendered = await renderHook(() => useFeedProperties());
  await act(async () => {
    await rendered.result.current.loadInitial();
  });
  return rendered;
}

// ─────────────────────────────────────────────────────────────────────────
// GATE de 170.1 — ads_enabled=false: cero llamadas a ads_for_zone
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — gate de 170.1 (ads_enabled=false)', () => {
  it('(EC-GATE-1) ads_enabled_false_nunca_llama_a_ads_for_zone_y_feed_es_solo_propiedades: 3 propiedades entran, 3 property-items salen, y ads_for_zone jamás se invoca (aunque ads_feed_config sí)', async () => {
    const PROP_A = make_property('feed-prop-aaa');
    const PROP_B = make_property('feed-prop-bbb');
    const PROP_C = make_property('feed-prop-ccc');
    mock_fetch_feed_properties.mockResolvedValue({ data: [PROP_A, PROP_B, PROP_C], nextCursor: null });
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return Promise.resolve({ data: [make_config({ ads_enabled: false })], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    // Presencia: el feed cargó y trae exactamente las 3 propiedades, como items 'property'.
    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B, PROP_C]));
    // Presencia: sí se consultó el kill-switch (si esto fuera 0, la ausencia de abajo sería vacua).
    expect(ads_feed_config_calls()).toHaveLength(1);
    // Ausencia: CERO llamadas a ads_for_zone — el criterio duro del gate.
    expect(ads_for_zone_calls()).toHaveLength(0);
  });

  it('(EC-GATE-2) client_sin_metodo_rpc_no_lanza_y_compone_solo_propiedades: reproduce EXACTAMENTE el mock legado de los 14 archivos preexistentes (supabase:{}) — sin esto, el gate de no-regresión de 170.1 sería imposible de sostener', async () => {
    delete mock_supabase.rpc;
    const PROP_A = make_property('feed-prop-legacy-a');
    const PROP_B = make_property('feed-prop-legacy-b');
    mock_fetch_feed_properties.mockResolvedValue({ data: [PROP_A, PROP_B], nextCursor: null });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cableo exacto de argumentos (lección de #73)
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — cableo de argumentos hacia las RPCs de anuncios', () => {
  it('(EC-WIRE-1) ads_feed_config_se_llama_sin_argumentos: exactamente ("ads_feed_config"), ningún objeto de params', async () => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [make_property('p1')], nextCursor: null });
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return Promise.resolve({ data: [make_config({ ads_enabled: false })], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    await render_loaded_hook();

    expect(mock_supabase.rpc).toHaveBeenCalledWith('ads_feed_config');
  });

  it('(EC-WIRE-2) ads_for_zone_recibe_p_lat_p_lng_de_coords_y_zona_null_EXACTOS: nombres y valores literales, ni un parámetro de más ni de menos', async () => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [make_property('p1')], nextCursor: null });
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return Promise.resolve({ data: [make_config({ ads_enabled: true })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    await render_loaded_hook();

    expect(mock_supabase.rpc).toHaveBeenCalledWith('ads_for_zone', {
      p_lat: DEFAULT_COORDS.latitude,
      p_lng: DEFAULT_COORDS.longitude,
      p_neighborhood_id: null,
      p_municipality_id: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Composición happy-path — traza a mano contra interleave_ads (170.3)
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — composición con ads_enabled=true (happy path)', () => {
  // Traza a mano de interleave_ads([P0..P9], [AD_A], {every_n:4, max_per_session:3,
  // min_gap_between_repeats:8, already_shown_count:0, skip_first_position:true}):
  // since arranca en 0 (skip_first_position) → P0,P1,P2,P3 antes de que since>=4;
  // en P4 since=4, budget 0<3, AD_A elegible (nunca se mostró) → se inserta ANTES
  // de P4; from ahí since se resetea y no vuelve a alcanzar 4 dentro de los 6
  // items restantes (P5..P9) porque el min_gap (8) tampoco se cumple para un
  // segundo uso de AD_A. Resultado: [P0,P1,P2,P3,AD_A,P4,P5,P6,P7,P8,P9] — 1 solo ad.
  it('(EC-HAPPY-1) diez_propiedades_un_ad_produce_exactamente_la_traza_esperada_intercalada: ads_enabled=true, every_n=4, max_per_session=3 → el ad cae exactamente en la posición 4, nunca en 0, y el resto son propiedades en su orden original', async () => {
    const properties = Array.from({ length: 10 }, (_, i) => make_property(`feed-prop-${i}`));
    const AD_A = make_ad('ad-aaa');
    mock_fetch_feed_properties.mockResolvedValue({ data: properties, nextCursor: null });
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 4, ad_max_per_session: 3 })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [AD_A], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    const expected: FeedItem[] = [
      { kind: 'property', property: properties[0]! },
      { kind: 'property', property: properties[1]! },
      { kind: 'property', property: properties[2]! },
      { kind: 'property', property: properties[3]! },
      { kind: 'ad', ad: AD_A },
      { kind: 'property', property: properties[4]! },
      { kind: 'property', property: properties[5]! },
      { kind: 'property', property: properties[6]! },
      { kind: 'property', property: properties[7]! },
      { kind: 'property', property: properties[8]! },
      { kind: 'property', property: properties[9]! },
    ];

    // Presencia: el resultado tiene EXACTAMENTE 11 items (10 props + 1 ad), en ese orden.
    expect(result.current.data).toEqual(expected);
    // Ancla adicional (no vacua): hay exactamente 1 ad y nunca en la posición 0.
    // Cast: `data` del hook TODAVÍA está tipado FeedPropertyWithUrl[] hasta que
    // GREEN cambie la firma pública de UseFeedPropertiesState — ver SEAMS arriba.
    const ad_positions = as_feed_items(result.current.data)
      .map((item, index) => (item.kind === 'ad' ? index : -1))
      .filter((index) => index >= 0);
    expect(ad_positions).toEqual([4]);
  });

  it('(EC-HAPPY-2) cero_propiedades_produce_feed_vacio_incluso_con_ads_disponibles: properties=[] con ads_enabled=true y 3 ads en el pool → data=[] (nunca placeholders de anuncio sin propiedades), Y la composición SÍ se ejecutó (ads_for_zone se llamó igual) — así "data=[]" no es indistinguible de "el hook no hizo nada"', async () => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [], nextCursor: null });
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true })], error: null });
      if (fn === 'ads_for_zone')
        return Promise.resolve({ data: [make_ad('ad-1'), make_ad('ad-2'), make_ad('ad-3')], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual([]);
    // Presencia (no vacua): la composición SÍ corrió — si no fuera así, un
    // "data=[]" sería indistinguible de "el hook nunca compuso nada".
    expect(ads_feed_config_calls()).toHaveLength(1);
    expect(ads_for_zone_calls()).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// FAIL-SOFT ABSOLUTO — los 3 modos de fallo de ads_for_zone
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — fail-soft absoluto ante fallos de ads_for_zone', () => {
  const PROP_A = make_property('feed-prop-failsoft-a');
  const PROP_B = make_property('feed-prop-failsoft-b');

  function mock_config_enabled() {
    return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 8, ad_max_per_session: 5 })], error: null });
  }

  beforeEach(() => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [PROP_A, PROP_B], nextCursor: null });
  });

  it('(EC-FAIL-1) error_explicito_de_la_rpc_degrada_a_feed_normal_sin_anuncios: {data:null, error:{message}} → data son las 2 propiedades tal cual, sin lanzar y sin poblar result.error', async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.resolve({ data: null, error: { message: 'PGRST: función falló' } });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
    // Presencia: sí se intentó (para que el "sin anuncios" de arriba no sea indistinguible de "nunca se llamó").
    expect(ads_for_zone_calls()).toHaveLength(1);
  });

  it('(EC-FAIL-2) timeout_o_promesa_rechazada_degrada_a_feed_normal_sin_anuncios: client.rpc(\'ads_for_zone\') rechaza la promesa → data son las 2 propiedades, sin excepción no capturada ni result.error poblado', async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.reject(new Error('upstream request timeout'));
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
    expect(ads_for_zone_calls()).toHaveLength(1);
  });

  it('(EC-FAIL-3) respuesta_malformada_no_array_degrada_a_feed_normal_sin_anuncios: {data:{unexpected:true}, error:null} (no es un arreglo de filas) → data son las 2 propiedades, sin lanzar', async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.resolve({ data: { unexpected: true }, error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
    expect(ads_for_zone_calls()).toHaveLength(1);
  });

  it('(EC-FAIL-4) ads_feed_config_tambien_falla_blando_hacia_apagado: si el propio kill-switch falla (error de red), el default seguro es "apagado" — data son las propiedades solas y ads_for_zone NUNCA se llega a invocar', async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return Promise.reject(new Error('network error'));
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
    expect(ads_feed_config_calls()).toHaveLength(1);
    expect(ads_for_zone_calls()).toHaveLength(0);
  });

  // NOTA (decisión de seam, no vacua-por-diseño): NO se incluye aquí un caso
  // "fetchFeedProperties falla ⇒ cero llamadas a ads_feed_config/ads_for_zone".
  // Con el hook de HOY (sin ninguna composición implementada todavía), esa
  // aserción de ausencia PASARÍA sin ningún cambio de código — el hook no
  // llama a esas RPCs en NINGÚN codepath aún, éxito o error — así que no
  // sería RED, sería vacua (antipatrón "asserts vacuos" explícito en el
  // encargo). El requisito de secuencia ("solo se compone tras un fetch
  // exitoso") queda cubierto de forma NO vacua por los tests de arriba: cada
  // uno prepara `fetchFeedProperties` en éxito y verifica presencia real de
  // llamadas a ads_feed_config/ads_for_zone — si el GREEN las disparara
  // ANTES de esperar el fetch (paralelo, no secuencial), esos mismos tests
  // igual pasarían porque solo verifican que la llamada ocurrió con los
  // argumentos correctos, no el orden temporal exacto; el orden estricto
  // "solo tras éxito" es un boundary sin contraparte observable por Jest sin
  // reintroducir el mismo antipatrón (ver bitácora de la subtarea).
});

// ─────────────────────────────────────────────────────────────────────────
// Cap de sesión A TRAVÉS de páginas (invariante 6 de 170.3, ahora en el hook)
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — cap de sesión se sostiene entre loadInitial y loadMore', () => {
  // Config deliberadamente exagerada (every_n=1) para que CADA propiedad esté
  // "due" de anuncio, y así el único freno observable sea max_per_session.
  //
  // Traza a mano de la página 1 — interleave_ads([P0..P4], [AD_A],
  // {every_n:1, max_per_session:2, min_gap:2, already_shown_count:0, skip_first:true}):
  //   P0: since(0)>=1, budget 0<2, AD_A nunca mostrado → inserta AD en pos 0 → push P0.
  //   P1: since(1)>=1, budget 1<2, AD_A last_pos=0, pos_actual=2, gap=2>=2 → inserta AD en pos 2 → push P1.
  //   P2: since(1)>=1, budget 2<2? NO (cupo agotado) → push P2 sin ad.
  //   P3, P4: mismo — cupo agotado, solo propiedades.
  //   Resultado página 1: [AD,P0,AD,P1,P2,P3,P4] → 2 ads (exactamente max_per_session).
  //
  // Página 2 (loadMore, skip_first_position=false, already_shown_count=2
  // ACUMULADO de la página 1) — budget = max_per_session(2) - already_shown(2) = 0
  // → interleave_ads devuelve SOLO propiedades sin importar every_n: [P5,P6,P7].
  it('(EC-CAP-1) segunda_pagina_no_trae_anuncios_nuevos_porque_el_cupo_ya_se_agoto_en_la_primera: total de ads en `data` se queda en 2 tras loadMore, aunque every_n=1 vuelva a estar "due" en cada propiedad de la página 2', async () => {
    const page1 = Array.from({ length: 5 }, (_, i) => make_property(`cap-p${i}`));
    const page2 = Array.from({ length: 3 }, (_, i) => make_property(`cap-p2-${i}`));
    const AD_A = make_ad('cap-ad-a');

    mock_fetch_feed_properties
      .mockResolvedValueOnce({ data: page1, nextCursor: 'cursor-page-2' })
      .mockResolvedValueOnce({ data: page2, nextCursor: null });

    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 1, ad_max_per_session: 2 })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [AD_A], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    const ad_count_after_page1 = as_feed_items(result.current.data).filter((item) => item.kind === 'ad').length;
    const property_count_after_page1 = as_feed_items(result.current.data).filter((item) => item.kind === 'property').length;
    // Presencia: la página 1 SÍ trajo anuncios (si esto fuera 0, el "0 nuevos" de
    // la página 2 sería indistinguible de "los anuncios nunca funcionaron").
    expect(ad_count_after_page1).toBe(2);
    expect(property_count_after_page1).toBe(5);

    await act(async () => {
      await result.current.loadMore();
    });

    const ad_count_after_page2 = as_feed_items(result.current.data).filter((item) => item.kind === 'ad').length;
    const property_count_after_page2 = as_feed_items(result.current.data).filter((item) => item.kind === 'property').length;
    // El cupo de sesión (2) se sostiene EXACTO a través de la página 2 — cero ads nuevos.
    expect(ad_count_after_page2).toBe(2);
    // Pero las propiedades de la página 2 sí se acumulan con normalidad (5 + 3 = 8).
    expect(property_count_after_page2).toBe(8);
    expect(result.current.data).toHaveLength(11);
  });
});
