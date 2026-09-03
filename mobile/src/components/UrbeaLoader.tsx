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
 * #243.4 (2026-09-03, smoke Android físico post-OTA): la primera versión usaba
 * Reanimated `useAnimatedProps` sobre `strokeDashoffset` de react-native-svg —
 * animó bien en AMBOS simuladores/emuladores (dev client + Metro) pero en el
 * teléfono Android real (build de producción, JS por OTA) el offset se quedaba
 * clavado en su valor inicial: la casa nunca se dibujaba, solo el texto del
 * chip. Combinar Reanimated (props via JSI/worklet) con props NATIVAS de un
 * host component de una librería de terceros (react-native-svg) es la
 * combinación menos probada de las dos formas de animar en RN. Se cambió al
 * `Animated` clásico de react-native — el mismo patrón que ya usa
 * `UploadProgressBar.tsx` en producción — con `useNativeDriver: false`
 * (obligatorio: el driver nativo solo soporta opacity/transform, no props
 * arbitrarias de un componente nativo como strokeDashoffset). Corre en el
 * hilo de JS; para un ícono de 20–48 px es imperceptible.
 *
 * Implementación: react-native-svg (ya instalado, ver IsotipoMark) + Animated
 * clásico. Dos `Animated.Value` en `Animated.loop`: dibuja (45 % del ciclo,
 * 990 ms) → sostiene (15 %, 330 ms) → borra (40 %, 880 ms) = 2200 ms. offset
 * len↔0 (dasharray=[len,len]: offset 0 = trazo completo visible, offset ±len =
 * invisible — la fase se repite cada 2·len, así que -len y +len son el mismo
 * estado; `Animated.loop` sencillamente sigue rebotando entre -len y 0 sin
 * necesitar un reset manual). La puerta corre el mismo ciclo con un retraso
 * único de DOOR_LAG antes de entrar a su propio loop (fase constante, sin
 * deriva). Largos de los paths calculados a mano del viewBox 48×48 (casa
 * ≈100.5, puerta 26).
 *
 * ponytail: sin Lottie, sin prop `animating` (nunca se usó en la app), sin
 * `hidesWhenStopped`. Si se quiere un loader estático, no se renderiza.
 */
import React, { useEffect, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { colors } from '@/theme/theme';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Techo y muros, un solo trazo (viewBox 48×48). */
const HOUSE_D = 'M8 24 L24 10 L40 24 M12 21 V38 H36 V21';
const HOUSE_LEN = 100.5;
/** Puerta: arranca en el piso, sube, cruza y baja. */
const DOOR_D = 'M21 38 V28 H27 V38';
const DOOR_LEN = 26;

const CYCLE_MS = 2200;
const DRAW_MS = Math.round(CYCLE_MS * 0.45);
const HOLD_MS = Math.round(CYCLE_MS * 0.15);
const ERASE_MS = CYCLE_MS - DRAW_MS - HOLD_MS;
/** Retraso único (no por ciclo) con el que la puerta va detrás de la casa. */
const DOOR_LAG_MS = Math.round(CYCLE_MS * 0.16);

const EASING = Easing.inOut(Easing.ease);

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

/** Un ciclo dibuja→sostiene→borra para un Animated.Value ya en `len` (invisible). */
function draw_cycle(value: Animated.Value, len: number): Animated.CompositeAnimation {
  return Animated.sequence([
    Animated.timing(value, { toValue: 0, duration: DRAW_MS, easing: EASING, useNativeDriver: false }),
    Animated.delay(HOLD_MS),
    Animated.timing(value, { toValue: -len, duration: ERASE_MS, easing: EASING, useNativeDriver: false }),
  ]);
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

  // useState (no useRef().current): leer .current de un ref en el cuerpo del
  // render dispara el lint react-hooks/refs; el mismo patrón de
  // UploadProgressBar.tsx.
  const [house_offset] = useState(() => new Animated.Value(HOUSE_LEN));
  const [door_offset] = useState(() => new Animated.Value(DOOR_LEN));

  useEffect(() => {
    house_offset.setValue(HOUSE_LEN);
    const house_loop = Animated.loop(draw_cycle(house_offset, HOUSE_LEN));
    house_loop.start();

    door_offset.setValue(DOOR_LEN);
    const door_delay = Animated.sequence([
      Animated.delay(DOOR_LAG_MS),
      Animated.loop(draw_cycle(door_offset, DOOR_LEN)),
    ]);
    door_delay.start();

    return () => {
      house_loop.stop();
      door_delay.stop();
    };
  }, [house_offset, door_offset]);

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
          strokeDashoffset={house_offset}
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
            strokeDashoffset={door_offset}
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
