/**
 * PropertyVideoPlayer.tsx — Hero de video full-bleed para la pantalla de detalle.
 *
 * Reproduce el video de position más baja (position 1) de la propiedad.
 * Muestra un badge "N videos" en la esquina inferior derecha si hay >1 video.
 *
 * Patrón: useVideoPlayer + VideoView de expo-video, igual que VideoFeedItem.
 *
 * ponytail: fondo ink_feed como fallback cuando no hay poster (ni Stream ni legacy).
 * ponytail: autoplay muted al montar; nativeControls=false (hero limpio, mockup #5).
 * ponytail: NO player.pause() / release() en cleanup — useVideoPlayer libera el
 *   player al desmontar; pausar un objeto liberado truena ("shared object already released").
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView, type VideoPlayerStatus } from 'expo-video';

import { colors, radii, spacing, type_scale } from '@/theme/theme';
import type { PropertyVideoDetail } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

// ponytail: altura fija ~mockup #5; 10.3 puede ajustar si el layout pide ratio
const HERO_HEIGHT = 260;

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export type PropertyVideoPlayerProps = {
  /** Lista completa de videos de la propiedad (de usePropertyDetail → data.videos). */
  videos: PropertyVideoDetail[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve el video de menor position, undefined si el array está vacío. */
function find_primary_video(videos: PropertyVideoDetail[]): PropertyVideoDetail | undefined {
  return videos.reduce<PropertyVideoDetail | undefined>(
    (acc, v) => (!acc || v.position < acc.position ? v : acc),
    undefined,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function PropertyVideoPlayer({ videos }: PropertyVideoPlayerProps) {
  const primary_video = find_primary_video(videos);
  // null cuando no hay video o el signed_url aún no fue minted
  const video_url: string | null = primary_video?.signed_url ?? null;
  // 68.15: prefiere el poster firmado de Stream; cae al thumbnail_url legacy.
  const poster_uri = primary_video?.posterUrl ?? primary_video?.thumbnail_url ?? null;

  const [has_error, set_has_error] = useState(false);
  const [player_status, set_player_status] = useState<VideoPlayerStatus>('loading');

  // useVideoPlayer acepta null como fuente (sin video que cargar).
  const player = useVideoPlayer(video_url, (p) => {
    p.loop = true;
    p.muted = true; // ponytail: autoplay muted; sin solicitar permiso de audio al montar
    // Fix #57: tope de buffer anti-OOM — ver rationale en VideoFeedItem.tsx
    p.bufferOptions = {
      preferredForwardBufferDuration: 10,
      maxBufferBytes: 25 * 1024 * 1024,
    };
  });

  // Seguimiento de estado y detección de error de carga.
  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      set_player_status(status);
      if (status === 'error') {
        set_has_error(true);
      }
    });
    return () => sub.remove();
  }, [player]);

  // Autoplay al montar (solo si hay URL).
  useEffect(() => {
    if (video_url) {
      player.play();
    }
    // ponytail: sin cleanup con player.pause() — useVideoPlayer libera el player al
    // desmontar y llamar pause() sobre un objeto liberado truena con
    // "shared object already released" (bug corregido en VideoFeedItem).
  }, [player, video_url]);

  // ── Fallback: sin URL o error de carga ────────────────────────────────────
  // Placeholder oscuro — no crash, no pantalla blanca.
  if (!video_url || has_error) {
    return <View style={styles.container} />;
  }

  // ── Reproductor ────────────────────────────────────────────────────────────
  return (
    <View style={styles.container}>
      {/* Poster real detrás del VideoView — el hero deja de ser un rectángulo
          oscuro mientras carga (pulido flash 2026-07-06). Prefiere el poster
          firmado de Stream (68.15, frame de thumbnail_pct) sobre el
          thumbnail_url legacy de Storage. */}
      {poster_uri && (
        <Image source={{ uri: poster_uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
      )}
      <VideoView
        player={player}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        nativeControls={false}
      />

      {/* Spinner mientras el video carga / hace buffer */}
      {player_status === 'loading' && (
        <ActivityIndicator
          style={StyleSheet.absoluteFill}
          size="large"
          color="rgba(255,255,255,0.7)"
        />
      )}

      {/* Badge "N videos" — esquina inferior derecha, solo si hay más de uno */}
      {videos.length > 1 && (
        <View style={styles.badge}>
          <Text style={styles.badge_text}>{videos.length} videos</Text>
        </View>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: HERO_HEIGHT,
    backgroundColor: colors.ink_feed, // ponytail: poster oscuro sólido (sin thumbnails en demo)
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    bottom: spacing.s_12,
    right: spacing.s_12,
    // ponytail: ink_feed semi-opaco — sin nuevo token; dual-mode pendiente
    backgroundColor: 'rgba(23,20,15,0.75)',
    borderRadius: radii.r_4,
    paddingHorizontal: spacing.s_8,
    paddingVertical: spacing.s_4,
  },
  badge_text: {
    fontFamily: type_scale.caption.fontFamily,
    fontSize: type_scale.caption.fontSize,
    lineHeight: type_scale.caption.lineHeight,
    letterSpacing: type_scale.caption.letterSpacing,
    textTransform: 'uppercase',
    color: colors.gray_1,
  },
});
