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

// 213.3: `mint_videos` se deja REAL (jest.requireActual) — es la misma
// función pura que resuelve el video de una promo a partir de
// client.functions.invoke('mint-video-url', ...), y los tests de la
// partición display/promo (más abajo) necesitan ejercer esa llamada de
// verdad para poder asertar sobre ella, no un doble que la reimplemente.
jest.mock('../lib/feedProperties', () => ({
  ...jest.requireActual('../lib/feedProperties'),
  fetchFeedProperties: jest.fn(),
}));

// #196: el store de dedupe de la señal de fallo es un singleton de módulo, así
// que sin un session_id distinto por test el segundo test del archivo quedaría
// deduplicado contra el primero. Se mockea appSession en vez de exponer un
// `reset()` de solo-test en el código de producción.
let mock_session_counter = 0;
jest.mock('../lib/appSession', () => ({
  get_app_session_id: () => `test-session-${mock_session_counter}`,
}));

const mock_use_location = jest.fn().mockReturnValue({ coords: null, status: 'loading' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// mock_supabase es MUTABLE a propósito: cada test reconfigura `.rpc` (o lo
// borra por completo para reproducir el mock legado de los 14 archivos
// preexistentes). El prefijo `mock_` es lo que permite a Jest referenciarlo
// dentro del factory de jest.mock (hoisting).
const mock_supabase: { rpc?: jest.Mock; auth?: unknown; from?: jest.Mock; functions?: { invoke: jest.Mock } } = { rpc: jest.fn() };
jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase;
  },
}));

import { emitPropertyDeleted } from '@/lib/propertyEvents';

