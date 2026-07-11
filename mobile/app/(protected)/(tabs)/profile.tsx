/**
 * Tab "Perfil" — perfil propio del usuario autenticado.
 *
 * Delega el ensamblaje completo a ProfileScreen con is_own_profile=true.
 * Subtarea 16.6 — ensamblaje final.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';

import { useAuth } from '@/features/auth/context';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { colors } from '@/theme/theme';

export default function OwnProfileTab() {
  const { user } = useAuth();

  // Dentro de (protected) el guard ya garantiza sesión activa,
  // pero protegemos el render por si user llega null en el frame inicial.
  if (user === null) {
    return <View style={styles.bg} />;
  }

  return (
    <ProfileScreen
      agent_id={user.id}
      is_own_profile
      under_floating_tab_bar
    />
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: colors.paper,
  },
});
