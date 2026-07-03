/**
 * IsotipoMark — isotipo de firma de Urbea (U + play), geometría tomada del
 * symbol `#iso` en `urbea-identidad-visual.html` (viewBox 0 0 24 24).
 *
 * Reusable a futuro en: map pins, loaders/spinners, empty states, overlays
 * de "play" sobre miniaturas de video del feed.
 *
 * ponytail: v1 implementada con primitivas RN puras (Views + bordes — la
 * técnica clásica "bucket shape" para la U y "triángulo de bordes" para el
 * play). CERO assets, cero dependencias nativas, cero rebuild del dev
 * client. Se eligió así (en vez del PNG @2x/@3x + <Image tintColor>
 * planeado originalmente) porque esta máquina no tiene un convertidor
 * SVG→PNG a mano y `react-native-svg` exigiría un rebuild nativo del dev
 * build — ambos bloqueaban la subtarea sin aportar fidelidad que el uso
 * actual (badge pequeño) necesite. Techo conocido: migrar a
 * `react-native-svg` cuando ≥2 consumers requieran fidelidad vectorial
 * fina (curvas exactas en vez de aproximación por radios de borde).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/theme/theme';

interface IsotipoMarkProps {
  size?: number;
  color?: string;
}

// Proporciones derivadas del viewBox 0 0 24 24 de #iso:
//   U: dos barras verticales (stroke-width 2.1) en x=6 y x=18, de y=4.2 a
//      y=12.4, cerradas por un semicírculo de radio 6 (fondo en y=18.4).
//   Play: triángulo (10.4,9.1)-(14.7,11.6)-(10.4,14.1) → ancho 4.3, alto 5.
const U_WIDTH_RATIO = 12 / 24;
const U_HEIGHT_RATIO = 14.2 / 24; // (18.4 - 4.2) / 24
const STROKE_RATIO = 2.1 / 24;
const PLAY_WIDTH_RATIO = 4.3 / 24;
const PLAY_HEIGHT_RATIO = 5 / 24;

export function IsotipoMark({ size = 24, color = colors.primary }: IsotipoMarkProps) {
  const u_width = size * U_WIDTH_RATIO;
  const u_height = size * U_HEIGHT_RATIO;
  const stroke = size * STROKE_RATIO;
  const play_width = size * PLAY_WIDTH_RATIO;
  const play_height = size * PLAY_HEIGHT_RATIO;

  return (
    <View style={{ width: size, height: size }}>
      {/* La "U": bucket-shape vía bordes — sin borde superior; radios
          inferiores grandes (= mitad del ancho) cierran el semicírculo. */}
      <View
        style={[
          styles.u_shape,
          {
            width: u_width,
            height: u_height,
            left: (size - u_width) / 2,
            top: (size - u_height) / 2,
            borderLeftWidth: stroke,
            borderRightWidth: stroke,
            borderBottomWidth: stroke,
            borderColor: color,
            borderBottomLeftRadius: u_width / 2,
            borderBottomRightRadius: u_width / 2,
          },
        ]}
      />
      {/* El "play": triángulo vía bordes (izquierdo con color, top/bottom
          transparentes) apuntando a la derecha, centrado en el isotipo. */}
      <View
        style={[
          styles.play_triangle,
          {
            left: (size - play_width) / 2,
            top: (size - play_height) / 2,
            borderTopWidth: play_height / 2,
            borderBottomWidth: play_height / 2,
            borderLeftWidth: play_width,
            borderLeftColor: color,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  u_shape: {
    position: 'absolute',
    borderTopWidth: 0,
  },
  play_triangle: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderRightWidth: 0,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
  },
});
