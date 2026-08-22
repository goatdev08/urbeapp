/**
 * RED — useFeedProperties: los métodos de supabase-js NO se pueden desprender
 * del cliente (tarea #205, origen 170.4).
 * SUT: mobile/src/features/feed/hooks/useFeedProperties.ts
 *
 * POR QUÉ EXISTE ESTE ARCHIVO Y NO UN TEST MÁS EN useFeedProperties.ads.test.tsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Aquel archivo tiene 36 tests verdes sobre una feature que en producción NUNCA
 * funcionó. La razón no es una aserción débil ni un caso sin cubrir: es que su
 * doble del cliente es un OBJETO PLANO (`{ rpc: jest.fn() }`, línea 80). Un
 * `jest.fn()` no lee `this`, así que llamarlo desprendido —
 * `const rpc = client.rpc; rpc(...)` — es inofensivo en el test.
 *
 * El SupabaseClient real NO es así: `rpc()` hace `return this.rest.rpc(...)`.
 * Desprenderlo pierde `this` y rompe. Verificado contra el proyecto real
 * (2026-08-22, rama preview-ads):
 *
 *   client.rpc('ads_feed_config')       → [{ ads_enabled: true, ... }]
 *   const rpc = client.rpc; rpc(...)    → TypeError: Cannot read properties
 *                                          of undefined (reading 'rest')
 *
 * Y los dos seams fallan DISTINTO, detalle que importa para el diagnóstico:
 *   · `rpc` LANZA.
 *   · `functions.invoke` NO lanza: devuelve `{ data: null, error: {} }`.
 * Un catch que trate ambos igual borra la pista — por eso el doble de aquí
 * reproduce cada uno con su modo de fallo real.
 *
 * 🔴 LA REGLA QUE ESTE ARCHIVO FIJA: el doble del cliente de supabase debe ser
 * SENSIBLE AL BINDING. Si un día alguien vuelve a escribir
 * `const rpc = client.rpc`, estos tests fallan; con un objeto plano no lo
 * harían, y volveríamos a mergear una feature muerta con la suite en verde.
 *
 * Fail-soft NO se relaja: la guarda `typeof ... !== 'function'` de 170.4
 * decisión 6 (los 14 archivos preexistentes mockean `supabase: {}`) sigue
 * siendo obligatoria. Comprobar el tipo y llamar ligado son compatibles:
 * `typeof client.rpc === 'function'` y luego `client.rpc(...)`.
 */

import { renderHook, act } from '@testing-library/react-native';

jest.mock('../lib/feedProperties', () => ({
  fetchFeedProperties: jest.fn(),
}));

let mock_session_counter = 0;
jest.mock('../lib/appSession', () => ({
  get_app_session_id: () => `binding-session-${mock_session_counter}`,
}));

const mock_use_location = jest.fn().mockReturnValue({ coords: null, status: 'loading' });
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => mock_use_location(),
}));

// eslint-disable-next-line prefer-const -- reasignado en beforeEach; el factory de jest.mock lo lee por referencia (hoisting).
let mock_supabase: unknown = {};
jest.mock('@/lib/supabase/client', () => ({
  get supabase() {
    return mock_supabase;
  },
}));

import type { FilterState } from '@/features/search/types';

import { useFeedProperties } from '../hooks/useFeedProperties';
import { fetchFeedProperties } from '../lib/feedProperties';
import type { FeedAd, FeedItem } from '../lib/interleaveAds';
import type { FeedPropertyWithUrl } from '../types';

const mock_fetch_feed_properties = fetchFeedProperties as jest.MockedFunction<
  typeof fetchFeedProperties
>;

const COORDS = { latitude: 20.6597, longitude: -103.3496 };

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
    owner_user_id: 'owner-uuid-205',
    agent_name: null,
    agent_photo_url: null,
    agency_id: null,
  } as FeedPropertyWithUrl;
}

function make_ad(id: string): FeedAd {
  return {
    id,
    creative_id: `creative-${id}`,
    title: 'Crédito hipotecario desde 8.9%',
    description: 'Cobertura total.',
    cta_type: 'external_url',
    cta_value: 'https://ejemplo.mx/credito',
    cloudflare_uid: `cf-${id}`,
    agency_name: 'Hipotecaria Demo',
    agency_logo_url: null,
  } as FeedAd;
}

/**
 * Doble del cliente que reproduce el contrato de `this` del SupabaseClient real.
 *
 * `rpc` y `functions.invoke` son MÉTODOS (no propiedades con arrow function):
 * leen `this` y fallan igual que la librería real si se les llama sueltos.
 * `rpc` lanza TypeError; `functions.invoke` devuelve un error mudo.
 */
