/**
 * Tests — VideoFeedItem component (wiring de telemetría 112.2)
 * Archivo SUT: mobile/src/features/feed/components/VideoFeedItem.tsx
 * Subtarea Taskmaster: 112.2 — cierre de mutantes vivos M6/M11/M13 (hallazgo guardian)
 *   + fix del bug de producción encontrado en la misma revisión: closure obsoleto
 *   de property_id tras el reciclaje de FlashList.
 *
 * Hasta esta subtarea NO existía NINGÚN test de VideoFeedItem: borrar la inyección
 * del store de dedupe, el listener de `timeUpdate`, o la llamada a report_view()
 * dejaba 29/29 tests en verde en el resto del repo. Este archivo cierra esos 3
 * huecos (M6, M11, M13) + el bug del closure (prioridad 1 del guardian).
 *
 * BUG DE PRODUCCIÓN CUBIERTO (prioridad 1 del guardian):
 *   report_view/report_time_update capturan `property.id` en su closure. El
 *   `player` de expo-video es ESTABLE durante toda la vida de la instancia (fix
 *   #61 — VideoFeedItem.tsx:137-143), así que cuando FlashList recicla la celda
 *   hacia OTRA propiedad (replaceAsync cambia el video, VideoFeedItem.tsx:181-193)
 *   los efectos que dependían solo de `[player]` NUNCA se re-suscribían: el
 *   listener de timeUpdate seguía atado al report_time_update de la propiedad
 *   VIEJA. Resultado: video_completed se atribuye a la propiedad EQUIVOCADA
 *   (falso positivo en la vieja, falso negativo en la nueva — el dedupe del store
 *   ya la marca "vista" sin que el usuario la haya visto). Mismo patrón, menos
 *   grave, en el efecto de isActive → report_view().
 *
 * ESTRATEGIA DE MOCK: VideoFeedItem se testea como caja de WIRING, no de UI.
 *   - PropertyOverlay/HeartAnimation → marcador (su render no es lo que se prueba
 *     aquí; mismo patrón que legal-wall en protected-layout.test.tsx).
 *   - expo-video → "fake player" controlable: addListener real (con .remove()) +
 *     _emit() de test para simular ticks de timeUpdate SIN reproducir video real.
 *   - useLikeProperty/useSaveProperty/useVideoEngagementEvents/appSession →
 *     mockeados a nivel de módulo (mismo patrón que ActionButtons.test.tsx).
 *
 * NOTA RNTL v14: render()/rerender() se envuelven en act(async () => {...}) —
 * mismo patrón que protected-layout.test.tsx (evita el "overlapping act()" que
 * documenta jest.setup.js).
 *
 * EDGE CASES CUBIERTOS:
 *
 * ### Wiring — sin esto, la captura desaparece sin que ningún test se ponga rojo
 * - (M6)  preserva_identidad_del_store_entre_remontajes
 * - (M13) reporta_vista_al_montar_activo
 * - (M11 + V1) suscribe_timeupdate_y_reporta_avance (+ timeUpdateEventInterval > 0)
 *
 * ### Bug de producción — closure obsoleto de property_id (prioridad 1 guardian)
 * - (BUG-1) reciclaje_de_flashlist_reatribuye_timeupdate_a_la_propiedad_actual
 * - (BUG-2) reciclaje_sin_cambio_de_isactive_reporta_vista_de_la_propiedad_nueva
 *
 * RE-ARBITRAJE (2 violaciones cerradas, ver bitácora 112.2):
 *   - V1: timeUpdateEventInterval=0 (default de expo-video) silencia el
 *     evento `timeUpdate` entero — borrar la línea que lo fija en
 *     VideoFeedItem.tsx dejaba la suite en verde porque el fake player emite
 *     a mano. Cubierto arriba en (M11 + V1).
 *   - V2: el (M6) original solo aseguraba `store !== undefined`
 *     (`toBeDefined()`), que no distingue el singleton de módulo de una
 *     instancia nueva por render. Reescrito para pinear la IDENTIDAD del
 *     store entre dos montajes distintos del componente.
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

// PropertyOverlay/HeartAnimation → marcadores nulos. Su render no es lo que se
// prueba aquí (dependen de safe-area-context/gradientes/reanimated — ruido
// para un test de wiring) y ningún test asierta sobre su contenido.
jest.mock('@/features/feed/components/PropertyOverlay', () => ({
  PropertyOverlay: () => null,
}));

jest.mock('@/features/feed/components/HeartAnimation', () => ({
  HeartAnimation: () => null,
}));

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
// Fake player — expo-video controlable desde el test (sin reproducir video real)
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
  /** Helper de TEST — no forma parte de la API real de expo-video. */
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
    agent_phone: null,
    agent_name: null,
    agent_photo_url: null,
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

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let fake_player: FakePlayer;

