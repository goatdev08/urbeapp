/**
 * LikeButton.tsx — Botón de corazón con animación bounce al activarse.
 *
 * Presentacional puro: estado y toggle los maneja el padre (via useLikeProperty).
 * Animación: withSequence(timing→1.3, spring→1.0) cuando active pasa de false→true.
 * Icono: heart relleno Salvia (colors.primary) cuando active; heart-outline blanco cuando no.
 * Count: opcional, formateado (1.2k / 3.4M) debajo del icono si se pasa.
 *
 * ponytail: sin fondo propio — el consumidor provee el estilo de contenedor
 *   (glass pill en ActionButtons, sin fondo en feed overlay, etc.).
 *   Solo animamos el icono.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type LikeButtonProps = {
  /** Estado actual: true = ya liked, false = no liked. */
  active: boolean;
  /** Callback cuando el usuario presiona. La lógica de toggle la maneja el padre. */
  onPress: () => void;
  /** Recuento a mostrar al lado del icono (formateado). Omitir si no se quiere. */
  count?: number;
  /** Tamaño en px del icono (default 24). */
  size?: number;
  /** Estilo del Pressable externo (útil para proveer el contenedor glass pill). */
  style?: StyleProp<ViewStyle>;
  /**
   * Etiqueta de accesibilidad. Default: "Dar like" / "Quitar like" según active.
   * Urbea-specific por defecto; sobrescribir si se reusan en otro contexto.
   */
  accessibilityLabel?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Formatea un conteo: 1200 → "1.2k", 3_400_000 → "3.4M", 42 → "42". */
function format_count(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function LikeButton({
  active,
  onPress,
  count,
  size = 24,
  style,
  accessibilityLabel,
}: LikeButtonProps): React.JSX.Element {
  // ponytail: escala compartida — withSequence(timing→pico, spring→base)
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!active) return; // solo animamos al activar, no al desactivar
    scale.value = withSequence(
      withTiming(1.3, { duration: 120 }),
      withSpring(1.0, { damping: 8, stiffness: 200 }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const animated_style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const a11y_label = accessibilityLabel ?? (active ? 'Quitar like' : 'Dar like');
  const icon_color = active ? colors.primary : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      style={style}
      accessibilityLabel={a11y_label}
      accessibilityRole="button"
    >
      <Animated.View style={[styles.icon_wrap, animated_style]}>
        <Ionicons
          name={active ? 'heart' : 'heart-outline'}
          size={size}
          color={icon_color}
        />
      </Animated.View>
      {count !== undefined && (
        <Text style={[styles.count, { color: icon_color }]}>
          {format_count(count)}
        </Text>
      )}
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  icon_wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  count: {
    fontSize: 12,
    marginTop: 2,
    textAlign: 'center',
  },
});
