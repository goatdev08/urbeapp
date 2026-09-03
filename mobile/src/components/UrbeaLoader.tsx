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
 * ARRANCA DIBUJADO (seguro de #244): el valor inicial del offset es 0 = trazo
 * completo visible, y el ciclo es sostiene → borra → vuelve a dibujar. Así, si
 * la animación no corriera en algún build, se ve una casa ESTÁTICA en vez de un
 * hueco — que es exactamente el síntoma que reportó el smoke en Android físico.
 * Nunca dejar el estado en reposo de un indicador en "invisible".
 *
 * Implementación: react-native-svg (ya instalado, ver IsotipoMark) + Animated
 * clásico. Dos `Animated.Value` en `Animated.loop`: sostiene (15 % del ciclo,
 * 330 ms) → borra (40 %, 880 ms) → dibuja (45 %, 990 ms) = 2200 ms. offset
 * 0↔±len (dasharray=[len,len]: offset 0 = trazo completo visible, offset ±len =
 * invisible — la fase se repite cada 2·len, así que -len y +len son el mismo
 * estado). La puerta corre el mismo ciclo con un retraso único de DOOR_LAG
 * antes de entrar a su propio loop (fase constante, sin deriva). Largos de los
 * paths calculados a mano del viewBox 48×48 (casa ≈100.5, puerta 26).
 *
 * #244.3 (smoke Android, reporte «un loader en la esquina superior izquierda
 * encima de la hora»): el contenedor NO lleva width/height fijos. Varias
 * pantallas le pasan un estilo de "llenar el contenedor"
 * (`StyleSheet.absoluteFill`, o top/left/right/bottom en 0) porque el
 * ActivityIndicator que este componente reemplazó se estiraba y CENTRABA su
 * spinner dentro. Con width/height fijos + left:0/top:0 el loader se colapsaba
 * a la esquina superior izquierda — en el feed, justo debajo del reloj. Ahora
 * el tamaño lo lleva el <Svg> y el contenedor solo centra, igual que el
 * ActivityIndicator: en flujo mide lo que el ícono, y con un estilo de llenado
 * ocupa el espacio y centra el trazo.
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

/**
 * Un ciclo sostiene→borra→dibuja para un Animated.Value que arranca en 0
 * (trazo completo). Empezar por el estado VISIBLE es el seguro: sin animación
 * se ve la casa estática, no un hueco.
 */
function draw_cycle(value: Animated.Value, len: number): Animated.CompositeAnimation {
  return Animated.sequence([
    Animated.delay(HOLD_MS),
    Animated.timing(value, { toValue: -len, duration: ERASE_MS, easing: EASING, useNativeDriver: false }),
    Animated.timing(value, { toValue: 0, duration: DRAW_MS, easing: EASING, useNativeDriver: false }),
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
  // Valor inicial 0 = trazo completo dibujado (ver "ARRANCA DIBUJADO" arriba).
  const [house_offset] = useState(() => new Animated.Value(0));
  const [door_offset] = useState(() => new Animated.Value(0));

  useEffect(() => {
    house_offset.setValue(0);
    const house_loop = Animated.loop(draw_cycle(house_offset, HOUSE_LEN));
    house_loop.start();

    door_offset.setValue(0);
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
      // Sin width/height fijos: el <Svg> lleva el tamaño y el contenedor centra
      // (#244.3). Así un estilo de llenado del padre sigue centrando el trazo.
      style={[styles.box, style]}
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
