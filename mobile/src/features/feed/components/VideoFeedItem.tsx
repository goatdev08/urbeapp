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
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from 'expo-video';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';

import { PropertyOverlay } from './PropertyOverlay';
import { HeartAnimation } from './HeartAnimation';
import { useLikeProperty } from '../hooks/useLikeProperty';
import { useSaveProperty } from '../hooks/useSaveProperty';

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

  // ── Persistencia real (9.7) ────────────────────────────────────────────────
  // ponytail: property.video_id → property_video_id (likes); property.id → property_id.
  const { isLiked, toggleLike, likeOnly } = useLikeProperty({
    property_video_id: property.video_id,
    property_id: property.id,
  });

  const { isSaved, toggleSave } = useSaveProperty({
    property_id: property.id,
  });

  // ponytail: navegación al perfil del agente diferida — sin ruta feed→perfil en 9.6.
  const handle_agent_press = useCallback(() => undefined, []);

  // ── Gesto de doble-tap ────────────────────────────────────────────────────
  // Llama likeOnly (TikTok: no unlike), muestra corazón y dispara haptic.
  // El callback de Gesture.Tap corre en hilo JS → llamadas directas a JS ok.
  const double_tap_gesture = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      likeOnly();
      set_heart_trigger((t) => t + 1);
      // ponytail: sin await — haptic fire-and-forget.
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    });

  // ── Video player ──────────────────────────────────────────────────────────
  const player = useVideoPlayer(property.signed_url, (p) => {
    p.loop = true;
    p.muted = false;
  });

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
    <GestureDetector gesture={double_tap_gesture}>
      <View style={[styles.container, { width, height }]}>
        {/* ponytail: backgroundColor del container = poster oscuro sólido mientras
            carga el video (sin transcoding → sin thumbnail real en la demo). */}
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

        {/* Corazón animado centrado — siempre montado, se dispara con trigger > 0. */}
        <HeartAnimation trigger={heart_trigger} />

        {/* Overlay de UI: info de la propiedad + botones like/guardar + avatar agente */}
        <PropertyOverlay
          property={property}
          isLiked={isLiked}
          isSaved={isSaved}
          onLike={toggleLike}
          onSave={toggleSave}
          onAgentPress={handle_agent_press}
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
});
