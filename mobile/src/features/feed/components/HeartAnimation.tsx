/**
 * HeartAnimation.tsx — Corazón animado centrado en el video (doble-tap).
 *
 * Animación: fade-in + scale-up (0.5→1.2→1.0) → hold → fade-out.
 * Total: ~800ms. Se dispara cuando `trigger` cambia de valor (int counter).
 *
 * Usa react-native-reanimated 4 (withTiming + withSequence + withDelay).
 * Ponytail: componente siempre montado (evita re-mounts por FlashList).
 *   Cada nuevo `trigger` cancela la animación anterior y reinicia.
 */

import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSequence,
  withDelay,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type HeartAnimationProps = {
  /**
   * Contador de disparos. Cada vez que cambia (y es > 0) se re-ejecuta la
   * animación. Usar un número en vez de boolean permite disparar
   * consecutivamente sin que el efecto ignore valores repetidos.
   */
  trigger: number;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de animación
// ─────────────────────────────────────────────────────────────────────────────

const FADE_IN_MS = 150;
const SCALE_HOLD_MS = 250;
const FADE_OUT_DELAY_MS = 350; // empieza el fade-out tras el hold
const FADE_OUT_MS = 400;
const EASE_OUT = Easing.out(Easing.ease);

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function HeartAnimation({ trigger }: HeartAnimationProps) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.5);

  useEffect(() => {
    if (trigger === 0) return;

    // Cancelar animación previa (asignación directa cancela withTiming en vuelo).
    opacity.value = 0;
    scale.value = 0.5;

    // Scale: 0.5 → 1.2 → 1.0 durante los primeros ~500ms.
    scale.value = withSequence(
      withTiming(1.2, { duration: FADE_IN_MS + SCALE_HOLD_MS, easing: EASE_OUT }),
      withTiming(1.0, { duration: 100, easing: EASE_OUT }),
    );

    // Opacity: fade-in rápido, hold, luego fade-out.
    opacity.value = withSequence(
      withTiming(1, { duration: FADE_IN_MS }),
      withDelay(FADE_OUT_DELAY_MS, withTiming(0, { duration: FADE_OUT_MS })),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const animated_style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={[styles.container, animated_style]} pointerEvents="none">
      <Ionicons name="heart" size={80} color="rgba(255,255,255,0.92)" />
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
});
