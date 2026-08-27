/**
 * NotificationBellButton — campana con badge de no-leídas, punto de entrada
 * al centro de notificaciones (módulo 041-M2, tarea #219, subtarea 219.4).
 *
 * DECISIÓN ABRAHAM (2026-08-25, ver plan de 219.4): vive en PERFIL, botón
 * circular flotante junto al menú ⋮ de ProfileScreen — mismo patrón visual
 * 40×40 paper_2. Única superficie común a todos los roles; NO tab nueva.
 *
 * Llama useNotifications() DIRECTO (no recibe unread_count por props) para
 * que el hook — y su query — solo viva mientras este botón está montado.
 * ProfileScreen lo renderiza únicamente cuando is_own_profile=true, así que
 * nunca se dispara para un perfil ajeno.
 *
 * Badge: mismo lenguaje visual que el badge de colas del panel admin
 * (mobile/app/admin/index.tsx QueueRow — pill minWidth con paddingHorizontal
 * que crece con los dígitos, sin tope), pero SOLIDO (bg colors.primary, texto
 * on_primary) en vez de translúcido: aquí se superpone sobre el ícono, no
 * queda inline junto a texto, y necesita más contraste. Oculto en 0.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useRouter } from 'expo-router';
import { Bell } from 'phosphor-react-native';

import { colors, radii, spacing } from '@/theme/theme';
import { useNotifications } from '../hooks/useNotifications';

interface NotificationBellButtonProps {
  /** Estilo extra (posicionamiento absoluto lo decide el consumidor). */
  style?: StyleProp<ViewStyle>;
}

export function NotificationBellButton({ style }: NotificationBellButtonProps) {
  const router = useRouter();
  const { unread_count } = useNotifications();

  return (
    <Pressable
      style={[styles.btn, style]}
      onPress={() => router.push('/notifications')}
      accessibilityRole="button"
      accessibilityLabel={
        unread_count > 0
          ? `Ver notificaciones, ${unread_count} sin leer`
          : 'Ver notificaciones'
      }
      hitSlop={8}
    >
      <Bell size={22} color={colors.ink} weight="bold" />
      {unread_count > 0 && (
        <View style={styles.badge} testID="notification-bell-badge">
          <Text style={styles.badge_text}>{unread_count}</Text>
        </View>
      )}
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
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: radii.r_pill,
    paddingHorizontal: spacing.s_4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    borderWidth: 1.5,
    borderColor: colors.paper,
  },
  badge_text: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.on_primary,
  },
});
