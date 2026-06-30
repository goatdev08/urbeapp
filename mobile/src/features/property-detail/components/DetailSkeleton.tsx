/**
 * DetailSkeleton.tsx — Placeholder de carga para PropertyDetailScreen.
 *
 * Subtarea Taskmaster: 10.7 — loading state rico.
 *
 * Estructura en dos zonas:
 *   1. Hero oscuro (HERO_HEIGHT=260, ink_feed) — ghost del área de video.
 *   2. Contenido claro (paper) — ghost de PropertyInfoHeader + secciones.
 *
 * ponytail: reutiliza el patrón shimmer de FeedSkeleton.tsx
 *   (un único LinearGradient animado con translateX que barre ambas zonas).
 *   GHOST = rgba(255,255,255,0.07) para zona oscura;
 *   GHOST_LIGHT = rgba(30,26,21,0.07) para zona clara.
 *   HERO_HEIGHT sincronizado con PropertyVideoPlayer (26.0 — misma constante).
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

// ponytail: constante sincronizada con PropertyVideoPlayer.HERO_HEIGHT
const HERO_HEIGHT = 260;
const BEAM_RATIO = 0.55;
// Ghost sobre fondo oscuro (ink_feed) — igual que FeedSkeleton
const GHOST = 'rgba(255,255,255,0.07)';
// Ghost sobre fondo claro (paper) — invertido para legibilidad
const GHOST_LIGHT = 'rgba(30,26,21,0.07)';

export function DetailSkeleton() {
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

  // Un solo sharedValue controla el shimmer de ambas zonas (sincronizados).
  const shimmer_style = useAnimatedStyle(() => ({
    transform: [{ translateX: translate_x.value }],
  }));

  return (
    <View style={[styles.root, { height }]}>

      {/* Zona oscura — ghost del hero de video */}
      <View style={[styles.hero, { width }]}>
        <View style={styles.hero_ghost} />
        <Animated.View
          style={[styles.shimmer_beam, { width: beam_width, height: HERO_HEIGHT }, shimmer_style]}
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

      {/* Zona clara — ghost de PropertyInfoHeader + dirección + precio + specs */}
      <View style={styles.content}>
        {/* Tipo de propiedad (caption pequeña) */}
        <View style={[styles.ghost_line, { width: '30%', height: 14 }]} />
        {/* Dirección / título */}
        <View style={[styles.ghost_line, { width: '72%', height: 22 }]} />
        {/* Precio */}
        <View style={[styles.ghost_line, { width: '48%', height: 32 }]} />
        {/* Specs: recámaras y baños */}
        <View style={[styles.ghost_line, { width: '38%', height: 16 }]} />

        <View style={styles.divider} />

        {/* Descripción */}
        <View style={[styles.ghost_line, { width: '85%', height: 14 }]} />
        <View style={[styles.ghost_line, { width: '70%', height: 14 }]} />
        <View style={[styles.ghost_line, { width: '55%', height: 14 }]} />

        {/* Shimmer sobre la zona clara */}
        <Animated.View
          style={[styles.shimmer_beam_light, { width: beam_width }, shimmer_style]}
          pointerEvents="none"
        >
          <LinearGradient
            colors={[
              'transparent',
              'rgba(30,26,21,0.04)',
              'rgba(30,26,21,0.07)',
              'rgba(30,26,21,0.04)',
              'transparent',
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      </View>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.paper,
    overflow: 'hidden',
  },
  // Zona oscura — hero
  hero: {
    height: HERO_HEIGHT,
    backgroundColor: colors.ink_feed,
    overflow: 'hidden',
  },
  hero_ghost: {
    flex: 1,
    backgroundColor: GHOST,
  },
  shimmer_beam: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  // Zona clara — contenido
  content: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 12,
    overflow: 'hidden',
  },
  ghost_line: {
    borderRadius: 4,
    backgroundColor: GHOST_LIGHT,
  },
  divider: {
    height: 1,
    backgroundColor: GHOST_LIGHT,
    marginVertical: 4,
  },
  shimmer_beam_light: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
  },
});
