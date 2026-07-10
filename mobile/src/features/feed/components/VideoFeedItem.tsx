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
 * ponytail: sin poster real — fondo oscuro sólido mientras carga
 *   (sin transcoding ni thumbnails en la demo).
 */

import React, { memo, useCallback, useEffect, useState } from 'react';
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
import { open_whatsapp } from '@/features/property-detail/utils/whatsapp';
import { share_property } from '@/lib/shareProperty';

import { colors, type_scale } from '@/theme/theme';
import type { FeedPropertyWithUrl } from '../types';

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

  // ponytail: navegación al perfil del agente diferida — sin ruta feed→perfil en 9.6.
  const handle_agent_press = useCallback(() => undefined, []);

  // Tap sobre el bloque de info → detalle de la propiedad (/property/[id]).
  const handle_property_press = useCallback(() => {
    router.push(`/property/${property.id}`);
  }, [property.id]);

  // WhatsApp directo desde el feed — solo si el agente tiene teléfono.
  // ponytail: contacto rápido sin lead CRM (como AgentCard del detalle); el
  // registro de lead vive en el CTA del detalle (contact-agent EF).
  const handle_whatsapp = property.agent_phone
    ? () => open_whatsapp(property.agent_phone, property.address)
    : null;

  // Compartir link al video (Share nativo) — funciona sin cuenta en Urbea.
  const handle_share = useCallback(() => {
    void share_property({
      signedUrl: property.signed_url,
      address: property.address,
      price: property.price,
    });
  }, [property.signed_url, property.address, property.price]);

  // ── Video player ──────────────────────────────────────────────────────────
  const player = useVideoPlayer(property.signed_url, (p) => {
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
  });

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

  // Notificar fin de reproducción (no dispara cuando loop=true, pero se
  // mantiene para futuros modos sin loop).
  useEffect(() => {
    if (!onVideoEnd) return undefined;
    const sub = player.addListener('playToEnd', () => {
      onVideoEnd();
    });
    return () => sub.remove();
  }, [player, onVideoEnd]);

  // play / pause según visibilidad del ítem en el feed.
  useEffect(() => {
    if (isActive) {
      player.play();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sincroniza el override manual de pausa con isActive (ver comentario arriba).
      set_is_paused(false);
    } else {
      player.pause();
    }
    // ponytail: sin cleanup con player.pause() — useVideoPlayer libera el player
    // al desmontar y pausar un objeto liberado truena ("shared object already
    // released"). El else de arriba ya pausa al desactivarse.
  }, [isActive, player]);

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
        {/* Portada (P7): frame medio del video servido como URL pública. Vive
            SIEMPRE detrás del VideoView (antes solo en status 'loading', lo que
            dejaba un flash oscuro en 'idle' y entre swipes); el video la cubre
            en cuanto pinta su primer frame. expo-image la cachea en disco, así
            que el swipe de regreso es instantáneo. Sin thumbnail → fondo oscuro
            sólido del container (fallback). */}
        {property.video.thumbnail_url && (
          <Image
            source={{ uri: property.video.thumbnail_url }}
            style={styles.poster}
            contentFit="cover"
          />
        )}
        <VideoView
          player={player}
          style={styles.video}
          contentFit="cover"
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
