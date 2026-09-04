/**
 * AdFeedItem — subtarea 170.8 (+ #192). Test de RENDER y WIRING.
 *
 * Es el primer test de render del feed HETEROGÉNEO: hasta ahora
 * FeedScreen/AdFeedItem no tenían ninguno. No pretende ser un test de estilo
 * (RNTL no ve layout, [[rntl_no_ve_layout]]) sino de las tres cosas que sí son
 * contrato:
 *
 *  1. 🔴 El badge "Patrocinado" es una OBLIGACIÓN LEGAL: tiene que estar
 *     SIEMPRE, incluido cuando el ítem no está activo. Un badge condicionado a
 *     isActive es un badge que se puede no ver.
 *  2. El CTA abre el destino correcto por tipo, y DEGRADA con un mensaje
 *     cuando no hay app destino — nunca mudo, nunca crash.
 *  3. La medición de 170.7: la exposición se encola UNA vez, al TERMINAR, y el
 *     tap al CTA se registra ANTES de salir de la app.
 */

import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('expo-image', () => ({ Image: () => null }));
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(),
  VideoView: () => null,
}));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(() => Promise.resolve()) }));
jest.mock('phosphor-react-native', () => ({
  Megaphone: () => null,
  Phone: () => null,
  WhatsappLogo: () => null,
  ArrowSquareOut: () => null,
}));
jest.mock('@/features/location/LocationProvider', () => ({
  useLocation: () => ({ coords: { latitude: 20.6597, longitude: -103.3496 }, status: 'granted' }),
}));

// 213: la rama promo navega con router.push('/property/[id]') — se mockea
// como en el resto del repo (PropertyDetailScreen.test.tsx et al.), NUNCA se
// carga expo-router real bajo Jest.
const mock_router_push = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mock_router_push }),
}));
jest.mock('../lib/appSession', () => ({
  get_app_session_id: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
}));

const mock_enqueue = jest.fn();
const mock_report_tap = jest.fn();
jest.mock('../lib/adImpressionQueue', () => ({
  ad_impression_queue: {
    enqueue_impression: (...args: unknown[]) => mock_enqueue(...args),
    report_cta_tap: (...args: unknown[]) => mock_report_tap(...args),
    flush: () => Promise.resolve(),
  },
}));

import { Linking, StyleSheet } from 'react-native';
import { useVideoPlayer } from 'expo-video';

import { colors, fonts } from '@/theme/theme';

import { AdFeedItem } from '../components/AdFeedItem';
import type { FeedAd } from '../lib/interleaveAds';

const mock_use_video_player = useVideoPlayer as unknown as jest.Mock;

function create_fake_player() {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  const player = {
    loop: false,
    muted: false,
    bufferOptions: undefined as unknown,
    timeUpdateEventInterval: 0,
    duration: 20,
    playing: false,
    play: jest.fn(),
    pause: jest.fn(),
    replaceAsync: jest.fn(() => Promise.resolve()),
    addListener: jest.fn((event: string, cb: (p: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return { remove: () => listeners.get(event)?.delete(cb) };
    }),
    _emit: (event: string, payload: unknown) => listeners.get(event)?.forEach((cb) => cb(payload)),
  };
  return player;
}

function make_ad(overrides: Partial<FeedAd> = {}): FeedAd {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    creative_id: '22222222-2222-2222-2222-222222222222',
    title: 'Créditos hipotecarios sin aval',
    description: 'Cotiza en https://ejemplo.mx/credito hoy',
    cta_type: 'external_url',
    cta_value: 'https://ejemplo.mx/credito',
    cloudflare_uid: 'cf-uid-test',
    agency_name: 'Financiera Ejemplo',
    agency_logo_url: null,
    video_url: 'https://videodelivery.net/tok/manifest/video.m3u8',
    poster_url: 'https://videodelivery.net/tok/thumbnails/thumbnail.jpg',
    ...overrides,
  };
}

