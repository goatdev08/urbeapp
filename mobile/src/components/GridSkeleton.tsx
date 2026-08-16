/**
 * GridSkeleton — placeholder de carga para la grilla de portadas 3-col en modo
 * gestión (Guardados, grilla del perfil). Tiles fantasma con pulso de opacidad.
 *
 * Complemento claro del FeedSkeleton (oscuro/beam): en fondo paper el pulso
 * sutil comunica "cargando" sin el barrido, y evita el salto de layout de un
 * ActivityIndicator centrado → grilla (pulido flash 2026-07-06).
 *
 * ⚠️ 179.2 — replica el layout REAL de la grilla (3 col borde a borde, tile
 * 3/4, gap hairline, sin líneas de texto debajo). Si diverge vuelve el salto
 * de layout que este componente existe para evitar.
 *
 * ponytail: número fijo de tiles fantasma; sin variantes de tamaño.
 */
import { useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { colors, grid_tile_width, layout } from '@/theme/theme';

/** 3 filas completas: cubre de sobra el alto visible de cualquier pantalla. */
const TILE_COUNT = layout.grid_cols * 3;

export function GridSkeleton() {
  const { width } = useWindowDimensions();
  const tile_width = grid_tile_width(width);
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
      {Array.from({ length: TILE_COUNT }, (_, i) => (
        <Animated.View key={i} style={[styles.tile, { width: tile_width }, pulse_style]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: layout.grid_tile_gap,
    backgroundColor: colors.paper,
  },
  tile: {
    aspectRatio: 3 / 4,
    backgroundColor: colors.paper_3,
  },
});