beforeEach(() => {
  jest.clearAllMocks();

  fake_player = create_fake_player();
  mock_use_video_player.mockImplementation(((_source: unknown, setup?: (p: FakePlayer) => void) => {
    setup?.(fake_player);
    return fake_player;
  }) as unknown as typeof useVideoPlayer);

  mock_use_like_property.mockReturnValue({
    isLiked: false,
    toggleLike: jest.fn(),
    likeOnly: jest.fn(),
  });
  mock_use_save_property.mockReturnValue({ isSaved: false, toggleSave: jest.fn() });

  // Nueva identidad de report_view/report_time_update en CADA llamada — necesario
  // para distinguir, en los tests de reciclaje (BUG-1/BUG-2), a qué render
  // (propiedad) quedó atado el listener suscrito.
  mock_use_video_engagement_events.mockImplementation(() => ({
    report_view: jest.fn(),
    report_time_update: jest.fn(),
  }));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VideoFeedItem — wiring de telemetría (112.2)', () => {

  // ── (M6) store inyectado al hook de telemetría ──────────────────────────

  it('(M6) preserva_identidad_del_store_entre_remontajes: useVideoEngagementEvents se llama con property_id/property_video_id/session_id, y el store recibido es EL MISMO OBJETO en dos montajes distintos (singleton de módulo, no una instancia nueva por render) — sin la identidad pineada, un usuario que hace scroll y vuelve a la misma propiedad generaría una fila video_view duplicada por cada remount', async () => {
    const property = make_property();

    let view: RenderResult;
    await act(async () => {
      view = await render(<VideoFeedItem property={property} isActive={true} />);
    });

    expect(mock_use_video_engagement_events).toHaveBeenCalledWith(
      expect.objectContaining({
        property_id: property.id,
        property_video_id: property.video_id,
        session_id: 'sesion-uuid-test-fija',
      })
    );
    const store_first_mount = mock_use_video_engagement_events.mock.calls[0]![0].store;
    expect(store_first_mount).toBeDefined();

    // Desmonta y vuelve a montar — simula el reciclaje de FlashList: el ítem
    // sale de pantalla y vuelve a entrar como una instancia NUEVA de React.
    await act(async () => {
      view.unmount();
    });
    await act(async () => {
      await render(<VideoFeedItem property={property} isActive={true} />);
    });

    // V2: toBeDefined() no distingue un singleton de módulo de una instancia
    // nueva creada en cada render — solo pinear la IDENTIDAD (===) entre dos
    // montajes cierra el mutante (store: create_video_engagement_store()
    // inline en vez del singleton `video_engagement_store`).
    const last = mock_use_video_engagement_events.mock.calls.length - 1;
    const store_second_mount = mock_use_video_engagement_events.mock.calls[last]![0].store;
    expect(store_second_mount).toBe(store_first_mount);
  });

  // ── (M13) report_view al montar activo ───────────────────────────────────

  it('(M13) reporta_vista_al_montar_activo: isActive=true desde el montaje → report_view() se invoca — sin esta llamada, ninguna vista se registra jamás', async () => {
    const property = make_property();

    await act(async () => {
      await render(<VideoFeedItem property={property} isActive={true} />);
    });

    const { report_view } = mock_use_video_engagement_events.mock.results[0]!.value;
    expect(report_view).toHaveBeenCalledTimes(1);
  });

  // ── (M11) suscripción a timeUpdate + reporte de avance ───────────────────

  it('(M11 + V1) suscribe_timeupdate_y_reporta_avance: el player registra un listener de "timeUpdate" que llama a report_time_update en cada tick, y timeUpdateEventInterval queda > 0 tras el montaje (con 0 — el default de expo-video — el evento NUNCA se emite: video_completed jamás se registraría en producción) — sin este listener, video_completed nunca se registra', async () => {
    const property = make_property();

    await act(async () => {
      await render(<VideoFeedItem property={property} isActive={true} />);
    });

    // V1: fake_player.timeUpdateEventInterval nace en 0 (arriba, línea ~135);
    // solo el setup del useVideoPlayer real (VideoFeedItem.tsx) lo sube a
    // 0.5. Borrar esa línea de producción deja esto en 0 → expo-video real
    // jamás emitiría "timeUpdate" pese a que el fake player de este test sí
    // lo emite a mano más abajo (por eso el resto de la suite no lo cazaba).
    expect(fake_player.timeUpdateEventInterval).toBeGreaterThan(0);

    expect(fake_player.addListener).toHaveBeenCalledWith('timeUpdate', expect.any(Function));

    const { report_time_update } = mock_use_video_engagement_events.mock.results[0]!.value;

    await act(async () => {
      fake_player._emit('timeUpdate', { currentTime: 38 });
    });

    expect(report_time_update).toHaveBeenCalledWith(38, fake_player.duration);
  });

  // ── (BUG-1) closure obsoleto — timeUpdate tras reciclaje ──────────────────

  it('(BUG-1) reciclaje_de_flashlist_reatribuye_timeupdate_a_la_propiedad_actual: la celda se recicla de la propiedad A a la Z (mismo player estable, isActive sin cambiar) → el tick de timeUpdate llama al report_time_update de Z, NUNCA al de A', async () => {
    const property_a = make_property({ id: 'propiedad-uuid-A', video_id: 'video-uuid-A' });
    const property_z = make_property({
      id: 'propiedad-uuid-Z',
      video_id: 'video-uuid-Z',
      signed_url: 'https://cdn.example/video-Z.mp4',
    });

    let view: RenderResult;
    await act(async () => {
      view = await render(<VideoFeedItem property={property_a} isActive={true} />);
    });

    const report_time_update_a = mock_use_video_engagement_events.mock.results[0]!.value
      .report_time_update as jest.Mock;

    await act(async () => {
      view.rerender(<VideoFeedItem property={property_z} isActive={true} />);
    });

    const last = mock_use_video_engagement_events.mock.results.length - 1;
    const report_time_update_z = mock_use_video_engagement_events.mock.results[last]!.value
      .report_time_update as jest.Mock;

    await act(async () => {
      fake_player._emit('timeUpdate', { currentTime: 38 });
    });

    expect(report_time_update_z).toHaveBeenCalledWith(38, fake_player.duration);
    expect(report_time_update_a).not.toHaveBeenCalled();
  });

  // ── (BUG-2) closure obsoleto — report_view tras reciclaje sin cambio de isActive ─

  it('(BUG-2) reciclaje_sin_cambio_de_isactive_reporta_vista_de_la_propiedad_nueva: isActive permanece true durante el reciclaje (p.ej. refetch de filtros) → report_view() de la propiedad NUEVA (Z) se invoca, no solo el de la vieja (A) al montar', async () => {
    const property_a = make_property({ id: 'propiedad-uuid-A', video_id: 'video-uuid-A' });
    const property_z = make_property({
      id: 'propiedad-uuid-Z',
      video_id: 'video-uuid-Z',
      signed_url: 'https://cdn.example/video-Z.mp4',
    });

    let view: RenderResult;
    await act(async () => {
      view = await render(<VideoFeedItem property={property_a} isActive={true} />);
    });

    await act(async () => {
      view.rerender(<VideoFeedItem property={property_z} isActive={true} />);
    });

    const last = mock_use_video_engagement_events.mock.results.length - 1;
    const report_view_z = mock_use_video_engagement_events.mock.results[last]!.value.report_view as jest.Mock;

    expect(report_view_z).toHaveBeenCalledTimes(1);
  });

});
