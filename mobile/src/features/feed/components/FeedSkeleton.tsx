/**
 * FeedSkeleton.tsx — Placeholder de carga inicial del feed vertical.
 *
 * Ghost full-screen oscuro con shimmer (haz de LinearGradient animado
 * de izquierda a derecha). Simula el área de video + la card inferior
 * (PropertyOverlay) con líneas fantasma.
 *
 * Se muestra solo mientras isLoading && data.length === 0 (carga inicial).
 *
 * ponytail: un único ítem skeleton — la primera página siempre arranca
 * con datos o error; N skeletons no aportan información extra.
 * Shimmer con translate (no opacity-pulse) para mayor claridad en fondo oscuro.
 */

import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';

import { colors } from '@/theme/theme';

// Porcentaje del ancho de pantalla que ocupa el haz de shimmer.
const BEAM_RATIO = 0.55;

// Color de los ghost-shapes sobre el fondo ink_feed.
const GHOST = 'rgba(255,255,255,0.07)';

export function FeedSkeleton() {
  const { width, height } = useWindowDimensions();
  const beam_width = width * BEAM_RATIO;
  const translate_x = useSharedValue(-beam_width);

  useEffect(() => {
    translate_x.value = withRepeat(
      withTiming(width + beam_width, {
        duration: 1300,
        easing: Easing.linear,
      }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(translate_x);
    };
  }, [translate_x, width, beam_width]);

  const shimmer_style = useAnimatedStyle(() => ({
    transform: [{ translateX: translate_x.value }],
  }));

  return (
    <View style={[styles.root, { width, height }]}>
      {/* Ghost del área de video: ocupa toda la pantalla */}
      <View style={styles.video_ghost} />

      {/* Ghost de la card inferior (simula PropertyOverlay) */}
      <View style={styles.card_ghost}>
        {/* línea de dirección */}
        <View style={styles.line_lg} />
        {/* línea de precio */}
        <View style={styles.line_md} />
        {/* línea de badges (hab / baños) */}
        <View style={styles.line_sm} />
      </View>

      {/* Shimmer: haz translúcido que barre de izquierda a derecha */}
      <Animated.View
        style={[styles.shimmer_beam, { width: beam_width, height }, shimmer_style]}
        pointerEvents="none"
      >
        <LinearGradient
          colors={[
            'transparent',
            'rgba(255,255,255,0.05)',
            'rgba(255,255,255,0.10)',
            'rgba(255,255,255,0.05)',
            'transparent',
          ]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.ink_feed,
    overflow: 'hidden',
  },
  video_ghost: {
    flex: 1,
    backgroundColor: GHOST,
  },
  card_ghost: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 52,
    paddingTop: 28,
    gap: 12,
  },
  line_lg: {
    height: 18,
    width: '78%',
    borderRadius: 4,
    backgroundColor: GHOST,
  },
  line_md: {
    height: 16,
    width: '48%',
    borderRadius: 4,
    backgroundColor: GHOST,
  },
  line_sm: {
    height: 14,
    width: '32%',
    borderRadius: 4,
    backgroundColor: GHOST,
  },
  shimmer_beam: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
