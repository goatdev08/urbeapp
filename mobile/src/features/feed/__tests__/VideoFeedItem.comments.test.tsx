/**
 * VideoFeedItem.comments.test.tsx — RED de la subtarea 289.10 (tarea #289).
 * Archivo SUT: mobile/src/features/feed/components/VideoFeedItem.tsx
 *
 * Decisión de Abraham (2026-09-11, tras el smoke): el botón de comentarios
 * vive SOLO en el rail del feed. Al pulsarlo, VideoFeedItem monta
 * CommentsSheet (reuso íntegro, SIN modificar el componente) sobre el ítem,
 * pasando property_id/comment_count/can_hide; el video se PAUSA mientras la
 * hoja está abierta y reanuda SOLO si el ítem sigue activo al cerrarla. El
 * contador del rail sube +1 tras publicar, sin refetch.
 *
 * Mismo patrón de mock que VideoFeedItem.test.tsx (fake player controlable,
 * PropertyOverlay/HeartAnimation → marcador) + mock de CommentsSheet (como en
 * ActionButtons.test.tsx) + mock de useAuth (@/features/auth/context, como en
 * CommentsSheet.test.tsx) para computar can_hide.
 *
 * NOTA RNTL v14: render()/rerender() envueltos en act(async () => {...}).
 *
 * SUPUESTOS DE CONTRATO que GREEN debe respetar (sin ellos estos tests no
 * pueden aserir nada — repórtense si GREEN elige otros nombres):
 *   - PropertyOverlay recibe `onComments: () => void` y `commentCount: number`.
 *   - CommentsSheet se monta condicionalmente (mismo patrón que
 *     ActionButtons/CommentsAction) con testID observable indirectamente por
 *     presencia/ausencia en el árbol — el mock de este archivo renderiza un
 *     <View testID="mock-comments-sheet"> cuando VideoFeedItem lo monta.
 *   - CommentsSheet recibe un callback NUEVO `on_comment_posted: () => void`
 *     (adición aditiva y opcional al componente real — no se ejecuta en este
 *     archivo, que mockea CommentsSheet por completo) que VideoFeedItem usa
 *     para subir `comment_count` local +1 sin refetch.
 *
 * EDGE CASES:
 *
 * ### Happy path — abrir/cerrar la hoja
 * - (VC-1) rail_recibe_on_comments_como_funcion
 * - (VC-2) tap_comentarios_monta_commentssheet_con_property_id_correcto
 * - (VC-3) cerrar_hoja_desmonta_commentssheet
 *
 * ### Pausa/reanuda el video (video_playback_burns_quota)
 * - (VC-4) abrir_hoja_pausa_el_video_activo
 * - (VC-5) cerrar_hoja_reanuda_si_el_item_sigue_activo
 * - (VC-6) cerrar_hoja_no_reanuda_si_el_item_ya_no_esta_activo
 *
 * ### can_hide = owner_user_id === user.id
 * - (VC-7) can_hide_true_cuando_la_sesion_es_el_propietario
 * - (VC-8) can_hide_false_cuando_la_sesion_no_es_el_propietario
 * - (VC-9) can_hide_false_sin_sesion
 *
 * ### comment_count inicial + contador vivo
 * - (VC-10) comment_count_inicial_viene_de_la_propiedad
 * - (VC-11) comment_count_ausente_en_la_propiedad_cae_a_cero
 * - (VC-12) contador_sube_uno_tras_publicar_sin_refetch
 */

import React from 'react';
import { render, act, type RenderResult } from '@testing-library/react-native';

// ---------------------------------------------------------------------------
// Imports DESPUÉS de registrar mocks
// ---------------------------------------------------------------------------

import { useVideoPlayer } from 'expo-video';
import { useVideoEngagementEvents } from '@/features/feed/hooks/useVideoEngagementEvents';
import { useLikeProperty } from '@/features/feed/hooks/useLikeProperty';
import { useSaveProperty } from '@/features/feed/hooks/useSaveProperty';
import { useAuth } from '@/features/auth/context';
import { VideoFeedItem } from '../components/VideoFeedItem';
import type { FeedPropertyWithUrl } from '../types';

// ---------------------------------------------------------------------------
// Mocks de módulos — ANTES de cualquier import del SUT
// ---------------------------------------------------------------------------

jest.mock('@/features/feed/hooks/useLikeProperty', () => ({
  useLikeProperty: jest.fn(),
}));

