/**
 * AdminLayout — guard de rutas de administración (Expo Router SDK 56).
 * Subtarea 7.1 — Create admin layout with role guard.
 *
 * Contrato:
 *   - isLoading=true                             → <ActivityIndicator testID="loading-indicator" />
 *   - isLoading=false, session=null              → <Redirect href="/login" />
 *   - isLoading=false, session≠null, role≠admin  → <Redirect href="/(protected)" />
 *   - isLoading=false, session≠null, role=admin  → <Slot />
 *
 * isLoading tiene prioridad absoluta (evita race conditions EC-AL2):
 * si todavía estamos validando la sesión, no redirigimos ni mostramos
 * contenido protegido prematuramente.
 *
 * user?.role usa optional chaining: si user es null (fallo de fetch de perfil
 * con sesión activa), role=undefined ≠ 'admin' → redirige a (protected).
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Slot } from 'expo-router';

import { useAuth } from '@/features/auth/context';

export default function AdminLayout(): React.ReactElement {
  const { session, user, isLoading } = useAuth();

  // Estado de carga — isLoading tiene prioridad absoluta
  if (isLoading) {
    return (
      <View style={styles.loading_container}>
        <ActivityIndicator testID="loading-indicator" size="large" />
      </View>
    );
  }

  // Sin sesión confirmada — redirige a login
  if (session === null) {
    return <Redirect href="/login" />;
  }

  // Sesión activa pero sin rol admin — redirige a la app normal
  if (user?.role !== 'admin') {
    return <Redirect href="/(protected)" />;
  }

  // Sesión activa + rol admin — renderiza el contenido del panel
  return <Slot />;
}

const styles = StyleSheet.create({
  loading_container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