function make_binding_sensitive_client(ads: FeedAd[]) {
  const rpc_calls: unknown[][] = [];
  const invoke_calls: unknown[][] = [];

  const functions = {
    __bound_marker: 'functions' as const,
    invoke(this: { __bound_marker?: string } | undefined, name: string, opts: { body: { creative_ids: string[] } }) {
      // Real: SupabaseClient.functions.invoke usa this.url/this.headers.
      if (this?.__bound_marker !== 'functions') {
        return Promise.resolve({ data: null, error: {} });
      }
      invoke_calls.push([name, opts]);
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
    },
  };

  const client = {
    __bound_marker: 'client' as const,
    rpc(this: { __bound_marker?: string } | undefined, fn: string, params?: unknown) {
      // Real: `return this.rest.rpc(...)` → sin `this`, TypeError.
      if (this?.__bound_marker !== 'client') {
        throw new TypeError("Cannot read properties of undefined (reading 'rest')");
      }
      rpc_calls.push([fn, params]);
      if (fn === 'ads_feed_config') {
        return Promise.resolve({
          data: [{ ads_enabled: true, ad_frequency_n: 3, ad_max_per_session: 5 }],
          error: null,
        });
      }
      if (fn === 'ads_for_zone') return Promise.resolve({ data: ads, error: null });
      return Promise.resolve({ data: [], error: null });
    },
    functions,
    auth: {
      getSession: jest
        .fn()
        .mockResolvedValue({ data: { session: { user: { id: 'user-205' } } }, error: null }),
    },
    from: jest.fn().mockReturnValue({ insert: jest.fn().mockResolvedValue({ error: null }) }),
  };

  return { client, rpc_calls, invoke_calls };
}

beforeEach(() => {
  jest.clearAllMocks();
  mock_session_counter += 1;
  mock_use_location.mockReturnValue({ coords: COORDS, status: 'granted' });
});

async function load(): Promise<FeedItem[]> {
  const rendered = await renderHook(() => useFeedProperties(undefined as unknown as FilterState));
  await act(async () => {
    await rendered.result.current.loadInitial();
  });
  return rendered.result.current.data as FeedItem[];
}

describe('#205 — el hook debe llamar a supabase LIGADO al cliente', () => {
  it('(EC-BIND-1) con un cliente sensible al binding, el feed SÍ intercala anuncios: 4 propiedades + ad_frequency_n=3 ⇒ el ítem en la posición 3 es kind="ad"', async () => {
    const { client } = make_binding_sensitive_client([make_ad('ad-1')]);
    mock_supabase = client;
    mock_fetch_feed_properties.mockResolvedValue({
      data: ['p1', 'p2', 'p3', 'p4'].map(make_property),
      nextCursor: null,
    } as never);

    const items = await load();

    // traza a mano: skip_first_position=true, every_n=3 →
    // P,P,P,AD,P  (el anuncio entra ANTES de la 4ª propiedad).
    expect(items.map((i) => i.kind)).toEqual(['property', 'property', 'property', 'ad', 'property']);
  });

  it('(EC-BIND-2) `rpc` desprendido lanza — el hook no debe depender de que alguien lo ligue por fuera', async () => {
    const { client } = make_binding_sensitive_client([make_ad('ad-1')]);
    // Se tipa como función suelta a propósito: desprender es EXACTAMENTE lo
    // que se está probando, y TS objeta el `this: void` si se deja el tipo
    // del método. El cast documenta la intención, no la esconde.
    const detached = client.rpc as unknown as (fn: string) => Promise<unknown>;
    expect(() => detached('ads_feed_config')).toThrow(TypeError);
    // ligado: no lanza
    expect(() => client.rpc('ads_feed_config')).not.toThrow();
  });

  it('(EC-BIND-3) `functions.invoke` desprendido NO lanza: devuelve error mudo — por eso el bug sobrevive a un try/catch', async () => {
    const { client } = make_binding_sensitive_client([make_ad('ad-1')]);
    const detached = client.functions.invoke as unknown as (
      n: string,
      o: { body: { creative_ids: string[] } },
    ) => Promise<unknown>;
    await expect(detached('mint-ad-urls', { body: { creative_ids: ['c1'] } })).resolves.toEqual({
      data: null,
      error: {},
    });
  });

  it('(EC-BIND-4) fail-soft intacto: un cliente sin `.rpc` (el mock legado `{}`) sigue devolviendo el feed solo con propiedades, sin lanzar', async () => {
    mock_supabase = {};
    mock_fetch_feed_properties.mockResolvedValue({
      data: ['p1', 'p2', 'p3', 'p4'].map(make_property),
      nextCursor: null,
    } as never);

    const items = await load();

    expect(items).toHaveLength(4);
    expect(items.every((i) => i.kind === 'property')).toBe(true);
  });
});
