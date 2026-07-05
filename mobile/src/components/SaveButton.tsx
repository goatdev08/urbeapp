/**
 * SaveButton.tsx — Botón de bookmark con animación sutil de bounce al activarse.
 *
 * Presentacional puro: misma arquitectura que LikeButton.
 * Animación: withSequence(timing→1.15, spring→1.0) al activarse. Más sutil que
 *   LikeButton (save = acción discreta vs. like = acción expresiva).
 * Icono: bookmark relleno accent_soft (arcilla) cuando active; bookmark-outline blanco cuando no.
 *
 * ponytail: 2 callers (ActionButtons + eventual feed overlay) no justifican extraer
 *   un hook useToggleAnimation separado. Inline idéntico al LikeButton.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withSpring,
} from 'react-native-reanimated';
import { BookmarkSimple } from 'phosphor-react-native';

import { colors } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type SaveButtonProps = {
  /** Estado actual: true = ya guardado, false = no guardado. */
  active: boolean;
  /** Callback cuando el usuario presiona. La lógica de toggle la maneja el padre. */
  onPress: () => void;
  /** Tamaño en px del icono (default 22, consistente con ActionButtons). */
  size?: number;
  /** Estilo del Pressable externo (contenedor glass pill u otro). */
  style?: StyleProp<ViewStyle>;
  /**
   * Etiqueta de accesibilidad. Default: "Guardar propiedad" / "Quitar de guardados".
   * Sobrescribir si se usa en un contexto diferente al de propiedades.
   */
  accessibilityLabel?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function SaveButton({
  active,
  onPress,
  size = 22,
  style,
  accessibilityLabel,
}: SaveButtonProps): React.JSX.Element {
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!active) return;
    // ponytail: pico 1.15 (más sutil que LikeButton 1.3) — guardar es menos expresivo
    scale.value = withSequence(
      withTiming(1.15, { duration: 120 }),
      withSpring(1.0, { damping: 8, stiffness: 200 }),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const animated_style = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const a11y_label = accessibilityLabel ?? (active ? 'Quitar de guardados' : 'Guardar propiedad');
  const icon_color = active ? colors.accent_soft : '#FFFFFF';

  return (
    <Pressable
      onPress={onPress}
      style={style}
      accessibilityLabel={a11y_label}
      accessibilityRole="button"
    >
      <Animated.View style={[styles.icon_wrap, animated_style]}>
        <BookmarkSimple
          size={size}
          color={icon_color}
          weight={active ? 'fill' : 'bold'}
        />
      </Animated.View>
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
});
