/**
 * UrbeaLockup — lockup del logo final (mark + wordmark "URBEA"), recreado de
 * `urbea-logo-final.html`. Dos composiciones:
 *   - 'row' (default): `.lock-h` — mark y URBEA en fila (word/mark = 34/64).
 *   - 'column': `.hero` — mark arriba, URBEA debajo, wordmark más pequeño
 *     relativo (word/mark = 46/140), para logos grandes sin desbordar a lo ancho.
 *
 * Reusa IsotipoMark (react-native-svg). Color por defecto = verde del logo.
 * `size` = lado del mark; todo lo demás escala con él.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { brand, fonts } from '@/theme/theme';
import { IsotipoMark } from './IsotipoMark';

interface UrbeaLockupProps {
  /** Lado del mark en px (default 64). */
  size?: number;
  /** Color de mark + wordmark (default verde del logo). */
  color?: string;
  /** 'row' = lockup horizontal (.lock-h) · 'column' = hero vertical (.hero). */
  direction?: 'row' | 'column';
}

export function UrbeaLockup({ size = 64, color = brand.green, direction = 'row' }: UrbeaLockupProps) {
  const column = direction === 'column';
  // Proporciones del archivo: hero (46/140) vs lock-h (34/64).
  const word_size = size * (column ? 46 / 140 : 34 / 64);
  const gap = size * (column ? 22 / 140 : 18 / 64);
  const tracking = 0.24 * word_size;

  return (
    <View style={{ flexDirection: direction, alignItems: 'center', gap }}>
      <IsotipoMark size={size} color={color} />
      <Text
        style={[
          styles.word,
          { color, fontSize: word_size, letterSpacing: tracking, paddingLeft: tracking },
        ]}
      >
        URBEA
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  word: {
    fontFamily: fonts.logo,
  },
});
