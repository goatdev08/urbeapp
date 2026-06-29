/**
 * VideoFeedItem.tsx — Ítem de feed de video full-screen.
 *
 * Usa expo-video SDK 56 (useVideoPlayer + VideoView) para reproducción
 * inmersiva vertical. Activado/pausado por prop `isActive` según el ítem
 * visible en FlashList.
 *
 * ponytail: sin poster real — fondo oscuro sólido mientras carga
 *   (sin transcoding ni thumbnails en la demo).
 *   Sin overlay de datos (likes, CTA) — llegan en 9.6/9.7.
 */

import React, { memo, useEffect, useState } from 'react';
import { StyleSheet, View, Text, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

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

  const player = useVideoPlayer(property.signed_url, (p) => {
    p.loop = true;
    p.muted = false;
  });

  // Detectar error de carga (URL firmada inválida/expirada).
  // statusChange event: { status: 'idle'|'loading'|'readyToPlay'|'error', error? }
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') {
        set_has_error(true);
      }
    });
    return () => sub.remove();
  }, [player]);

  // Notificar fin de reproducción (no dispara cuando loop=true, pero se
  // mantiene para futuros modos sin loop o cuando 9.6 desactive el loop).
  useEffect(() => {
    if (!onVideoEnd) return undefined;
    const sub = player.addListener('playToEnd', () => {
      onVideoEnd();
    });
    return () => sub.remove();
  }, [player, onVideoEnd]);

  // play / pause según visibilidad del ítem en el feed.
  // Pausar también al desmontar (limpieza de efectos secundarios nativos).
  useEffect(() => {
    if (isActive) {
      player.play();
    } else {
      player.pause();
    }
    return () => {
      player.pause();
    };
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
    <View style={[styles.container, { width, height }]}>
      {/* ponytail: backgroundColor del container = poster oscuro sólido mientras
          carga el video (sin transcoding → sin thumbnail real en la demo). */}
      <VideoView
        player={player}
        style={styles.video}
        contentFit="cover"
        nativeControls={false}
      />
    </View>
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
});
