/**
 * TemperatureRing — anillo de progreso circular por temperatura del lead.
 *
 * Preview: mobile/design-previews/267-crm-santiago.html (sección 1,
 * `.lead-ring` 46×46, `conic-gradient(color X%, --color_border 0)`). RN no
 * tiene conic-gradient — se dibuja con react-native-svg: un `Circle` de
 * fondo (color_border ≈ colors.paper_3) + un `Circle` de progreso
 * (temperature_color) con strokeDasharray/strokeDashoffset, rotado -90° para
 * arrancar arriba (igual que el conic-gradient CSS, que empieza a las 12).
 *
 * Animación: `Animated` clásico (`useNativeDriver:false`) — NUNCA Reanimated
 * sobre props de SVG. #244 (ver UrbeaLoader.tsx): `useAnimatedProps` sobre
 * `strokeDashoffset` animó bien en ambos simuladores/emuladores pero se quedó
 * clavado en el build de producción de un Android físico — combinar
 * Reanimated (JSI/worklets) con props nativas de un host component de
 * terceros es la combinación menos probada. `Animated` clásico corre en el
 * hilo de JS; para un anillo de 46 px es imperceptible.
 *
 * ponytail: sin librería de anillos de progreso — 2 <Circle> + un
 * Animated.Value es el mínimo que funciona.
 */
import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { colors } from '@/theme/theme';
import { temperature_color } from '../utils/crm_temperature_format';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const STROKE_WIDTH = 3;
const DEFAULT_SIZE = 46;
const ANIM_MS = 450;

export interface TemperatureRingProps {
  temperature: number;
  size?: number;
  children?: React.ReactNode;
}

export function TemperatureRing({
  temperature,
  size = DEFAULT_SIZE,
  children,
}: TemperatureRingProps): React.JSX.Element {
  const clamped = Math.min(100, Math.max(0, temperature));
  const center = size / 2;
  const radius = (size - STROKE_WIDTH) / 2;
  const circumference = 2 * Math.PI * radius;
  const color = temperature_color(clamped);

  // useState (no useRef().current) — mismo patrón que UrbeaLoader.tsx: leer
  // .current de un ref en el cuerpo del render dispara react-hooks/refs.
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: clamped,
      duration: ANIM_MS,
      useNativeDriver: false,
    }).start();
  }, [clamped, progress]);

  const stroke_dashoffset = progress.interpolate({
    inputRange: [0, 100],
    outputRange: [circumference, 0],
  });

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.paper_3}
          strokeWidth={STROKE_WIDTH}
          fill="none"
        />
        <AnimatedCircle
          testID="ring-progress"
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={STROKE_WIDTH}
          fill="none"
          strokeDasharray={`${circumference}, ${circumference}`}
          strokeDashoffset={stroke_dashoffset}
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      {children ? <View style={[StyleSheet.absoluteFill, styles.inner]}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inner: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
