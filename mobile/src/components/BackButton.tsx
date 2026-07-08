/**
 * BackButton — botón de "atrás" reutilizable (Phosphor CaretLeft).
 *
 * Para pantallas de identidad Urbea que NO usan header nativo (feed-oscuro o
 * gestión-claro con header propio). Llama router.back() por defecto — que dentro
 * del Stack de (protected) hace pop de la ruta o del grupo anidado (publish).
 *
 * - floating: se posiciona absolute arriba-izquierda respetando el notch (insets.top).
 * - onPress:  override del router.back() (p.ej. cerrar un wizard).
 *
 * Estilo gestión (claro): círculo marfil (paper_2) + tinta oscura (ink), gemelo
 * del botón "⋯" de ProfileScreen. Sobre fondos oscuros, pásale un `style` propio.
 */
import React from 'react';
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { CaretLeft } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, spacing } from '@/theme/theme';

interface BackButtonProps {
  /** Posiciona absolute arriba-izquierda con el inset del notch. */
  floating?: boolean;
  /** Override de la acción (default: router.back()). */
  onPress?: () => void;
  /** Estilo extra (p.ej. color sobre fondo oscuro). */
  style?: StyleProp<ViewStyle>;
}

export function BackButton({ floating = false, onPress, style }: BackButtonProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <Pressable
      onPress={onPress ?? (() => router.back())}
      accessibilityRole="button"
      accessibilityLabel="Volver atrás"
      hitSlop={8}
      style={[
        styles.btn,
        floating && {
          position: 'absolute',
          left: spacing.s_16,
          top: insets.top + spacing.s_8,
          zIndex: 10,
        },
        style,
      ]}
    >
      <CaretLeft size={22} color={colors.ink} weight="bold" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper_2,
  },
});
