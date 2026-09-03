/**
 * VideoFeedItem.tsx — Ítem de feed de video full-screen.
 *
 * Usa expo-video SDK 56 (useVideoPlayer + VideoView) para reproducción
 * inmersiva vertical. Activado/pausado por prop `isActive` según el ítem
 * visible en FlashList.
 *
 * Subtarea 9.7: integración de persistencia real (useLikeProperty +
 * useSaveProperty) y gesto de doble-tap (GestureDetector) con
 * HeartAnimation + haptics.
 *
 * Portada: posterUrl firmado de Cloudflare Stream (68.15) con fallback al
 *   thumbnail_url legacy de Storage; fondo oscuro sólido si no hay ninguno.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, Text, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from 'expo-video';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import { Play } from 'phosphor-react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { PropertyOverlay } from './PropertyOverlay';
import { HeartAnimation } from './HeartAnimation';
import { useLikeProperty } from '../hooks/useLikeProperty';
import { useSaveProperty } from '../hooks/useSaveProperty';
import { useVideoEngagementEvents } from '../hooks/useVideoEngagementEvents';
import { create_video_engagement_store } from '../lib/videoEngagementDedupe';
import { get_app_session_id } from '../lib/appSession';
import { fit_for_video, type MediaSize } from '../lib/videoFit';
import { useContactAgent } from '@/hooks/useContactAgent';
import { share_property } from '@/lib/shareProperty';

import { colors, type_scale } from '@/theme/theme';
import type { FeedPropertyWithUrl } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Store de dedupe de engagement — singleton de MÓDULO (no de componente): debe
// sobrevivir el reciclaje de ítems de FlashList (unmount/remount de
// VideoFeedItem), igual que get_app_session_id. Ver useVideoEngagementEvents.ts.
// ─────────────────────────────────────────────────────────────────────────────
const video_engagement_store = create_video_engagement_store();

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type VideoFeedItemProps = {
  property: FeedPropertyWithUrl;
  isActive: boolean;
  onVideoEnd?: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

function VideoFeedItemComponent({ property, isActive, onVideoEnd }: VideoFeedItemProps) {
  const { width, height } = useWindowDimensions();
  // 68.15: prefiere el poster firmado de Stream; cae al thumbnail_url legacy.
  const poster_uri = property.posterUrl ?? property.video.thumbnail_url;

  // #242.2 — presentación híbrida (decisión Abraham 2026-09-03): vertical →
  // cover (inmersivo); horizontal/cuadrado → contain sobre la portada
  // desenfocada. El tamaño llega primero por la portada de Stream (misma
  // relación que el video, cacheada en disco → sin salto visible) y luego lo
  // confirma el track del player. Se guarda junto al id de la propiedad para
  // que el reciclaje de FlashList no arrastre el tamaño del video anterior
  // (derivación pura, sin efecto de reset).
  const [media, set_media] = useState<{ id: string; size: MediaSize } | null>(null);
  const media_size = media?.id === property.id ? media.size : null;
  const fit = fit_for_video(media_size, { width, height });
  const is_contain = fit === 'contain';
  const remember_media_size = useCallback(
    (size: MediaSize | undefined) => {
      if (size && size.width > 0 && size.height > 0) set_media({ id: property.id, size });
    },
    [property.id],
  );
  const [has_error, set_has_error] = useState(false);
  // ponytail: player_status para mostrar spinner mientras carga el ítem activo.
  const [player_status, set_player_status] = useState<VideoPlayerStatus>('loading');

  // Contador de disparos del corazón. Incrementar en cada doble-tap.
  // Usar número en vez de boolean para re-disparar taps consecutivos.
  const [heart_trigger, set_heart_trigger] = useState(0);

  // Pausa manual (tap simple). Muestra el ícono de play centrado mientras está
  // pausado. Se resetea al activarse el ítem (auto-play por visibilidad).
  const [is_paused, set_is_paused] = useState(false);

  // ── Persistencia real (9.7) ────────────────────────────────────────────────
  // ponytail: property.video_id → property_video_id (likes); property.id → property_id.
  const { isLiked, toggleLike, likeOnly } = useLikeProperty({
    property_video_id: property.video_id,
    property_id: property.id,
  });

  const { isSaved, toggleSave } = useSaveProperty({
    property_id: property.id,
  });

  // Contacto por WhatsApp — el MISMO camino que el detalle: la EF crea el lead
  // y devuelve el template §19.3. Ver el comentario de handle_whatsapp abajo.
  const { contact_agent } = useContactAgent();

  // ── Telemetría de engagement (112.2) ───────────────────────────────────────
  // session_id + store son singletons de módulo (arriba) — sobreviven el
  // reciclaje de VideoFeedItem por FlashList dentro de la MISMA sesión de app.
  const { report_view, report_time_update } = useVideoEngagementEvents({
    property_id: property.id,
    property_video_id: property.video_id,
    session_id: get_app_session_id(),
    store: video_engagement_store,
  });

  // Like desde el rail — mismo feedback que el doble-tap: corazón grande +
  // haptic cuando ENCIENDE el like (al quitarlo, solo el cambio de icono).
  const handle_rail_like = useCallback(() => {
    if (!isLiked) {
      set_heart_trigger((t) => t + 1);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    toggleLike();
  }, [isLiked, toggleLike]);

  // Guardar — haptic sutil de confirmación al alternar.
  const handle_save = useCallback(() => {
    Haptics.selectionAsync();
    toggleSave();
  }, [toggleSave]);

  // #145.4: tap en avatar/nombre del agente → su perfil público con sus
  // publicaciones (/profile/[id] ya existía desde #16.6; el stub era de 9.6).
  const handle_agent_press = useCallback(() => {
    router.push(`/profile/${property.owner_user_id}`);
  }, [property.owner_user_id]);

  // Tap sobre el bloque de info → detalle de la propiedad (/property/[id]).
  const handle_property_press = useCallback(() => {
    router.push(`/property/${property.id}`);
  }, [property.id]);

  // WhatsApp desde el feed — solo si el agente tiene teléfono.
  // 75.4: antes llamaba a open_whatsapp() directo y NO registraba lead. Era el
  // hueco grande: el feed es donde más se contacta, así que el CRM se estaba
  // perdiendo justo los contactos más frecuentes (y con ellos el acceso a datos
  // que §19.2 concede al agente y los +10 de scoring). Ahora pasa por la EF.
  const handle_whatsapp = property.agent_phone
    ? () => { void contact_agent(property.id); }
    : null;

  // Compartir link al video (Share nativo) — funciona sin cuenta en Urbea.
  const handle_share = useCallback(() => {
    void share_property({
      signedUrl: property.signed_url,
      address: property.address,
      price: property.price,
      currency: property.currency,
    });
  }, [property.signed_url, property.address, property.price, property.currency]);

  // ── Video player ──────────────────────────────────────────────────────────
  // ponytail: fix #61 — player ESTABLE por instancia. useVideoPlayer recrea el
  // player (release + new) cuando cambia la fuente, y con FlashList reciclando
  // ítems + URLs re-firmadas en cada refetch de filtros, el VideoView nativo
  // alcanzaba a recibir el player viejo ya liberado ("Cannot set prop 'player'
  // ... shared object already released"). El player nace UNA vez con la fuente
  // inicial de la instancia y los cambios de fuente entran por replaceAsync
  // (efecto más abajo) — nunca se libera mientras el componente viva.
  const [initial_source] = useState(property.signed_url);
  const player = useVideoPlayer(initial_source, (p) => {
    p.loop = true;
    p.muted = false;
    // ponytail: fix #57 — tope al buffer de ExoPlayer para evitar OOM en el
    // heap Android de 192MB con video crudo de demo (sin transcodificar).
    // preferredForwardBufferDuration baja el lookahead del default Android
    // de 20s a 10s; maxBufferBytes es Android-only (iOS lo ignora) y limita
    // 25MB por player (~100MB para los ~4 players vivos en drawDistance),
    // dejando margen al resto del heap. Techo conocido: la solución de
    // fondo es Cloudflare Stream/HLS en beta.
    p.bufferOptions = {
      preferredForwardBufferDuration: 10,
      maxBufferBytes: 25 * 1024 * 1024,
    };
    // 112.2: playToEnd NUNCA dispara con loop=true (ver comentario más abajo),
    // así que la compleción se detecta comparando currentTime/duration en cada
    // tick de `timeUpdate`. 0.5s balancea precisión vs batería: bastante fino
    // para no perder el cruce del 95% incluso en los videos cortos del demo
    // (~15s → la cola del 5% son ~0.75s, más que el propio intervalo) sin
    // disparar el listener con una frecuencia innecesaria (2/seg, nada costoso
    // — el INSERT real solo ocurre una vez gracias al dedupe del store).
    p.timeUpdateEventInterval = 0.5;
  });

  // isActive en ref — el .then() de replaceAsync decide si reanudar sin meter
  // isActive a las deps del efecto de reemplazo (que solo reacciona a la fuente).
  const is_active_ref = useRef(isActive);
  useEffect(() => {
    is_active_ref.current = isActive;
  }, [isActive]);

  // Cambio de fuente en la MISMA instancia: FlashList recicló el ítem hacia
  // otra property, o el refetch (filtros/pull-to-refresh) re-firmó la URL del
  // mismo video. Se reemplaza el medio dentro del player vivo y se resetea el
  // estado UI heredado del ítem anterior.
  const applied_source_ref = useRef(initial_source);
  useEffect(() => {
    if (property.signed_url === applied_source_ref.current) return;
    applied_source_ref.current = property.signed_url;
    set_has_error(false);
    set_is_paused(false);
    void player
      .replaceAsync(property.signed_url)
      .then(() => {
        if (is_active_ref.current) player.play();
      })
      .catch(() => set_has_error(true));
  }, [player, property.signed_url]);

  // Tap simple → alterna play/pausa del video activo.
  const toggle_play_pause = useCallback(() => {
    if (player.playing) {
      player.pause();
      set_is_paused(true);
    } else {
      player.play();
      set_is_paused(false);
    }
  }, [player]);

  // ── Gestos ──────────────────────────────────────────────────────────────────
  // runOnJS(true): los callbacks llaman funciones JS (hooks, Haptics, expo-video).
  // Sin esto, gesture-handler los corre como worklets en el UI thread y truena
  // ("Tried to synchronously call a non-worklet function on the UI thread").
  // Doble-tap → like (TikTok: no unlike) + corazón + haptic.
  const double_tap_gesture = Gesture.Tap()
    .numberOfTaps(2)
    .runOnJS(true)
    .onEnd(() => {
      likeOnly();
      set_heart_trigger((t) => t + 1);
      // ponytail: sin await — haptic fire-and-forget.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });

  // Tap simple → play/pausa. Exclusive: espera a descartar el doble-tap antes de
  // disparar el simple, así un doble-tap no pausa de pasada.
  const single_tap_gesture = Gesture.Tap()
    .numberOfTaps(1)
    .runOnJS(true)
    .onEnd(toggle_play_pause);

  const tap_gesture = Gesture.Exclusive(double_tap_gesture, single_tap_gesture);

  // Detectar error de carga (URL firmada inválida/expirada) y trackear status.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      set_player_status(status);
      if (status === 'error') {
        set_has_error(true);
      }
    });
    return () => sub.remove();
  }, [player]);

  // #242.2: el track real del video confirma (o corrige) el tamaño de la portada.
  useEffect(() => {
    const sub = player.addListener('videoTrackChange', ({ videoTrack }) => {
      remember_media_size(videoTrack?.size);
    });
    return () => sub.remove();
  }, [player, remember_media_size]);

  // Notificar fin de reproducción (no dispara cuando loop=true, pero se
  // mantiene para futuros modos sin loop).
  useEffect(() => {
    if (!onVideoEnd) return undefined;
    const sub = player.addListener('playToEnd', () => {
      onVideoEnd();
    });
    return () => sub.remove();
  }, [player, onVideoEnd]);

  // 112.2: compleción de video — playToEnd NO sirve con loop=true (ver arriba),
  // así que se detecta en cada tick de `timeUpdate` (intervalo fijado en
  // timeUpdateEventInterval, arriba). report_time_update es fire-and-forget
  // (no se propaga error) y deduplica internamente, así que es seguro llamarlo
  // en cada tick sin condicionarlo a isActive.
  //
  // 🔴 fix guardian 112.2: property.id EN DEPS es obligatorio, no cosmético.
  // report_time_update cierra sobre property_id (vía el hook de arriba). `player`
  // es ESTABLE durante toda la vida de la instancia (fix #61, replaceAsync más
  // abajo) — con deps=[player] a secas este efecto NUNCA se re-ejecutaba cuando
  // FlashList reciclaba la celda hacia otra property: el listener seguía atado
  // al report_time_update de la property VIEJA, así que video_completed se
  // insertaba con el property_id EQUIVOCADO (falso positivo en la vieja, falso
  // negativo en la nueva — el store ya la marcaba "vista" sin que el usuario la
  // hubiera visto). property.id fuerza el cleanup (sub.remove()) + re-suscripción
  // con el closure correcto en cada reciclaje.
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      report_time_update(currentTime, player.duration);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report_time_update en sí no está memoizado (nueva identidad cada render) y por eso NO se lista directo — property.id ya fuerza la re-suscripción cuando importa (ver comentario arriba); listar report_time_update además re-suscribiría en CADA render sin necesidad.
  }, [player, property.id]);

  // play / pause según visibilidad del ítem en el feed.
  //
  // 🔴 fix guardian 112.2: mismo patrón que el efecto de arriba, versión menos
  // grave — property.id en deps para que un reciclaje de FlashList que NO
  // cambia isActive (p.ej. refetch de filtros sobre la celda activa) SÍ
  // dispare report_view() de la property nueva, en vez de quedarse callado
  // porque isActive no cambió.
  useEffect(() => {
    if (isActive) {
      player.play();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza el override manual de pausa con isActive (ver comentario arriba).
      set_is_paused(false);
      // 112.2: registra la vista al activarse. Fire-and-forget + dedupe interno
      // (por session_id+property_id) — seguro aunque el efecto se repita.
      report_view();
    } else {
      player.pause();
    }
    // ponytail: sin cleanup con player.pause() — useVideoPlayer libera el player
    // al desmontar y pausar un objeto liberado truena ("shared object already
    // released"). El else de arriba ya pausa al desactivarse.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report_view en sí no está memoizado (nueva identidad cada render) y por eso NO se lista directo — property.id ya fuerza la re-ejecución cuando importa (ver comentario arriba).
  }, [isActive, player, property.id]);

  // ── Fallback de error ──────────────────────────────────────────────────────
  if (has_error) {
    return (
      <View style={[styles.container, { width, height }]}>
        <Text style={styles.error_text}>No se pudo cargar el video</Text>
      </View>
    );
  }

  // ── Reproductor ────────────────────────────────────────────────────────────
  return (
    <GestureDetector gesture={tap_gesture}>
      <View style={[styles.container, { width, height }]}>
        {/* Portada: prefiere el posterUrl firmado de Cloudflare Stream (68.15,
            frame elegido por thumbnail_pct); cae al thumbnail_url legacy de
            Storage si no hay (video pre-Stream). Vive SIEMPRE detrás del
            VideoView (antes solo en status 'loading', lo que dejaba un flash
            oscuro en 'idle' y entre swipes); el video la cubre en cuanto pinta
            su primer frame. expo-image la cachea en disco, así que el swipe de
            regreso es instantáneo. Sin poster → fondo oscuro sólido (fallback). */}
        {poster_uri && (
          <Image
            source={{ uri: poster_uri }}
            style={styles.poster}
            contentFit="cover"
            // #242.2: en contain la portada a cover es el FONDO desenfocado.
            blurRadius={is_contain ? 40 : 0}
            onLoad={(e) => remember_media_size(e.source)}
          />
        )}
        {is_contain && (
          <>
            {/* Tinta sobre el fondo desenfocado: el overlay de texto sigue legible. */}
            <View style={[styles.poster, styles.contain_tint]} pointerEvents="none" />
            {/* Portada nítida en el mismo encuadre que tendrá el video (contain). */}
            {poster_uri && (
              <Image source={{ uri: poster_uri }} style={styles.poster} contentFit="contain" />
            )}
          </>
        )}
        <VideoView
          player={player}
          style={styles.video}
          contentFit={fit}
          nativeControls={false}
        />

        {/* Spinner mientras el ítem activo carga. */}
        {isActive && player_status === 'loading' && (
          <ActivityIndicator
            style={styles.loading_spinner}
            size="large"
            color="rgba(255,255,255,0.7)"
          />
        )}

        {/* Indicador de pausa manual — ícono play centrado mientras está pausado.
            pointerEvents none → el tap para reanudar lo captura el GestureDetector. */}
        {is_paused && (
          <View style={styles.pause_overlay} pointerEvents="none">
            <Play size={72} color="rgba(255,255,255,0.85)" weight="fill" />
          </View>
        )}

        {/* Corazón animado centrado — siempre montado, se dispara con trigger > 0. */}
        <HeartAnimation trigger={heart_trigger} />

        {/* Overlay de UI: info de la propiedad + botones like/guardar + avatar agente */}
        <PropertyOverlay
          property={property}
          isLiked={isLiked}
          isSaved={isSaved}
          onLike={handle_rail_like}
          onSave={handle_save}
          onAgentPress={handle_agent_press}
          onPropertyPress={handle_property_press}
          onWhatsApp={handle_whatsapp}
          onShare={handle_share}
        />
      </View>
    </GestureDetector>
  );
}

export const VideoFeedItem = memo(VideoFeedItemComponent);

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.ink_feed,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  video: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  poster: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  contain_tint: {
    backgroundColor: 'rgba(23,20,15,0.35)', // colors.ink_feed @ 0.35
  },
  error_text: {
    ...type_scale.body,
    color: colors.gray_1,
  },
  loading_spinner: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  pause_overlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
