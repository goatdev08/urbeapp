/**
 * Ruta Stack — perfil público de un agente.
 *
 * Vive dentro de (protected) para que el acceso requiera sesión activa
 * (nota de subtarea 16.1). No colisiona con el tab /profile porque:
 *   - Tab:     (protected)/(tabs)/profile → URL /profile
 *   - Dinámica: (protected)/profile/[id]  → URL /profile/<id>
 *
 * Delega a ProfileScreen; is_own_profile = true solo si el id
 * del agente coincide con el usuario autenticado.
 *
 * Subtarea 16.6 — ensamblaje final.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';

import { useAuth } from '@/features/auth/context';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { colors } from '@/theme/theme';

export default function AgentProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  // Guard: id debe ser un string válido (Expo Router lo garantiza en runtime)
  if (!id) {
    return <View style={styles.bg} />;
  }

  const is_own_profile = user?.id === id;

  return (
    <ProfileScreen
      agent_id={id}
      is_own_profile={is_own_profile}
    />
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