import type { FilterState } from '@/features/search/types';

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import type { FeedAd, FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

const mock_fetch_feed_properties = fetchFeedProperties as jest.MockedFunction<
  typeof fetchFeedProperties
>;

const DEFAULT_COORDS = { latitude: 20.6597, longitude: -103.3496 };

/** FilterState vacío para los tests de #195 (solo importan `area` y la identidad). */
const EMPTY_FILTERS_195 = {
  operation_types: [],
  property_types: [],
  price_min: null,
  price_max: null,
  zone: null,
  bedrooms_min: null,
  pet_friendly: false,
  allows_no_guarantor: false,
  student_friendly: false,
  radius_m: null,
  area: null,
} as FilterState;

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

function make_ad(id: string, overrides: Partial<FeedAd> = {}): FeedAd {
  return {
    id,
    creative_id: `creative-${id}`,
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

/**
 * 170.8: el anuncio que SALE del hook ya trae sus URLs firmadas (mint-ad-urls),
 * así que el esperado no es el fixture crudo. Este helper aplica el mismo
 * mapeo que el mock por defecto de mint-ad-urls del beforeEach — si un día
 * divergen, los tests de composición lo dicen de inmediato.
 */
function minted(ad: FeedAd): FeedAd {
  return {
    ...ad,
    poster_url: `https://videodelivery.net/tok-${ad.creative_id}/thumbnails/thumbnail.jpg`,
    video_url: `https://videodelivery.net/tok-${ad.creative_id}/manifest/video.m3u8`,
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

/** Inserts capturados en events_raw (la señal de #196). */
let mock_events_insert: jest.Mock;
/** Llamadas capturadas a supabase.functions.invoke (mint-ad-urls, 170.8). */
let mock_mint_invoke: jest.Mock;

function ads_failure_signals(): { stage: string }[] {
  return mock_events_insert.mock.calls.map((call) => {
    const row = call[0] as { payload?: { stage?: string } };
    return { stage: row.payload?.stage ?? '(sin stage)' };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_session_counter += 1;
  mock_use_location.mockReturnValue({ coords: DEFAULT_COORDS, status: 'granted' });
  mock_supabase.rpc = jest.fn();
  mock_events_insert = jest.fn().mockResolvedValue({ error: null });
  mock_supabase.auth = {
    getSession: jest
      .fn()
      .mockResolvedValue({ data: { session: { user: { id: 'user-196-uuid' } } }, error: null }),
  };
  mock_supabase.from = jest.fn().mockReturnValue({ insert: mock_events_insert });
  // 170.8: por defecto mint-ad-urls firma TODO lo que se le pide, para que los
  // tests preexistentes de composición no dependan del minteo.
  mock_mint_invoke = jest.fn().mockImplementation((_name: string, opts: { body: { creative_ids: string[] } }) => {
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
  mock_supabase.functions = { invoke: mock_mint_invoke };
});

/** Llamadas a mint-ad-urls. */
function mint_calls(): { body: { creative_ids: string[] } }[] {
  return mock_mint_invoke.mock.calls
    .filter((c) => c[0] === 'mint-ad-urls')
    .map((c) => c[1] as { body: { creative_ids: string[] } });
}

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
      { kind: 'ad', ad: minted(AD_A) },
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
// RED 170.8 — el anuncio necesita su URL FIRMADA o no se sirve.
//
// ads_for_zone devuelve el creative_id (migración 20260820000004) pero NO una
// URL reproducible: los creativos de Stream tienen requireSignedURLs, así que
// hace falta pasar por mint-ad-urls (169.5, ampliada en 170.8 para devolver
// también el manifest HLS además del póster).
//
// 🔴 DECISIÓN: un anuncio cuya URL no se pudo firmar NO SE SIRVE. Una
// impresión que el anunciante PAGA y que no muestra su video es peor que no
// servir el anuncio — y la impresión se registraría igual, porque el registro
// no sabe si el video pintó.
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — 170.8: firma de la URL de reproducción del anuncio', () => {
  const PROP_A = make_property('feed-prop-mint-a');
  const PROP_B = make_property('feed-prop-mint-b');

  function wire(ads: FeedAd[]) {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') {
        return Promise.resolve({
          data: [make_config({ ads_enabled: true, ad_frequency_n: 1, ad_max_per_session: 5 })],
          error: null,
        });
      }
      if (fn === 'ads_for_zone') return Promise.resolve({ data: ads, error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });
  }

  beforeEach(() => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [PROP_A, PROP_B], nextCursor: null });
  });

  it('(EC-MINT-1) se invoca mint-ad-urls con los creative_id de los anuncios servidos', async () => {
    wire([make_ad('ad-mint-1'), make_ad('ad-mint-2')]);

    await render_loaded_hook();

    const calls = mint_calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body.creative_ids.sort()).toEqual(
      ['creative-ad-mint-1', 'creative-ad-mint-2'].sort(),
    );
  });

  it('(EC-MINT-2) cada anuncio servido lleva su video_url y su poster_url firmados', async () => {
    wire([make_ad('ad-mint-1')]);

    const { result } = await render_loaded_hook();

    const ad_item = as_feed_items(result.current.data).find((i) => i.kind === 'ad');
    expect(ad_item).toBeDefined();
    const ad = (ad_item as { kind: 'ad'; ad: FeedAd }).ad;
    expect(ad.video_url).toBe('https://videodelivery.net/tok-creative-ad-mint-1/manifest/video.m3u8');
    expect(ad.poster_url).toBe('https://videodelivery.net/tok-creative-ad-mint-1/thumbnails/thumbnail.jpg');
  });

  it('(EC-MINT-3) 🔴 un anuncio SIN URL firmada no se sirve — no se factura una impresión que no muestra nada', async () => {
    // 4 propiedades con every_n=1 dejan sitio para MÁS de un anuncio: con solo
    // 2 el test pasaría por falta de huecos, no porque el sin-firma se
    // descartara. (Se verificó: con 2 propiedades pasaba contra el GREEN viejo.)
    mock_fetch_feed_properties.mockResolvedValue({
      data: [PROP_A, PROP_B, make_property('feed-prop-mint-c'), make_property('feed-prop-mint-d')],
      nextCursor: null,
    });
    wire([make_ad('ad-firmado'), make_ad('ad-sin-firma')]);
    // mint-ad-urls solo devuelve uno de los dos (el otro no está autorizado o
    // su creativo no está 'ready').
    mock_mint_invoke.mockResolvedValue({
      data: {
        urls: [
          {
            creative_id: 'creative-ad-firmado',
            posterUrl: 'https://videodelivery.net/tok-x/thumbnails/thumbnail.jpg',
            videoUrl: 'https://videodelivery.net/tok-x/manifest/video.m3u8',
          },
        ],
      },
      error: null,
    });

    const { result } = await render_loaded_hook();

    const served_ids = as_feed_items(result.current.data)
      .filter((i) => i.kind === 'ad')
      .map((i) => (i as { kind: 'ad'; ad: FeedAd }).ad.id);

    // Se asserta IDENTIDAD, no conteo: con every_n=1 interleave_ads repite el
    // único anuncio superviviente varias veces, así que un toHaveLength(1)
    // fallaría por una razón que no tiene nada que ver con la firma.
    expect(served_ids.length).toBeGreaterThan(0);
    expect(new Set(served_ids)).toEqual(new Set(['ad-firmado']));
    expect(served_ids).not.toContain('ad-sin-firma');
  });

  it('(EC-MINT-4) si mint-ad-urls falla entero, FAIL-SOFT: feed sin anuncios, sin error visible', async () => {
    wire([make_ad('ad-mint-1')]);
    mock_mint_invoke.mockRejectedValue(new Error('offline'));

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
  });

  it('(EC-MINT-5) y ese fallo deja RASTRO para el operador (#196), con su propio tramo', async () => {
    wire([make_ad('ad-mint-1')]);
    mock_mint_invoke.mockRejectedValue(new Error('offline'));

    await render_loaded_hook();

    expect(ads_failure_signals()).toEqual([{ stage: 'mint' }]);
  });

  it('(EC-MINT-6) cero anuncios elegibles → mint-ad-urls NO se invoca', async () => {
    wire([]);

    await render_loaded_hook();

    expect(mint_calls()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// RED #195 — la ZONA VISTA gana sobre el GPS, también del lado cliente.
//
// La regla principal de ads_for_zone (170.2) es que la zona que el usuario
// está VIENDO gana sobre dónde está parado: "está viendo Zapopan aunque esté
// sentado en CDMX, y el anuncio relevante es el de Zapopan". La RPC la
// implementa y la defienden 5 asserts pgTAP. Pero el feed NO PODÍA ejercerla:
// llamaba con las coordenadas del GPS y con zona null/null, siempre.
//
// Consecuencia comercial: quien compra la colonia Providencia paga por
// alcanzar a quien EXPLORA Providencia, y solo alcanzaba a quien está
// físicamente ahí. El usuario de CDMX que lleva media hora viendo
// departamentos en Guadalajara veía anuncios de CDMX, y el inventario de
// Guadalajara no se servía.
//
// `filters.area` ("buscar en esta zona", #56) es exactamente la señal que
// faltaba: su centro es el punto que el usuario está mirando en el mapa.
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — #195: los anuncios siguen la zona VISTA, no el GPS', () => {
  const PROP = make_property('feed-prop-zone-195');
  const GDL_CENTER = { lat: 20.7, lng: -103.4 };

  function mock_config_enabled() {
    return Promise.resolve({
      data: [make_config({ ads_enabled: true, ad_frequency_n: 8, ad_max_per_session: 5 })],
      error: null,
    });
  }

  function wire_rpcs() {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });
  }

  beforeEach(() => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [PROP], nextCursor: null });
    wire_rpcs();
  });

  it('(EC-ZONE-1) con `area` activa, ads_for_zone recibe el CENTRO del área, no las coords del GPS', async () => {
    const filters = {
      ...EMPTY_FILTERS_195,
      area: { center: GDL_CENTER, radius_m: 5000 },
    };

    const rendered = await renderHook(() => useFeedProperties(filters));
    await act(async () => {
      await rendered.result.current.loadInitial();
    });

    const call = ads_for_zone_calls()[0] as [string, { p_lat: number; p_lng: number }];
    expect(call[1].p_lat).toBe(GDL_CENTER.lat);
    expect(call[1].p_lng).toBe(GDL_CENTER.lng);
    // Y explícitamente NO las del GPS — sin este assert, un p_lat correcto por
    // coincidencia pasaría.
    expect(call[1].p_lat).not.toBe(DEFAULT_COORDS.latitude);
    expect(call[1].p_lng).not.toBe(DEFAULT_COORDS.longitude);
  });

  it('(EC-ZONE-2) 🔴 CASO PAREADO: sin `area`, se sigue usando el GPS', async () => {
    await render_loaded_hook();

    const call = ads_for_zone_calls()[0] as [string, { p_lat: number; p_lng: number }];
    expect(call[1].p_lat).toBe(DEFAULT_COORDS.latitude);
    expect(call[1].p_lng).toBe(DEFAULT_COORDS.longitude);
  });

  it('(EC-ZONE-3) la zona DECLARADA sigue en null — se documenta, no se finge', async () => {
    // Honestidad de alcance: la rama de precedencia por id de colonia/municipio
    // de ads_for_zone sigue SIN llamador. Propagar ese id exige tocar
    // FilterState, su persistencia y los consumidores del mapa (hoy el id vive
    // solo en el useState local de MapScreen). Este assert deja constancia de
    // que el estado es el conocido y no una regresión silenciosa.
    const filters = { ...EMPTY_FILTERS_195, area: { center: GDL_CENTER, radius_m: 5000 } };
    const rendered = await renderHook(() => useFeedProperties(filters));
    await act(async () => {
      await rendered.result.current.loadInitial();
    });

    const call = ads_for_zone_calls()[0] as [string, Record<string, unknown>];
    expect(call[1].p_neighborhood_id).toBeNull();
    expect(call[1].p_municipality_id).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// RED #196 — el fail-soft debe dejar RASTRO (sin cambiar el fail-soft)
//
// "La RPC lleva tres días fallando" se ve hoy EXACTAMENTE IGUAL que "no hay
// inventario contratado en esa zona". Estos asserts exigen la señal lateral
// SIN relajar un solo invariante de 170.4: en cada caso se sigue verificando
// que el feed degrada limpio (propiedades tal cual, error null).
//
// El caso pareado del final es obligatorio: sin él, un GREEN que emitiera la
// señal SIEMPRE pasaría todos los demás.
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — #196: el fail-soft deja rastro para el operador', () => {
  const PROP_A = make_property('feed-prop-signal-a');
  const PROP_B = make_property('feed-prop-signal-b');

  function mock_config_enabled() {
    return Promise.resolve({
      data: [make_config({ ads_enabled: true, ad_frequency_n: 8, ad_max_per_session: 5 })],
      error: null,
    });
  }

  beforeEach(() => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [PROP_A, PROP_B], nextCursor: null });
  });

  it("(EC-SIG-1) error explícito de ads_for_zone: sigue degradando limpio Y emite exactamente una señal de tramo 'zone'", async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.resolve({ data: null, error: { message: 'PGRST: función falló' } });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
    expect(ads_failure_signals()).toEqual([{ stage: 'zone' }]);
  });

  it("(EC-SIG-2) promesa rechazada de ads_for_zone: una señal de tramo 'zone'", async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.reject(new Error('upstream request timeout'));
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(ads_failure_signals()).toEqual([{ stage: 'zone' }]);
  });

  it("(EC-SIG-3) respuesta malformada de ads_for_zone: una señal de tramo 'zone'", async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.resolve({ data: { unexpected: true }, error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(ads_failure_signals()).toEqual([{ stage: 'zone' }]);
  });

  it("(EC-SIG-4) falla el propio kill-switch: una señal de tramo 'config', y ads_for_zone nunca se invoca", async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return Promise.reject(new Error('network error'));
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(ads_for_zone_calls()).toHaveLength(0);
    expect(ads_failure_signals()).toEqual([{ stage: 'config' }]);
  });

  it('(EC-SIG-5) 🔴 CASO PAREADO: el camino feliz NO emite ninguna señal', async () => {
    // ad_frequency_n=1 a propósito: con el 8 del resto del bloque y solo 2
    // propiedades ningún slot estaría "due" y el feed saldría sin anuncios —
    // el assert de "sí hubo anuncio" no probaría nada.
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') {
        return Promise.resolve({
          data: [make_config({ ads_enabled: true, ad_frequency_n: 1, ad_max_per_session: 5 })],
          error: null,
        });
      }
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [make_ad('ad-signal-happy')], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(as_feed_items(result.current.data).some((item) => item.kind === 'ad')).toBe(true);
    expect(ads_failure_signals()).toEqual([]);
  });

  it("(EC-SIG-6) 🔴 apagado deliberado NO es un fallo: ads_enabled=false no emite señal", async () => {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') {
        return Promise.resolve({ data: [make_config({ ads_enabled: false })], error: null });
      }
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(ads_failure_signals()).toEqual([]);
  });

  it('(EC-SIG-7) dedupe entre páginas: loadInitial + loadMore fallando el mismo tramo emiten UNA sola señal', async () => {
    mock_fetch_feed_properties
      .mockResolvedValueOnce({ data: [PROP_A], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ data: [PROP_B], nextCursor: null });
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.reject(new Error('sigue caída'));
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const rendered = await renderHook(() => useFeedProperties());
    await act(async () => {
      await rendered.result.current.loadInitial();
    });
    await act(async () => {
      await rendered.result.current.loadMore();
    });

    expect(ads_for_zone_calls()).toHaveLength(2);
    expect(ads_failure_signals()).toEqual([{ stage: 'zone' }]);
  });

  it('(EC-SIG-8) 🔴 si la propia señal falla, el feed NO se rompe (fire-and-forget)', async () => {
    mock_events_insert.mockRejectedValue(new Error('offline'));
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') return mock_config_enabled();
      if (fn === 'ads_for_zone') return Promise.reject(new Error('upstream timeout'));
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    expect(result.current.data).toEqual(props_only([PROP_A, PROP_B]));
    expect(result.current.error).toBeNull();
  });
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
  //   P0: since(0)>=1? NO (skip_first_position arranca since en 0) → push P0 sin ad. since=1.
  //   P1: since(1)>=1, ads_used(0)<budget(2), AD_A nunca mostrado → inserta AD ANTES de P1 → push AD,P1. since=0→1.
  //   P2: since(1)>=1, ads_used(1)<budget(2), AD_A last_pos=1, pos_actual=3, gap=3-1=2>=2 → inserta AD ANTES de P2 → push AD,P2. since=0→1.
  //   P3: since(1)>=1, ads_used(2)<budget(2)? NO (cupo agotado) → push P3 sin ad.
  //   P4: mismo — cupo agotado, solo propiedad.
  //   Resultado página 1: [P0,AD,P1,AD,P2,P3,P4] → 2 ads (exactamente max_per_session), NUNCA en posición 0 (skip_first_position=true).
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
    // 2 anuncios + 8 propiedades = 10. El literal original decía 11, en
    // contradicción aritmética con los dos asserts de arriba en este MISMO test.
    expect(result.current.data).toHaveLength(10);
  });

  // Config con cupo HOLGADO (2 de 3 gastados en la página 1, queda 1 para la
  // página 2) — a diferencia de EC-CAP-1, aquí SÍ debe aparecer un anuncio
  // nuevo en loadMore.
  //
  // #247 — CONFIG REAJUSTADA (every_n 1→2, max_per_session 3→2). La config
  // vieja (every_n=1) dejaba la página 1 "due" al terminar, así que con el
  // anuncio de cierre de #247 se llevaba los 3 lugares del cupo y la página 2
  // se quedaba sin presupuesto.
  //
  // #256 — LA COSTURA YA NO ARRANCA "due" A CIEGAS. Antes de esta subtarea,
  // `skip_first_position:false` (loadMore) siempre hacía arrancar `since` en
  // `every_n` sin importar cuántas propiedades llevaba REALMENTE la página
  // anterior desde su último anuncio — eso es exactamente el bug que #256
  // corrige (ver interleaveAds.page-seam.test.ts). Ahora el hook pasa
  // `since_last_ad` (el final que dejó la página 1) y la página 2 arranca
  // desde ahí, sin importar `skip_first_position`.
  //
  // Traza a mano de la página 1 — interleave_ads_with_state([P0,P1,P2], [AD_A],
  // {every_n:2, max_per_session:2, min_gap:4, already_shown_count:0, skip_first:true}):
  //   P0: since(0)>=2? NO → push P0 sin ad. since=1.
  //   P1: since(1)>=2? NO → push P1 sin ad. since=2.
  //   P2: since(2)>=2, ads_used(0)<budget(2), AD_A nunca mostrado → inserta AD ANTES de P2 → push AD,P2. since=0→1.
  //   Pasada de cierre (#247): since(1)>=2? NO → sin anuncio final.
  //   Resultado página 1: [P0,P1,AD,P2] → 1 ad, since_last_ad final = 1. already_shown_ref acumula a 1.
  //
  // Traza a mano de la página 2 (loadMore, skip_first_position=false pero
  // 256 lo ignora porque `since_last_ad:1` viene presente,
  // already_shown_count=1 acumulado) — interleave_ads_with_state([Q0,Q1], [AD_A],
  // {every_n:2, max_per_session:2, min_gap:4, already_shown_count:1, skip_first:false, since_last_ad:1}):
  //   budget = max_per_session(2) - already_shown_count(1) = 1.
  //   since arranca en 1 (el since_last_ad heredado de la página 1, NO en every_n=2).
  //   Q0: since(1)>=2? NO → push Q0 sin ad. since=2.
  //   Q1: since(2)>=2, ads_used(0)<budget(1), AD_A nunca mostrado EN ESTA LLAMADA
  //       (last_shown_at es local a cada llamada) → inserta AD ANTES de Q1 → push AD,Q1. since=0→1.
  //   Pasada de cierre: ads_used(1)<budget(1)? NO (cupo de la llamada agotado) → sin anuncio final.
  //   Resultado página 2: [Q0,AD,Q1] → 1 ad nuevo, en el SEGUNDO ítem de la página
  //   (antes de #256 caía en el primero — dos anuncios a solo 1 propiedad de
  //   distancia across la costura, el bug exacto que corrige esta subtarea).
  it('(EC-CAP-2) loadMore_con_cupo_holgado_compone_un_anuncio_nuevo_y_respeta_since_last_ad_heredado_de_la_pagina_1: con 1 lugar de cupo restante, la página 2 trae exactamente 1 anuncio nuevo, colocado según el since_last_ad que dejó la página 1 (256) y no según skip_first_position', async () => {
    const P0 = make_property('cap2-p0');
    const P1 = make_property('cap2-p1');
    const P2 = make_property('cap2-p2');
    const Q0 = make_property('cap2-q0');
    const Q1 = make_property('cap2-q1');
    const AD_A = make_ad('cap2-ad-a');

    mock_fetch_feed_properties
      .mockResolvedValueOnce({ data: [P0, P1, P2], nextCursor: 'cursor-cap2-page-2' })
      .mockResolvedValueOnce({ data: [Q0, Q1], nextCursor: null });

    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 2, ad_max_per_session: 2 })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [AD_A], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    // Presencia (no vacua): la página 1 ya trajo su anuncio — ancla previa
    // antes de medir el efecto de loadMore.
    expect(result.current.data).toEqual([
      { kind: 'property', property: P0 },
      { kind: 'property', property: P1 },
      { kind: 'ad', ad: minted(AD_A) },
      { kind: 'property', property: P2 },
    ]);

    await act(async () => {
      await result.current.loadMore();
    });

    // Traza exacta completa: el ad de la página 1 + 1 ad NUEVO de la página 2,
    // ubicado en el SEGUNDO ítem de la página (256: since_last_ad:1 heredado
    // de la página 1 manda sobre skip_first_position:false).
    expect(result.current.data).toEqual([
      { kind: 'property', property: P0 },
      { kind: 'property', property: P1 },
      { kind: 'ad', ad: minted(AD_A) },
      { kind: 'property', property: P2 },
      { kind: 'property', property: Q0 },
      { kind: 'ad', ad: minted(AD_A) },
      { kind: 'property', property: Q1 },
    ]);
  });

  // 256 — LA COSTURA CUANDO LA PÁGINA 1 CIERRA CON UN ANUNCIO (#247, pasada
  // de cierre). Es el caso que originó la subtarea: antes de este fix, un
  // cierre-con-anuncio dejaba `already_shown_ref` correcto pero el hook NO
  // sabía que since_last_ad ya estaba en 0 — loadMore (skip_first_position
  // false) arrancaba "due" en every_n y podía servir un SEGUNDO anuncio
  // pegado al primero, en el índice 0 de la página 2.
  //
  // Traza a mano de la página 1 — interleave_ads_with_state([P0..P7], [AD_A],
  // {every_n:8, max_per_session:5, min_gap:16, already_shown_count:0, skip_first:true}):
  //   P0..P7: since nunca llega a 8 dentro del recorrido (sube de 0 a 8 recién
  //   al terminar P7) → las 8 se emiten sin anuncio.
  //   Pasada de cierre (#247): since(8)>=8, ads_used(0)<budget(5) → inserta AD.
  //   Resultado página 1: [P0..P7,AD] → 1 ad, since_last_ad final = 0.
  //   already_shown_ref acumula a 1.
  //
  // Traza a mano de la página 2 (loadMore, 10 propiedades Q0..Q9,
  // already_shown_count=1, since_last_ad:0 heredado) — interleave_ads_with_state(
  // [Q0..Q9], [AD_A], {every_n:8, max_per_session:5, min_gap:16,
  // already_shown_count:1, skip_first:false, since_last_ad:0}):
  //   budget = 5 - 1 = 4. since arranca en 0 (el since_last_ad heredado, NO en
  //   every_n=8 que exigiría skip_first_position:false).
  //   Q0..Q7: since sube de 0 a 8 sin alcanzar el hueco dentro del recorrido.
  //   Q8 (i=8): since(8)>=8, ads_used(0)<budget(4) → inserta AD ANTES de Q8 →
  //     push AD,Q8. since=0→1.
  //   Q9: since(1)>=8? NO → push Q9 sin ad.
  //   Resultado página 2: [Q0..Q7,AD,Q8,Q9] → el anuncio cae en el índice 8,
  //   NUNCA en el índice 0 (el bug que #256 corrige).
  it('(EC-CAP-4) pagina_1_cierra_con_anuncio_y_la_pagina_2_no_repite_uno_en_el_indice_0: since_last_ad:0 heredado del cierre-con-anuncio de la página 1 hace que el primer ítem de loadMore sea propiedad, y el siguiente anuncio cae tras every_n propiedades, no en el índice 0', async () => {
    const page1 = Array.from({ length: 8 }, (_, i) => make_property(`cap4-p${i}`));
    const page2 = Array.from({ length: 10 }, (_, i) => make_property(`cap4-q${i}`));
    const AD_A = make_ad('cap4-ad-a');

    mock_fetch_feed_properties
      .mockResolvedValueOnce({ data: page1, nextCursor: 'cursor-cap4-page-2' })
      .mockResolvedValueOnce({ data: page2, nextCursor: null });

    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 8, ad_max_per_session: 5 })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [AD_A], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    // Presencia (no vacua): la página 1 SÍ cerró con un anuncio (pasada de
    // cierre de #247) — si esto fuera 0, el resto del test no probaría nada.
    expect(result.current.data).toEqual([...props_only(page1), { kind: 'ad', ad: minted(AD_A) }]);

    await act(async () => {
      await result.current.loadMore();
    });

    const page2_items = as_feed_items(result.current.data).slice(page1.length + 1);
    // El fix: el primer ítem de la página 2 es propiedad, no un segundo
    // anuncio consecutivo con el de cierre de la página 1.
    expect(page2_items[0]!.kind).toBe('property');
    expect(page2_items).toEqual([
      ...props_only(page2.slice(0, 8)),
      { kind: 'ad', ad: minted(AD_A) },
      ...props_only(page2.slice(8)),
    ]);
  });

  // El plan de 170.4 (decisión de seam 5) es explícito: `already_shown_count`
  // "nunca se resetea en refetch" — pull-to-refresh recarga la página pero el
  // cupo de anuncios sigue siendo el de la SESIÓN completa. EC-CAP-1 solo
  // recorre loadInitial → loadMore; este test cierra el hueco con refetch.
  //
  // Traza a mano de loadInitial — interleave_ads([R0,R1,R2], [AD_A],
  // {every_n:1, max_per_session:2, min_gap:2, already_shown_count:0, skip_first:true}):
  //   R0: since(0)>=1? NO → push R0 sin ad. since=1.
  //   R1: since(1)>=1, ads_used(0)<budget(2), AD_A nunca mostrado → inserta AD ANTES de R1 → push AD,R1. since=0→1.
  //   R2: since(1)>=1, ads_used(1)<budget(2), AD_A last_pos=1, pos_actual=3, gap=2>=2 → inserta AD ANTES de R2 → push AD,R2. since=0→1.
  //   Resultado: [R0,AD,R1,AD,R2] → 2 ads (= max_per_session). already_shown_ref acumula a 2.
  //
  // Traza a mano de refetch (nueva página S0..S3, already_shown_count=2
  // ACUMULADO, NO reseteado) — budget = max_per_session(2) - already_shown(2) = 0
  // → interleave_ads devuelve SOLO propiedades (guard de budget<=0), sin
  // importar que every_n=1 vuelva a estar "due" en cada una: [S0,S1,S2,S3].
  it('(EC-CAP-3) refetch_no_resetea_el_cupo_de_sesion_y_no_trae_anuncios_nuevos: tras agotar el cupo en loadInitial, refetch() reemplaza el feed por SOLO las propiedades nuevas, sin anuncios', async () => {
    const R0 = make_property('cap3-r0');
    const R1 = make_property('cap3-r1');
    const R2 = make_property('cap3-r2');
    const S0 = make_property('cap3-s0');
    const S1 = make_property('cap3-s1');
    const S2 = make_property('cap3-s2');
    const S3 = make_property('cap3-s3');
    const AD_A = make_ad('cap3-ad-a');

    mock_fetch_feed_properties
      .mockResolvedValueOnce({ data: [R0, R1, R2], nextCursor: null })
      .mockResolvedValueOnce({ data: [S0, S1, S2, S3], nextCursor: null });

    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 1, ad_max_per_session: 2 })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [AD_A], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    // Presencia (no vacua): loadInitial SÍ agotó el cupo — 2 anuncios reales.
    expect(result.current.data).toEqual([
      { kind: 'property', property: R0 },
      { kind: 'ad', ad: minted(AD_A) },
      { kind: 'property', property: R1 },
      { kind: 'ad', ad: minted(AD_A) },
      { kind: 'property', property: R2 },
    ]);

    await act(async () => {
      await result.current.refetch();
    });

    // refetch() REEMPLAZA data (no acumula, a diferencia de loadMore) por las
    // 4 propiedades nuevas SIN anuncios — si el hook reseteara el cupo, esta
    // igualdad fallaría porque volverían a aparecer anuncios intercalados.
    expect(result.current.data).toEqual(props_only([S0, S1, S2, S3]));
  });

  // 256 — MUTANTE ENCONTRADO POR GUARDIAN: `since_last_ad_ref.current =
  // undefined` en `load_initial` (useFeedProperties.ts ~L392) es la línea que
  // hace que una carga NUEVA no herede el `since_last_ad` de una página de
  // scroll anterior. Sin ese reset, un loadMore que deja el contador "due"
  // (since_last_ad final >= every_n, SIN llegar a colocar un anuncio en su
  // propia pasada de cierre) contamina el refetch/loadInitial siguiente: la
  // opción `since_last_ad` manda SIN IMPORTAR `skip_first_position` (ver
  // docblock de `InterleaveAdsOptions.since_last_ad`), así que
  // `skip_first_position:true` (el invariante "nunca posición 0" de una
  // carga inicial) queda sin efecto y el primer ítem del feed recargado
  // puede ser un anuncio.
  //
  // Para dejar el contador "due" SIN colocar un anuncio en la pasada de
  // cierre (y así distinguirlo del caso ya cubierto por EC-CAP-4, que sí
  // cierra CON anuncio) se agota el `min_gap_between_repeats` con un solo
  // anuncio en el pool — el presupuesto de sesión NO se agota (a propósito:
  // si se agotara, `interleave_ads_with_state` cae en el early-return de
  // "budget<=0" que SIEMPRE emite solo-propiedades sin mirar since_last_ad,
  // y el mutante pasaría el test igual — ver interleaveAds.ts).
  // `min_gap_between_repeats` NO es un parámetro libre: el hook lo deriva
  // como `ad_frequency_n * 2` (ver compose_feed_items) — con every_n=3,
  // min_gap=6.
  //
  // Traza a mano — página 1 (loadInitial, skip_first:true, already_shown:0,
  // budget=10, every_n=3, min_gap=6, ads=[AD_A]), properties=[P0,P1,P2]:
  //   P0: since(0)>=3? NO → push. since=1.
  //   P1: since(1)>=3? NO → push. since=2.
  //   P2: since(2)>=3? NO → push. since=3.
  //   Cierre (#247): since(3)>=3, ads_used(0)<budget(10), AD_A sin historial
  //     (mapa fresco) → coloca AD. since=0, ads_used=1.
  //   Resultado: [P0,P1,P2,AD]. since_last_ad final=0. already_shown_ref=1.
  //
  // Traza a mano — página 2 (loadMore, already_shown:1, budget=10-1=9,
  // since_last_ad:0 heredado), properties=[Q0..Q6] (7):
  //   Q0: since(0)>=3? NO → push. since=1.
  //   Q1: since(1)>=3? NO → push. since=2.
  //   Q2: since(2)>=3? NO → push. since=3.
  //   Q3 (i=3): since(3)>=3, ads_used(0)<9, AD_A sin historial (mapa fresco
  //     de ESTA llamada) → coloca AD @pos 3. since=0, ads_used=1. push Q3, since=1.
  //   Q4: since(1)>=3? NO → push. since=2.
  //   Q5: since(2)>=3? NO → push. since=3.
  //   Q6 (i=6): since(3)>=3, ads_used(1)<9, AD_A last_pos=3, pos_actual=7
  //     (Q0,Q1,Q2,AD,Q3,Q4,Q5 ya en el resultado), gap=7-3=4 < min_gap(6) →
  //     NO califica (único anuncio del pool) → sin ad. push Q6, since=4.
  //   Cierre (i=7): since(4)>=3, ads_used(1)<9, AD_A last_pos=3, pos_actual=8
  //     (+Q6), gap=8-3=5 < 6 → NO califica → sin ad de cierre.
  //   Resultado: [Q0,Q1,Q2,AD,Q3,Q4,Q5,Q6] → 1 ad nuevo. since_last_ad final=4
  //   (>= every_n=3: el contador queda "due" SIN haber colocado el anuncio de
  //   cierre — justo el estado que un reset perdido deja filtrarse).
  //   already_shown_ref = 1+1 = 2.
  //
  // Traza a mano — refetch (=load_initial, already_shown:2, budget=10-2=8,
  // skip_first_position:true SIEMPRE), properties=[R0,R1,R2]:
  //   CON el reset (fix): since_last_ad ausente en opts → arranca en 0
  //     (skip_first_position:true). R0,R1,R2 se emiten sin ad (since sube
  //     0→1→2→3); cierre: since(3)>=3 → coloca AD @pos 3.
  //     Resultado: [R0,R1,R2,AD] → ÍNDICE 0 ES PROPIEDAD.
  //   SIN el reset (mutante): since_last_ad_ref.current sigue en 4 (el
  //     leftover de la página 2) → se pasa como opts.since_last_ad:4, que
  //     MANDA sobre skip_first_position:true. since arranca en 4 (>=3) →
  //     en R0 (i=0, mapa fresco de esta llamada) el anuncio califica de
  //     inmediato @pos 0 → push AD ANTES de R0.
  //     Resultado: [AD,R0,R1,R2] → ÍNDICE 0 ES ANUNCIO (el bug).
  it('(EC-CAP-5) refetch_tras_un_loadmore_que_deja_el_contador_due_no_hereda_ese_estado_el_indice_0_sigue_siendo_propiedad: un loadMore que cierra "due" (since_last_ad>=every_n, sin colocar anuncio de cierre por min_gap) no debe contaminar el refetch siguiente — skip_first_position:true vuelve a mandar porque una carga inicial NO tiene página anterior que heredar', async () => {
    const P0 = make_property('cap5-p0');
    const P1 = make_property('cap5-p1');
    const P2 = make_property('cap5-p2');
    const Q0 = make_property('cap5-q0');
    const Q1 = make_property('cap5-q1');
    const Q2 = make_property('cap5-q2');
    const Q3 = make_property('cap5-q3');
    const Q4 = make_property('cap5-q4');
    const Q5 = make_property('cap5-q5');
    const Q6 = make_property('cap5-q6');
    const R0 = make_property('cap5-r0');
    const R1 = make_property('cap5-r1');
    const R2 = make_property('cap5-r2');
    const AD_A = make_ad('cap5-ad-a');

    mock_fetch_feed_properties
      .mockResolvedValueOnce({ data: [P0, P1, P2], nextCursor: 'cursor-cap5-page-2' })
      .mockResolvedValueOnce({ data: [Q0, Q1, Q2, Q3, Q4, Q5, Q6], nextCursor: null })
      .mockResolvedValueOnce({ data: [R0, R1, R2], nextCursor: null });

    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 3, ad_max_per_session: 10 })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [AD_A], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result } = await render_loaded_hook();

    // Presencia (no vacua): la página 1 SÍ colocó su anuncio de cierre.
    expect(result.current.data).toEqual([...props_only([P0, P1, P2]), { kind: 'ad', ad: minted(AD_A) }]);

    await act(async () => {
      await result.current.loadMore();
    });

    // Presencia (no vacua): la página 2 SÍ colocó un anuncio nuevo — deja el
    // contador "due" (since_last_ad final=4) SIN anuncio de cierre.
    expect(result.current.data).toEqual([
      ...props_only([P0, P1, P2]),
      { kind: 'ad', ad: minted(AD_A) },
      ...props_only([Q0, Q1, Q2]),
      { kind: 'ad', ad: minted(AD_A) },
      ...props_only([Q3, Q4, Q5, Q6]),
    ]);

    await act(async () => {
      await result.current.refetch();
    });

    // El fix: refetch() reinicia since_last_ad_ref antes de componer, así que
    // skip_first_position:true vuelve a mandar — el índice 0 es PROPIEDAD, no
    // el anuncio "due" heredado de la página 2. Este es el assert que MUERE
    // si se borra `since_last_ad_ref.current = undefined` en load_initial.
    expect(result.current.data).toEqual([...props_only([R0, R1, R2]), { kind: 'ad', ad: minted(AD_A) }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Remoción optimista (55.2) con lista heterogénea — onPropertyDeleted no
// debe tocar los anuncios, solo el item 'property' cuyo id matchea.
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — onPropertyDeleted preserva los anuncios del feed heterogéneo', () => {
  // Traza a mano de interleave_ads([P0,P1], [AD_A],
  // {every_n:1, max_per_session:1, min_gap:2, already_shown_count:0, skip_first:true}):
  //   P0: since(0)>=1? NO → push P0 sin ad. since=1.
  //   P1: since(1)>=1, ads_used(0)<budget(1), AD_A nunca mostrado → inserta AD ANTES de P1 → push AD,P1.
  //   Resultado: [P0,AD_A,P1] — exactamente el patrón [propiedad, anuncio, propiedad].
  it('(EC-DEL-1) borrar_una_propiedad_no_elimina_los_anuncios_del_feed_en_caliente: con data=[P0,AD,P1], emitPropertyDeleted(P0.id) deja EXACTAMENTE [AD,P1] — el anuncio sigue en su sitio y solo desaparece la propiedad borrada', async () => {
    const P0 = make_property('del-p0');
    const P1 = make_property('del-p1');
    const AD_A = make_ad('del-ad-a');
    mock_fetch_feed_properties.mockResolvedValue({ data: [P0, P1], nextCursor: null });
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config')
        return Promise.resolve({ data: [make_config({ ads_enabled: true, ad_frequency_n: 1, ad_max_per_session: 1 })], error: null });
      if (fn === 'ads_for_zone') return Promise.resolve({ data: [AD_A], error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });

    const { result, unmount } = await render_loaded_hook();

    // Presencia previa (no vacua): el feed en efecto compuso [P0,AD_A,P1]
    // antes del borrado — si esto fallara, "el ad sigue" de abajo sería vacuo.
    expect(result.current.data).toEqual([
      { kind: 'property', property: P0 },
      { kind: 'ad', ad: minted(AD_A) },
      { kind: 'property', property: P1 },
    ]);

    await act(async () => {
      emitPropertyDeleted(P0.id);
    });

    // El anuncio SIGUE presente y la propiedad borrada desaparece — un solo
    // toEqual ancla presencia (AD_A, P1) y ausencia (P0) sobre el MISMO array.
    expect(result.current.data).toEqual([
      { kind: 'ad', ad: minted(AD_A) },
      { kind: 'property', property: P1 },
    ]);

    await act(async () => {
      unmount();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// RED 213.3 — partición display/promo: ads_for_zone ahora puede devolver
// anuncios "promo" (property_id no nulo, creative_id null) además de los
// "display" de siempre (creative_id no nulo). Contrato pinneado (#213 §4):
// los display siguen resolviéndose con mint-ad-urls (creative_ids); los
// promo se resuelven con mint-video-url (property_ids) — LA MISMA EF/helper
// que feedProperties.ts usa para las propiedades del feed (mint_videos,
// exportada de ese módulo, no un fetch duplicado).
//
// Tolerancia OTA (impacto-prod, orquestador): un backend viejo (antes de la
// migración 213.3-SQL) no manda `property_id` en absoluto → `undefined` se
// trata como null (EC-PROMO-5) — el cliente de este lote puede convivir con
// un backend sin desplegar todavía.
// ─────────────────────────────────────────────────────────────────────────
describe('useFeedProperties — 213.3: partición display/promo (mint-ad-urls vs mint-video-url)', () => {
  const PROP_A = make_property('feed-prop-promo-a');
  const PROP_B = make_property('feed-prop-promo-b');

  function make_promo_ad(id: string, property_id: string, overrides: Partial<FeedAd> = {}): FeedAd {
    return {
      id,
      creative_id: null,
      title: `Depa en ${id}`,
      description: null,
      cta_type: null,
      cta_value: null,
      cloudflare_uid: null,
      agency_name: 'Constructora Ejemplo',
      agency_logo_url: null,
      property_id,
      ...overrides,
    };
  }

  function wire_config_and_ads(ads: FeedAd[]) {
    mock_supabase.rpc!.mockImplementation((fn: string) => {
      if (fn === 'ads_feed_config') {
        return Promise.resolve({
          data: [make_config({ ads_enabled: true, ad_frequency_n: 1, ad_max_per_session: 5 })],
          error: null,
        });
      }
      if (fn === 'ads_for_zone') return Promise.resolve({ data: ads, error: null });
      throw new Error(`llamada inesperada a ${fn}`);
    });
  }

  /** Mock de functions.invoke que responde AMBOS endpoints (mint-ad-urls y mint-video-url). */
  function wire_both_minters() {
    mock_mint_invoke.mockImplementation((name: string, opts: { body?: Record<string, unknown> }) => {
      if (name === 'mint-ad-urls') {
        const ids = (opts?.body?.creative_ids as string[] | undefined) ?? [];
        return Promise.resolve({
          data: { urls: ids.map((creative_id) => ({ creative_id, posterUrl: `poster-${creative_id}`, videoUrl: `video-${creative_id}` })) },
          error: null,
        });
      }
      if (name === 'mint-video-url') {
        const property_ids = (opts?.body?.property_ids as string[] | undefined) ?? [];
        return Promise.resolve({
          data: {
            videos: property_ids.map((property_id) => ({
              property_id,
              video_id: `video-of-${property_id}`,
              signed_url: `https://cdn.urbea.app/signed/${property_id}.mp4`,
              posterUrl: `https://cdn.urbea.app/poster/${property_id}.jpg`,
            })),
          },
          error: null,
        });
      }
      throw new Error(`invoke inesperado: ${name}`);
    });
  }

  beforeEach(() => {
    mock_fetch_feed_properties.mockResolvedValue({ data: [PROP_A, PROP_B], nextCursor: null });
  });

  it('(EC-PROMO-1) un ad con property_id se resuelve con mint-video-url, NUNCA con mint-ad-urls', async () => {
    const PROMO = make_promo_ad('promo-1', 'property-uuid-1');
    wire_config_and_ads([PROMO]);
    wire_both_minters();

    await render_loaded_hook();

    const video_calls = mock_mint_invoke.mock.calls.filter((c) => c[0] === 'mint-video-url');
    const ad_calls = mock_mint_invoke.mock.calls.filter((c) => c[0] === 'mint-ad-urls');
    expect(video_calls).toHaveLength(1);
    expect((video_calls[0]?.[1] as { body: { property_ids: string[] } }).body.property_ids).toEqual([
      'property-uuid-1',
    ]);
    expect(ad_calls).toHaveLength(0);
  });

  it('(EC-PROMO-2) el item de promo trae video_url/poster_url de mint-video-url y conserva title/agency del ad', async () => {
    const PROMO = make_promo_ad('promo-2', 'property-uuid-2');
    wire_config_and_ads([PROMO]);
    wire_both_minters();

    const { result } = await render_loaded_hook();

    const ad_item = as_feed_items(result.current.data).find((i) => i.kind === 'ad');
    expect(ad_item).toBeDefined();
    const ad = (ad_item as { kind: 'ad'; ad: FeedAd }).ad;
    expect(ad.video_url).toBe('https://cdn.urbea.app/signed/property-uuid-2.mp4');
    expect(ad.poster_url).toBe('https://cdn.urbea.app/poster/property-uuid-2.jpg');
    expect(ad.title).toBe('Depa en promo-2');
    expect(ad.agency_name).toBe('Constructora Ejemplo');
    expect(ad.property_id).toBe('property-uuid-2');
  });

  it('(EC-PROMO-3) 🔴 una promo sin URL autorizada (mint-video-url no la devuelve) no se sirve', async () => {
    // 4 propiedades con every_n=1 dejan hueco para más de un anuncio — mismo
    // criterio que EC-MINT-3 (2 propiedades no distinguiría "omitida" de "sin hueco").
    mock_fetch_feed_properties.mockResolvedValue({
      data: [PROP_A, PROP_B, make_property('feed-prop-promo-c'), make_property('feed-prop-promo-d')],
      nextCursor: null,
    });
    const PROMO_OK = make_promo_ad('promo-ok', 'property-uuid-ok');
    const PROMO_SIN_VIDEO = make_promo_ad('promo-sin-video', 'property-uuid-sin-video');
    wire_config_and_ads([PROMO_OK, PROMO_SIN_VIDEO]);
    // mint-video-url solo autoriza una de las dos propiedades.
    mock_mint_invoke.mockImplementation((name: string) => {
      if (name === 'mint-video-url') {
        return Promise.resolve({
          data: {
            videos: [
              {
                property_id: 'property-uuid-ok',
                video_id: 'video-ok',
                signed_url: 'https://cdn.urbea.app/signed/ok.mp4',
                posterUrl: 'https://cdn.urbea.app/poster/ok.jpg',
              },
            ],
          },
          error: null,
        });
      }
      throw new Error(`invoke inesperado: ${name}`);
    });

    const { result } = await render_loaded_hook();

    const served_ids = as_feed_items(result.current.data)
      .filter((i) => i.kind === 'ad')
      .map((i) => (i as { kind: 'ad'; ad: FeedAd }).ad.id);
    expect(served_ids.length).toBeGreaterThan(0);
    expect(new Set(served_ids)).toEqual(new Set(['promo-ok']));
    expect(served_ids).not.toContain('promo-sin-video');
  });

  it('(EC-PROMO-4) mezcla display+promo en el mismo ads_for_zone: cada uno se mintea con su EF correspondiente', async () => {
    // 4 propiedades con every_n=1: con solo 2 (el fixture por defecto del
    // describe) apenas cabe UN anuncio en el feed y el test no podría
    // distinguir "el otro se omitió" de "no había hueco" (mismo criterio que
    // EC-PROMO-3/EC-MINT-3).
    mock_fetch_feed_properties.mockResolvedValue({
      data: [PROP_A, PROP_B, make_property('feed-prop-promo-e'), make_property('feed-prop-promo-f')],
      nextCursor: null,
    });
    const DISPLAY = make_ad('ad-display-1');
    const PROMO = make_promo_ad('promo-4', 'property-uuid-4');
    wire_config_and_ads([DISPLAY, PROMO]);
    wire_both_minters();

    const { result } = await render_loaded_hook();

    const ad_calls = mock_mint_invoke.mock.calls.filter((c) => c[0] === 'mint-ad-urls');
    const video_calls = mock_mint_invoke.mock.calls.filter((c) => c[0] === 'mint-video-url');
    expect(ad_calls).toHaveLength(1);
    expect(video_calls).toHaveLength(1);
    expect((ad_calls[0]?.[1] as { body: { creative_ids: string[] } }).body.creative_ids).toEqual([
      'creative-ad-display-1',
    ]);
    expect((video_calls[0]?.[1] as { body: { property_ids: string[] } }).body.property_ids).toEqual([
      'property-uuid-4',
    ]);

    const served_ids = as_feed_items(result.current.data)
      .filter((i) => i.kind === 'ad')
      .map((i) => (i as { kind: 'ad'; ad: FeedAd }).ad.id);
    expect(new Set(served_ids)).toEqual(new Set(['ad-display-1', 'promo-4']));
  });

  it('(EC-PROMO-5) property_id undefined (backend sin desplegar la migración 213.3-SQL) se trata como null: mint-video-url NUNCA se invoca', async () => {
    // Ad "display" tal cual lo devuelve un backend viejo — ni siquiera trae
    // la clave property_id en la fila.
    const OLD_AD = make_ad('ad-old-backend');
    wire_config_and_ads([OLD_AD]);
    wire_both_minters();

    await render_loaded_hook();

    const video_calls = mock_mint_invoke.mock.calls.filter((c) => c[0] === 'mint-video-url');
    expect(video_calls).toHaveLength(0);
  });

  it('(EC-PROMO-6) fallo total de mint-video-url degrada SOLO la porción promo (fail-soft): un display en el MISMO ads_for_zone sigue sirviéndose', async () => {
    // 🔴 candado del guardian: el fixture original solo tenía PROMO, así que
    // "degrada SOLO la porción promo" era indistinguible de "degrada TODO"
    // (un catch que hiciera `return to_property_items(properties)` para el
    // lote entero pasaba igual, con la suite en verde). Un DISPLAY firmable
    // en el MISMO ads_for_zone es el que hace la diferencia observable.
    // 4 propiedades (every_n=1) dejan hueco para AMBOS anuncios — con 2 no
    // se podría distinguir "el display se sirvió" de "no había hueco".
    mock_fetch_feed_properties.mockResolvedValue({
      data: [PROP_A, PROP_B, make_property('feed-prop-promo-g'), make_property('feed-prop-promo-h')],
      nextCursor: null,
    });
    const DISPLAY = make_ad('ad-display-1');
    const PROMO = make_promo_ad('promo-6', 'property-uuid-6');
    wire_config_and_ads([DISPLAY, PROMO]);
    mock_mint_invoke.mockImplementation((name: string, opts: { body?: Record<string, unknown> }) => {
      if (name === 'mint-ad-urls') {
        const ids = (opts?.body?.creative_ids as string[] | undefined) ?? [];
        return Promise.resolve({
          data: { urls: ids.map((creative_id) => ({ creative_id, posterUrl: `poster-${creative_id}`, videoUrl: `video-${creative_id}` })) },
          error: null,
        });
      }
      if (name === 'mint-video-url') return Promise.reject(new Error('offline'));
      throw new Error(`invoke inesperado: ${name}`);
    });

    const { result } = await render_loaded_hook();

    const served_ids = as_feed_items(result.current.data)
      .filter((i) => i.kind === 'ad')
      .map((i) => (i as { kind: 'ad'; ad: FeedAd }).ad.id);
    // Presencia: el display sobrevive. Ausencia: la promo (cuyo mint falló) no.
    expect(new Set(served_ids)).toEqual(new Set(['ad-display-1']));
    expect(served_ids).not.toContain('promo-6');
    expect(result.current.error).toBeNull();
    expect(ads_failure_signals()).toEqual([{ stage: 'mint' }]);
  });
});