/** 213: una promo — mismo shape que devuelve ads_for_zone para property_id no nulo. */
function make_promo_ad(overrides: Partial<FeedAd> = {}): FeedAd {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    creative_id: null,
    title: 'Depa en Providencia',
    description: null,
    cta_type: null,
    cta_value: null,
    cloudflare_uid: null,
    agency_name: 'Inmobiliaria Ejemplo',
    agency_logo_url: null,
    property_id: '44444444-4444-4444-4444-444444444444',
    video_url: 'https://videodelivery.net/tok-promo/manifest/video.m3u8',
    poster_url: 'https://videodelivery.net/tok-promo/thumbnails/thumbnail.jpg',
    ...overrides,
  };
}

let fake_player: ReturnType<typeof create_fake_player>;
let can_open_spy: jest.SpyInstance;
let open_url_spy: jest.SpyInstance;
let now_spy: jest.SpyInstance;

/**
 * 🔴 Date.now DETERMINISTA. `close_exposure` no encola una exposición de 0 ms
 * —y hace bien: una exposición de duración cero no es una impresión—, pero con
 * el reloj real un test rápido mide exactamente 0 y los asserts de medición
 * fallaban de forma INTERMITENTE. Con el reloj controlado, además, se puede
 * asertar el watched_ms EXACTO en vez de un `>= 0` que no prueba nada.
 */
const T0 = 1_760_000_000_000;
let clock = T0;

beforeEach(() => {
  jest.clearAllMocks();
  fake_player = create_fake_player();
  mock_use_video_player.mockImplementation((source: unknown, setup?: (p: unknown) => void) => {
    setup?.(fake_player);
    return fake_player;
  });
  can_open_spy = jest.spyOn(Linking, 'canOpenURL').mockResolvedValue(true);
  open_url_spy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  clock = T0;
  now_spy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(() => {
  can_open_spy.mockRestore();
  open_url_spy.mockRestore();
  now_spy.mockRestore();
});

// ───────────────────────────────────────────────────────────────────────────
describe('AdFeedItem — 🔴 el badge legal', () => {
  it('(EC-1) "Patrocinado" se muestra con el ítem ACTIVO', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(r.getByText('Patrocinado')).toBeTruthy();
  });

  it('(EC-2) 🔴 y TAMBIÉN con el ítem INACTIVO — no está condicionado a isActive', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive={false} />);
    expect(r.getByText('Patrocinado')).toBeTruthy();
  });
});