jest.mock('@/features/feed/hooks/useSaveProperty', () => ({
  useSaveProperty: jest.fn(),
}));

jest.mock('@/features/feed/hooks/useVideoEngagementEvents', () => ({
  useVideoEngagementEvents: jest.fn(),
}));

jest.mock('@/features/feed/lib/appSession', () => ({
  get_app_session_id: jest.fn(() => 'sesion-uuid-test-fija'),
}));

jest.mock('@/features/auth/context', () => ({
  useAuth: jest.fn(),
}));

// PropertyOverlay → marcador que CAPTURA sus props (necesitamos leer
// onComments/commentCount, no su render real — mismo motivo que el mock de
// HeartAnimation de abajo, más el "capture" adicional).
const mock_property_overlay = jest.fn((_props: Record<string, unknown>) => null);
jest.mock('@/features/feed/components/PropertyOverlay', () => ({
  PropertyOverlay: (props: Record<string, unknown>) => mock_property_overlay(props),
}));

jest.mock('@/features/feed/components/HeartAnimation', () => ({
  HeartAnimation: () => null,
}));

// CommentsSheet → marcador VISIBLE en el árbol (testID) cuando está montado,
// para poder verificar monta/desmonta con queryByTestId — mismo motivo por
// el que ActionButtons.test.tsx lo stubea a un componente vacío, aquí
// necesitamos además observar presencia/ausencia.
const mock_comments_sheet = jest.fn((_props: Record<string, unknown>) => null);
jest.mock('@/features/comments/components/CommentsSheet', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    CommentsSheet: (props: Record<string, unknown>) => {
      mock_comments_sheet(props);
      return react.createElement(View, { testID: 'mock-comments-sheet' });
    },
  };
});

jest.mock('expo-image', () => ({
  Image: () => null,
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(),
  VideoView: () => null,
}));

// ---------------------------------------------------------------------------
// Fake player — expo-video controlable desde el test (calco de VideoFeedItem.test.tsx)
// ---------------------------------------------------------------------------

type FakePlayerListener = (payload: unknown) => void;

interface FakePlayer {
  loop: boolean;
  muted: boolean;
  bufferOptions: unknown;
  timeUpdateEventInterval: number;
  duration: number;
  playing: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  replaceAsync: jest.Mock;
  addListener: jest.Mock;
  _emit: (event: string, payload: unknown) => void;
}

function create_fake_player(): FakePlayer {
  const listeners = new Map<string, Set<FakePlayerListener>>();

  const player: FakePlayer = {
    loop: false,
    muted: false,
    bufferOptions: undefined,
    timeUpdateEventInterval: 0,
    duration: 40,
    playing: false,
    play: jest.fn(() => {
      player.playing = true;
    }),
    pause: jest.fn(() => {
      player.playing = false;
    }),
    replaceAsync: jest.fn(() => Promise.resolve()),
    addListener: jest.fn((event: string, cb: FakePlayerListener) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(cb);
      return { remove: () => listeners.get(event)?.delete(cb) };
    }),
    _emit: (event, payload) => {
      listeners.get(event)?.forEach((cb) => cb(payload));
    },
  };

  return player;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID = 'agente-uuid-1';

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
    owner_user_id: OWNER_ID,
    agency_id: null,
    created_at: '2026-01-01T00:00:00Z',
    agent_has_phone: false,
    agent_name: null,
    agent_photo_url: null,
    comment_count: 9,
    video: { id: 'video-uuid-A', storage_path: 'x/y.mp4', position: 0, thumbnail_url: null },
    signed_url: 'https://cdn.example/video-A.mp4',
    video_id: 'video-uuid-A',
    posterUrl: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cast tipado de mocks
// ---------------------------------------------------------------------------

const mock_use_video_player = useVideoPlayer as jest.MockedFunction<typeof useVideoPlayer>;
const mock_use_video_engagement_events = useVideoEngagementEvents as jest.MockedFunction<
  typeof useVideoEngagementEvents
>;
const mock_use_like_property = useLikeProperty as jest.MockedFunction<typeof useLikeProperty>;
const mock_use_save_property = useSaveProperty as jest.MockedFunction<typeof useSaveProperty>;
const mock_use_auth = useAuth as jest.MockedFunction<typeof useAuth>;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fake_player: FakePlayer;

