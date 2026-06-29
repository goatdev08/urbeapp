/**
 * VideoFeedItem.tsx — Ítem de feed de video full-screen.
 *
 * Usa expo-video SDK 56 (useVideoPlayer + VideoView) para reproducción
 * inmersiva vertical. Activado/pausado por prop `isActive` según el ítem
 * visible en FlashList.
 *
 * ponytail: sin poster real — fondo oscuro sólido mientras carga
 *   (sin transcoding ni thumbnails en la demo).
 *   isLiked/isSaved son estado local temporal — la persistencia real llega en 9.7.
 */

import React, { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View, Text, useWindowDimensions } from 'react-native';
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from 'expo-video';

import { PropertyOverlay } from './PropertyOverlay';

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
  // expo-video SDK56 no expone prefetch; la precarga ocurre porque drawDistance
  // en FlashList mantiene los ítems vecinos montados → su useVideoPlayer bufferea.
  // useVideoPlayer auto-libera el player al desmontar (SDK56 gestiona el ciclo de vida).
  const [player_status, set_player_status] = useState<VideoPlayerStatus>('loading');

  // ponytail: estado local temporal de like/guardar — la persistencia real
  // (Supabase likes + saved_properties) llega en subtarea 9.7.
  const [is_liked, set_is_liked] = useState(false);
  const [is_saved, set_is_saved] = useState(false);

  const handle_like = useCallback(() => set_is_liked((prev) => !prev), []);
  const handle_save = useCallback(() => set_is_saved((prev) => !prev), []);
  // ponytail: navegación al perfil del agente diferida — sin ruta feed→perfil en 9.6.
  const handle_agent_press = useCallback(() => undefined, []);

  const player = useVideoPlayer(property.signed_url, (p) => {
    p.loop = true;
    p.muted = false;
  });

  // Detectar error de carga (URL firmada inválida/expirada) y trackear status.
  // statusChange event: { status: 'idle'|'loading'|'readyToPlay'|'error', error? }
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

      {/* Spinner mientras el ítem activo carga. Los ítems vecinos (pre-montados
          por drawDistance) no muestran spinner — solo el visible lo necesita. */}
      {isActive && player_status === 'loading' && (
        <ActivityIndicator
          style={styles.loading_spinner}
          size="large"
          color="rgba(255,255,255,0.7)"
        />
      )}

      {/* Overlay de UI: info de la propiedad + botones like/guardar + avatar agente */}
      <PropertyOverlay
        property={property}
        isLiked={is_liked}
        isSaved={is_saved}
        onLike={handle_like}
        onSave={handle_save}
        onAgentPress={handle_agent_press}
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
  loading_spinner: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
