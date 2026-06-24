/**
 * ProtectedLayout — guard de rutas autenticadas (Expo Router SDK 56).
 * Subtarea 2.5 — fase GREEN.
 *
 * Contrato:
 *   - isLoading=true                  → <ActivityIndicator testID="loading-indicator" />
 *   - isLoading=false, session=null   → <Redirect href="/login" />
 *   - isLoading=false, session=<obj>  → <Slot /> (contenido protegido)
 *
 * isLoading tiene prioridad sobre el estado de session para evitar
 * race conditions (EC-PL5): si todavía estamos validando la sesión,
 * no redirigimos ni mostramos contenido protegido prematuramente.
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Slot } from 'expo-router';

import { useAuth } from '@/features/auth/context';

export default function ProtectedLayout(): React.ReactElement {
  const { session, isLoading } = useAuth();

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

  // Sesión activa — renderiza el contenido protegido
  return <Slot />;
}

const styles = StyleSheet.create({
  loading_container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
