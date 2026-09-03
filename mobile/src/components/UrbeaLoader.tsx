/**
 * UrbeaLoader — el loader «Trazo» de Urbea (#243, decisión Abraham 2026-09-03).
 *
 * La silueta de una casa (techo + muros) se dibuja de un solo trazo en el color
 * del contexto, la puerta aparece en arcilla, todo se borra y vuelve a empezar.
 * Elegido entre cinco propuestas (artefacto «Loaders Urbea», opción C) para
 * usarse en TODA la app en lugar del ActivityIndicator nativo.
 *
 * API drop-in de ActivityIndicator — `size` ('small' | 'large' | number),
 * `color`, `style`, `testID`, `accessibilityLabel` — para que el reemplazo en
 * los ~55 usos sea mecánico (import + tag) y los testIDs de las suites sigan
 * intactos. 'small' = 20 y 'large' = 36, los mismos puntos que RN.
 *
 * Tamaños chicos: advertí que a 24 px el trazo pierde detalle y Abraham
 * reafirmó «en toda la app». Mitigación: el trazo engorda conforme baja el
 * tamaño y la puerta desaparece por debajo de 20 px (la casa sola se lee; la
 * puerta compite). Techo conocido y aceptado.
 *
 * Implementación: react-native-svg (ya instalado, ver IsotipoMark) + Reanimated
 * `useAnimatedProps` sobre `strokeDashoffset` de un Path con `strokeDasharray`
 * = largo del trazo. Un solo `progress` 0→1 en loop (2.2 s): 0–45 % dibuja,
 * 45–60 % sostiene, 60–100 % borra; la puerta corre la misma curva desfasada.
 * El largo de los paths está calculado a mano del viewBox 48×48 (segmentos
 * rectos: 2×√(16²+14²) + 17 + 24 + 17 ≈ 100.5; puerta 10 + 6 + 10 = 26).
 *
 * ponytail: sin Lottie, sin prop `animating` (nunca se usó en la app), sin
 * `hidesWhenStopped`. Si se quiere un loader estático, no se renderiza.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Techo y muros, un solo trazo (viewBox 48×48). */
const HOUSE_D = 'M8 24 L24 10 L40 24 M12 21 V38 H36 V21';
const HOUSE_LEN = 100.5;
/** Puerta: arranca en el piso, sube, cruza y baja. */
const DOOR_D = 'M21 38 V28 H27 V38';
const DOOR_LEN = 26;
/** Desfase del ciclo con el que la puerta va detrás de la casa. */
const DOOR_LAG = 0.16;
const CYCLE_MS = 2200;

/** Por debajo de este tamaño la puerta compite con el trazo; se omite. */
const MIN_SIZE_WITH_DOOR = 20;

export type UrbeaLoaderSize = 'small' | 'large' | number;

export interface UrbeaLoaderProps {
  /** 'small' = 20, 'large' = 36 (paridad con ActivityIndicator). Default 'small'. */
  size?: UrbeaLoaderSize;
  /** Color del techo y los muros. Default colors.primary (verde Urbea). */
  color?: string;
  /** Color de la puerta. Default colors.accent_soft (arcilla clara). */
  door_color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

export function resolve_loader_size(size: UrbeaLoaderSize): number {
  if (size === 'small') return 20;
  if (size === 'large') return 36;
  return size;
}

/** Grosor del trazo en unidades del viewBox: engorda al achicarse el loader. */
export function stroke_width_for(px: number): number {
  if (px >= 40) return 2.4;
  if (px >= 24) return 3.2;
  return 4;
}

/**
 * Desplazamiento del dash para un instante `p` del ciclo (0..1): de `len`
 * (invisible) a 0 (dibujado), pausa, y de 0 a -len (borrado por la cola).
 */
function dash_offset_at(p: number, len: number): number {
  'worklet';
  if (p < 0.45) return len * (1 - Easing.inOut(Easing.ease)(p / 0.45));
  if (p < 0.6) return 0;
  return -len * Easing.inOut(Easing.ease)((p - 0.6) / 0.4);
}

export function UrbeaLoader({
  size = 'small',
  color = colors.primary,
  door_color = colors.accent_soft,
  style,
  testID,
  accessibilityLabel = 'Cargando',
}: UrbeaLoaderProps) {
  const px = resolve_loader_size(size);
  const stroke_width = stroke_width_for(px);
  const show_door = px >= MIN_SIZE_WITH_DOOR;

  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withRepeat(
      withTiming(1, { duration: CYCLE_MS, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(progress);
  }, [progress]);

  const house_props = useAnimatedProps(() => ({
    strokeDashoffset: dash_offset_at(progress.value, HOUSE_LEN),
  }));
  const door_props = useAnimatedProps(() => ({
    strokeDashoffset: dash_offset_at((progress.value + 1 - DOOR_LAG) % 1, DOOR_LEN),
  }));

  return (
    <View
      style={[styles.box, { width: px, height: px }, style]}
      testID={testID}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
    >
      <Svg width={px} height={px} viewBox="0 0 48 48">
        <AnimatedPath
          d={HOUSE_D}
          stroke={color}
          strokeWidth={stroke_width}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          strokeDasharray={[HOUSE_LEN, HOUSE_LEN]}
          animatedProps={house_props}
        />
        {show_door && (
          <AnimatedPath
            d={DOOR_D}
            stroke={door_color}
            strokeWidth={stroke_width}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
            strokeDasharray={[DOOR_LEN, DOOR_LEN]}
            animatedProps={door_props}
            testID="urbea-loader-door"
          />
        )}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