describe('AdFeedItem — identidad y descripción (#192)', () => {
  it('(EC-3) muestra el nombre del anunciante', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(r.getByText('Financiera Ejemplo')).toBeTruthy();
  });

  it('(EC-4) la URL de la descripción se pinta como su propio texto — el visible ES el destino', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(r.getByText('https://ejemplo.mx/credito')).toBeTruthy();
  });

  it('(EC-5) sin descripción, el componente sigue renderizando', async () => {
    const r = await render(<AdFeedItem ad={make_ad({ description: '' })} isActive />);
    expect(r.getByText('Créditos hipotecarios sin aval')).toBeTruthy();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// #248 — legibilidad de la identidad del anunciante sobre el video.
//
// El smoke #222 (iPhone, 2026-09-03) mostró el nombre del anunciante casi
// ilegible sobre un fotograma claro y el logo ausente como un disco gris mudo.
// Ambos defectos vivían SOLO en el StyleSheet: la suite entera pasaba con
// ellos, así que estos casos asertan el estilo efectivo, no la presencia.
// ───────────────────────────────────────────────────────────────────────────
describe('AdFeedItem — #248: identidad del anunciante legible sobre el video', () => {
  it('(EC-17) 🔴 el nombre lleva sombra de texto y va en marfil — no en gris, que se perdía sobre un fotograma claro', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    const name_style = StyleSheet.flatten(r.getByText('Financiera Ejemplo').props.style) ?? {};

    expect(name_style.color).toBe(colors.paper);
    expect(name_style.color).not.toBe(colors.gray_1);
    expect(name_style.textShadowColor).toBe('rgba(23,20,15,0.55)');
    expect(name_style.textShadowRadius).toBe(3);
    expect(name_style.fontFamily).toBe(fonts.sans_bold);
  });

  it('(EC-18) 🔴 sin logo se pinta la INICIAL del anunciante — el placeholder de PropertyOverlay, no un círculo vacío', async () => {
    const r = await render(<AdFeedItem ad={make_ad({ agency_logo_url: null })} isActive />);
    const initial = r.getByTestId('ad-agency-initial');

    expect(initial.props.children).toBe('F'); // "Financiera Ejemplo"
    const avatar_style = StyleSheet.flatten(initial.parent?.props.style) ?? {};
    expect(avatar_style.borderColor).toBe(colors.primary_soft);
    expect(avatar_style.borderWidth).toBe(2);
  });

  it('(EC-19) con logo NO se pinta la inicial — el placeholder es el fallback, no un adorno permanente', async () => {
    const r = await render(
      <AdFeedItem ad={make_ad({ agency_logo_url: 'https://cdn.ejemplo.mx/logo.png' })} isActive />,
    );
    expect(r.queryByTestId('ad-agency-initial')).toBeNull();
  });

  it('(EC-20) una promo sin logo también recibe el placeholder — la identidad es la misma en ambas ramas', async () => {
    const r = await render(<AdFeedItem ad={make_promo_ad()} isActive />);
    expect(r.getByTestId('ad-agency-initial').props.children).toBe('I'); // "Inmobiliaria Ejemplo"
  });
});

describe('AdFeedItem — CTA', () => {
  it('(EC-6) external_url abre la URL', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    await act(async () => {
      fireEvent.press(r.getByTestId('ad-cta-button'));
    });
    expect(open_url_spy).toHaveBeenCalledWith('https://ejemplo.mx/credito');
  });

  it('(EC-7) whatsapp abre wa.me con solo los dígitos', async () => {
    const r = await render(
      <AdFeedItem ad={make_ad({ cta_type: 'whatsapp', cta_value: '+52 33 1234 5678' })} isActive />,
    );
    await act(async () => {
      fireEvent.press(r.getByTestId('ad-cta-button'));
    });
    expect(open_url_spy).toHaveBeenCalledWith('https://wa.me/523312345678');
  });

  it('(EC-8) phone abre tel:', async () => {
    const r = await render(<AdFeedItem ad={make_ad({ cta_type: 'phone', cta_value: '3312345678' })} isActive />);
    await act(async () => {
      fireEvent.press(r.getByTestId('ad-cta-button'));
    });
    expect(open_url_spy).toHaveBeenCalledWith('tel:3312345678');
  });

  it('(EC-9) 🔴 sin app destino DEGRADA con un mensaje — nunca mudo ni crash', async () => {
    can_open_spy.mockResolvedValue(false);
    const r = await render(<AdFeedItem ad={make_ad({ cta_type: 'whatsapp', cta_value: '3312345678' })} isActive />);

    await act(async () => {
      fireEvent.press(r.getByTestId('ad-cta-button'));
    });

    expect(r.getByTestId('ad-cta-fallback')).toBeTruthy();
    expect(open_url_spy).not.toHaveBeenCalled();
  });

  it('(EC-10) con cta_value inválido NO se pinta el botón — mejor sin CTA que con uno muerto', async () => {
    const r = await render(<AdFeedItem ad={make_ad({ cta_value: 'javascript:alert(1)' })} isActive />);
    expect(r.queryByTestId('ad-cta-button')).toBeNull();
  });
});

