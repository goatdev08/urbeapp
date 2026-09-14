/**
 * FollowButton — píldora reusable «Seguir»/«Siguiendo» (tarea #78 «follow de
 * cuentas F1», subtarea 78.4).
 *
 * Envuelve useFollow (78.3): decide is_own (null, nunca en el propio perfil
 * ni en las propiedades propias del feed) y expone el toggle optimista.
 *
 * Dos variantes de superficie (mini-spec 78.4, Abraham):
 *   - 'dark'  (overlay del feed, video de fondo): borde blanco, fondo
 *     transparente; activo (is_following) → fondo blanco + texto ink.
 *   - 'light' (perfil, fondo paper): borde ink, fondo transparente; activo →
 *     fondo colors.primary (verde del logo) + texto blanco.
 *
 * ponytail: sin spinner ni animación de transición — loading solo deshabilita
 * la píldora en su estado NO-seguido (evita saltos de layout); estilo activo
 * es un simple swap de estilos, no una librería de animación.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, fonts } from '@/theme/theme';
import { useFollow } from '@/features/profile/hooks/useFollow';

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface FollowButtonProps {
  followed_user_id: string;
  variant: 'dark' | 'light';
  testID?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function FollowButton({ followed_user_id, variant, testID }: FollowButtonProps): React.JSX.Element | null {
  const { is_following, loading, is_own, toggle_follow } = useFollow({ followed_user_id });

  if (is_own) return null;

  const label = is_following ? 'Siguiendo' : 'Seguir';
  const is_dark = variant === 'dark';

  return (
    <Pressable
      testID={testID}
      onPress={() => void toggle_follow()}
      disabled={loading}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: is_following, disabled: loading }}
      style={[
        styles.pill,
        is_dark ? styles.dark : styles.light,
        is_following && (is_dark ? styles.dark_active : styles.light_active),
      ]}
    >
      <Text
        style={[
          styles.text,
          is_dark ? styles.dark_text : styles.light_text,
          is_following && (is_dark ? styles.dark_active_text : styles.light_active_text),
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  pill: {
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: fonts.sans_bold,
    fontSize: 13,
  },

  // Variante 'dark' (overlay del feed, sobre video)
  dark: {
    borderWidth: 1.5,
    borderColor: colors.on_primary,
    backgroundColor: 'transparent',
  },
  dark_text: {
    color: colors.on_primary,
  },
  dark_active: {
    backgroundColor: colors.on_primary,
    borderColor: colors.on_primary,
  },
  dark_active_text: {
    color: colors.ink,
  },

  // Variante 'light' (perfil, fondo paper)
  light: {
    borderWidth: 1.5,
    borderColor: colors.ink,
    backgroundColor: 'transparent',
  },
  light_text: {
    color: colors.ink,
  },
  light_active: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  light_active_text: {
    color: colors.on_primary,
  },
});
