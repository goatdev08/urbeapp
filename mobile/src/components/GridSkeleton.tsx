/**
 * GridSkeleton — placeholder de carga para grillas 2-col en modo gestión
 * (Guardados, grilla del perfil). Cards fantasma con pulso de opacidad.
 *
 * Complemento claro del FeedSkeleton (oscuro/beam): en fondo paper el pulso
 * sutil comunica "cargando" sin el barrido, y evita el salto de layout de un
 * ActivityIndicator centrado → grilla (pulido flash 2026-07-06).
 *
 * ponytail: número fijo de cards fantasma; sin variantes de tamaño.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme/theme';

const CARD_COUNT = 6;

export function GridSkeleton() {
  const pulse = useSharedValue(0.5);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse]);

  const pulse_style = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.root}>
      {Array.from({ length: CARD_COUNT }, (_, i) => (
        <Animated.View key={i} style={[styles.card, pulse_style]}>
          <View style={styles.thumb} />
          <View style={styles.line_md} />
          <View style={styles.line_sm} />
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.s_12,
    paddingHorizontal: spacing.s_16,
    paddingTop: spacing.s_16,
    backgroundColor: colors.paper,
  },
  card: {
    // 2 columnas: mitad del ancho menos el gap.
    flexBasis: '47%',
    flexGrow: 1,
    gap: spacing.s_8,
  },
  thumb: {
    aspectRatio: 0.8,
    borderRadius: radii.r_16,
    backgroundColor: colors.paper_3,
  },
  line_md: {
    height: 14,
    width: '70%',
    borderRadius: radii.r_4,
    backgroundColor: colors.paper_3,
  },
  line_sm: {
    height: 12,
    width: '45%',
    borderRadius: radii.r_4,
    backgroundColor: colors.paper_2,
    marginBottom: spacing.s_8,
  },
});