describe('AdFeedItem — medición (170.7)', () => {
  it('(EC-11) 🔴 NO se encola mientras la exposición sigue viva', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(mock_enqueue).not.toHaveBeenCalled();
  });

  it('(EC-12) se encola UNA vez al dejar de estar activo, con el watched_ms EXACTO', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    clock = T0 + 7_500; // 7.5 s de exposición
    await act(async () => {
      await r.rerender(<AdFeedItem ad={make_ad()} isActive={false} />);
    });

    expect(mock_enqueue).toHaveBeenCalledTimes(1);
    const payload = mock_enqueue.mock.calls[0][0] as { watched_ms: number; ad_id: string };
    expect(payload.ad_id).toBe('11111111-1111-1111-1111-111111111111');
    expect(payload.watched_ms).toBe(7_500);
  });

  it('(EC-12b) una exposición de 0 ms NO se encola — no es una impresión', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    // El reloj no avanza: el anuncio pasó de largo sin llegar a verse.
    await act(async () => {
      await r.rerender(<AdFeedItem ad={make_ad()} isActive={false} />);
    });

    expect(mock_enqueue).not.toHaveBeenCalled();
  });

  it('(EC-13) 🔒 la fila NO declara zona ni id ni user_id — el servidor los deriva (#193)', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    clock = T0 + 4_000;
    await act(async () => {
      await r.rerender(<AdFeedItem ad={make_ad()} isActive={false} />);
    });

    const payload = mock_enqueue.mock.calls[0][0] as Record<string, unknown>;
    for (const forbidden of ['id', 'user_id', 'viewed', 'municipality_id', 'neighborhood_id']) {
      expect(payload).not.toHaveProperty(forbidden);
    }
    expect(payload).toHaveProperty('lat');
    expect(payload).toHaveProperty('lng');
  });

  it('(EC-14) el tap al CTA se registra ANTES de salir de la app', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    await act(async () => {
      fireEvent.press(r.getByTestId('ad-cta-button'));
    });

    expect(mock_report_tap).toHaveBeenCalledTimes(1);
    expect(mock_report_tap.mock.calls[0][0]).toMatchObject({
      ad_id: '11111111-1111-1111-1111-111111111111',
      session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
  });
});

describe('AdFeedItem — reproducción', () => {
  it('(EC-15) 🔴 timeUpdateEventInterval > 0 — con el default (0) expo-video no emite y la compleción queda muerta', async () => {
    await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(mock_use_video_player).toHaveBeenCalled();
    expect(fake_player.timeUpdateEventInterval).toBeGreaterThan(0);
  });

  it('(EC-16) reproduce cuando está activo y pausa cuando no', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(fake_player.play).toHaveBeenCalled();

    await act(async () => {
      await r.rerender(<AdFeedItem ad={make_ad()} isActive={false} />);
    });
    expect(fake_player.pause).toHaveBeenCalled();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 213 — rama PROMO: badge "Anuncio", SIN bloque de CTA, tap → detalle de la
// propiedad + registra cta_tap (contrato #213 §4).
// ───────────────────────────────────────────────────────────────────────────
describe('AdFeedItem — 213: rama promo', () => {
  it('(EC-PROMO-1) el badge dice "Anuncio", NO "Patrocinado"', async () => {
    const r = await render(<AdFeedItem ad={make_promo_ad()} isActive />);
    expect(r.getByText('Anuncio')).toBeTruthy();
    expect(r.queryByText('Patrocinado')).toBeNull();
  });

  it('(EC-PROMO-2) un display normal sigue diciendo "Patrocinado" (no se rompió el caso existente)', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(r.getByText('Patrocinado')).toBeTruthy();
    expect(r.queryByText('Anuncio')).toBeNull();
  });

  it('(EC-PROMO-3) SIN bloque de CTA — ni botón ni fallback', async () => {
    const r = await render(<AdFeedItem ad={make_promo_ad()} isActive />);
    expect(r.queryByTestId('ad-cta-button')).toBeNull();
    expect(r.queryByTestId('ad-cta-fallback')).toBeNull();
  });

  it('(EC-PROMO-4) tocar la tarjeta navega al detalle de la propiedad', async () => {
    const r = await render(<AdFeedItem ad={make_promo_ad()} isActive />);
    await act(async () => {
      fireEvent.press(r.getByTestId('ad-promo-press'));
    });
    expect(mock_router_push).toHaveBeenCalledWith(
      '/property/44444444-4444-4444-4444-444444444444',
    );
  });

  it('(EC-PROMO-5) ese mismo tap registra cta_tap en la cola de impresiones', async () => {
    const r = await render(<AdFeedItem ad={make_promo_ad()} isActive />);
    await act(async () => {
      fireEvent.press(r.getByTestId('ad-promo-press'));
    });
    expect(mock_report_tap).toHaveBeenCalledTimes(1);
    expect(mock_report_tap.mock.calls[0][0]).toMatchObject({
      ad_id: '33333333-3333-3333-3333-333333333333',
      session_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    });
  });

  it('(EC-PROMO-6) un display NO tiene el Pressable de navegación de promo', async () => {
    const r = await render(<AdFeedItem ad={make_ad()} isActive />);
    expect(r.queryByTestId('ad-promo-press')).toBeNull();
  });
});