function last_overlay_props(): Record<string, unknown> {
  const calls = mock_property_overlay.mock.calls;
  return calls[calls.length - 1]![0];
}

function last_sheet_props(): Record<string, unknown> {
  const calls = mock_comments_sheet.mock.calls;
  return calls[calls.length - 1]![0];
}

beforeEach(() => {
  jest.clearAllMocks();

  fake_player = create_fake_player();
  mock_use_video_player.mockImplementation(((_source: unknown, setup?: (p: FakePlayer) => void) => {
    setup?.(fake_player);
    return fake_player;
  }) as unknown as typeof useVideoPlayer);

  mock_use_like_property.mockReturnValue({ isLiked: false, toggleLike: jest.fn(), likeOnly: jest.fn() });
  mock_use_save_property.mockReturnValue({ isSaved: false, toggleSave: jest.fn() });

  mock_use_video_engagement_events.mockImplementation(() => ({
    report_view: jest.fn(),
    report_time_update: jest.fn(),
    report_progress: jest.fn(),
  }));

  // Default: sin sesión. Los casos VC-7/VC-8 sobreescriben.
  mock_use_auth.mockReturnValue({
    user: null,
    session: null,
    isLoading: false,
    signIn: jest.fn(),
    signOut: jest.fn(),
    requestPasswordReset: jest.fn(),
    updatePassword: jest.fn(),
  } as any);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VideoFeedItem — botón de comentarios en el rail (289.10)', () => {

  // ── (VC-1) onComments existe como función ────────────────────────────────

  it('(VC-1) rail_recibe_on_comments_como_funcion: PropertyOverlay recibe onComments como función — sin esto, el rail no puede abrir la hoja de comentarios', async () => {
    await act(async () => {
      await render(<VideoFeedItem property={make_property()} isActive={true} />);
    });

    expect(typeof last_overlay_props().onComments).toBe('function');
  });

  // ── (VC-2) tap → monta CommentsSheet con property_id correcto ────────────

  it('(VC-2) tap_comentarios_monta_commentssheet_con_property_id_correcto: invocar onComments → CommentsSheet se monta (visible en el árbol) con property_id de la propiedad activa', async () => {
    let view: RenderResult;
    await act(async () => {
      view = await render(<VideoFeedItem property={make_property({ id: 'propiedad-uuid-Z' })} isActive={true} />);
    });

    expect(view!.queryByTestId('mock-comments-sheet')).toBeNull();

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    expect(view!.queryByTestId('mock-comments-sheet')).not.toBeNull();
    expect(last_sheet_props().property_id).toBe('propiedad-uuid-Z');
  });

  // ── (VC-3) cerrar la hoja la desmonta ─────────────────────────────────────

  it('(VC-3) cerrar_hoja_desmonta_commentssheet: on_dismiss de la hoja → CommentsSheet desaparece del árbol', async () => {
    let view: RenderResult;
    await act(async () => {
      view = await render(<VideoFeedItem property={make_property()} isActive={true} />);
    });

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });
    expect(view!.queryByTestId('mock-comments-sheet')).not.toBeNull();

    await act(async () => {
      (last_sheet_props().on_dismiss as () => void)();
    });

    expect(view!.queryByTestId('mock-comments-sheet')).toBeNull();
  });

  // ── (VC-4) abrir la hoja pausa el video activo ───────────────────────────

  it('(VC-4) abrir_hoja_pausa_el_video_activo: isActive=true (video reproduciendo) → invocar onComments pausa el player — cuota de Stream/UX (video_playback_burns_quota)', async () => {
    await act(async () => {
      await render(<VideoFeedItem property={make_property()} isActive={true} />);
    });

    expect(fake_player.playing).toBe(true);

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    expect(fake_player.pause).toHaveBeenCalled();
    expect(fake_player.playing).toBe(false);
  });

  // ── (VC-5) cerrar reanuda si el ítem sigue activo ────────────────────────

  it('(VC-5) cerrar_hoja_reanuda_si_el_item_sigue_activo: la hoja se cierra mientras isActive sigue true → el video reanuda', async () => {
    await act(async () => {
      await render(<VideoFeedItem property={make_property()} isActive={true} />);
    });

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });
    expect(fake_player.playing).toBe(false);

    await act(async () => {
      (last_sheet_props().on_dismiss as () => void)();
    });

    expect(fake_player.playing).toBe(true);
  });

  // ── (VC-6) cerrar NO reanuda si el ítem ya no está activo ────────────────

  it('(VC-6) cerrar_hoja_no_reanuda_si_el_item_ya_no_esta_activo: el usuario deslizó fuera del ítem (isActive→false) mientras la hoja estaba abierta → al cerrarla, el video NO reanuda', async () => {
    let view: RenderResult;
    const property = make_property();
    await act(async () => {
      view = await render(<VideoFeedItem property={property} isActive={true} />);
    });

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    await act(async () => {
      view.rerender(<VideoFeedItem property={property} isActive={false} />);
    });
    expect(fake_player.playing).toBe(false);

    await act(async () => {
      (last_sheet_props().on_dismiss as () => void)();
    });

    expect(fake_player.playing).toBe(false);
  });

  // ── (VC-7) can_hide=true para el propietario ─────────────────────────────

  it('(VC-7) can_hide_true_cuando_la_sesion_es_el_propietario: user.id === owner_user_id → CommentsSheet recibe can_hide=true', async () => {
    mock_use_auth.mockReturnValue({
      user: { id: OWNER_ID },
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      updatePassword: jest.fn(),
    } as any);

    await act(async () => {
      await render(<VideoFeedItem property={make_property({ owner_user_id: OWNER_ID })} isActive={true} />);
    });

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    expect(last_sheet_props().can_hide).toBe(true);
  });

  // ── (VC-8) can_hide=false para un usuario distinto al propietario ────────

  it('(VC-8) can_hide_false_cuando_la_sesion_no_es_el_propietario: user.id !== owner_user_id → CommentsSheet recibe can_hide=false', async () => {
    mock_use_auth.mockReturnValue({
      user: { id: 'otro-usuario-uuid' },
      session: null,
      isLoading: false,
      signIn: jest.fn(),
      signOut: jest.fn(),
      requestPasswordReset: jest.fn(),
      updatePassword: jest.fn(),
    } as any);

    await act(async () => {
      await render(<VideoFeedItem property={make_property({ owner_user_id: OWNER_ID })} isActive={true} />);
    });

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    expect(last_sheet_props().can_hide).toBe(false);
  });

  // ── (VC-9) can_hide=false sin sesión ─────────────────────────────────────

  it('(VC-9) can_hide_false_sin_sesion: user=null → CommentsSheet recibe can_hide=false (nunca undefined/truthy por accidente)', async () => {
    await act(async () => {
      await render(<VideoFeedItem property={make_property({ owner_user_id: OWNER_ID })} isActive={true} />);
    });

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    expect(last_sheet_props().can_hide).toBe(false);
  });

  // ── (VC-10) comment_count inicial viene de la propiedad ──────────────────

  it('(VC-10) comment_count_inicial_viene_de_la_propiedad: property.comment_count=9 → PropertyOverlay y CommentsSheet reciben commentCount/comment_count=9', async () => {
    await act(async () => {
      await render(<VideoFeedItem property={make_property({ comment_count: 9 })} isActive={true} />);
    });

    expect(last_overlay_props().commentCount).toBe(9);

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    expect(last_sheet_props().comment_count).toBe(9);
  });

  // ── (VC-11) comment_count ausente cae a 0 ────────────────────────────────

  it('(VC-11) comment_count_ausente_en_la_propiedad_cae_a_cero: property.comment_count=undefined → PropertyOverlay recibe commentCount=0, nunca undefined', async () => {
    const property = make_property();
    delete (property as { comment_count?: number }).comment_count;

    await act(async () => {
      await render(<VideoFeedItem property={property} isActive={true} />);
    });

    expect(last_overlay_props().commentCount).toBe(0);
  });

  // ── (VC-12) el contador sube +1 tras publicar, sin refetch ───────────────

  it('(VC-12) contador_sube_uno_tras_publicar_sin_refetch: on_comment_posted (prop de CommentsSheet) se invoca → commentCount del rail sube en +1 de forma local, sin volver a pedir la propiedad', async () => {
    await act(async () => {
      await render(<VideoFeedItem property={make_property({ comment_count: 9 })} isActive={true} />);
    });

    await act(async () => {
      (last_overlay_props().onComments as () => void)();
    });

    expect(typeof last_sheet_props().on_comment_posted).toBe('function');

    await act(async () => {
      (last_sheet_props().on_comment_posted as () => void)();
    });

    expect(last_overlay_props().commentCount).toBe(10);
  });

});
