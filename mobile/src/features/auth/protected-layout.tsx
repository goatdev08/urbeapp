/**
 * ProtectedLayout — guard de rutas autenticadas (Expo Router SDK 56).
 * Subtarea 2.5 — fase GREEN.
 *
 * Contrato:
 *   - isLoading=true                  → <UrbeaLoader testID="loading-indicator" />
 *   - isLoading=false, session=null   → <Redirect href="/login" />
 *   - isLoading=false, session=<obj>  → <Stack /> (contenido protegido)
 *
 * isLoading tiene prioridad sobre el estado de session para evitar
 * race conditions (EC-PL5): si todavía estamos validando la sesión,
 * no redirigimos ni mostramos contenido protegido prematuramente.
 *
 * El contenido protegido es un <Stack> (no <Slot>) para que las rutas
 * empujadas del grupo (property/[id], profile/[id], publish, agency,
 * my-listings, edit) sean pantallas de stack reales: habilita swipe-back
 * en iOS y el botón físico de atrás en Android en TODA la app tras login.
 * Sin esto, un <Slot> intercambia contenido sin historial navegable y la
 * navegación hacia atrás por gesto queda muerta. headerShown:false porque
 * cada pantalla trae su propio header con identidad Urbea (BackButton).
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Redirect, Stack } from 'expo-router';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { useAuth } from '@/features/auth/context';
import { LegalGateBoundary } from '@/features/auth/components/legal-gate-boundary';
import { should_redirect_to_verify_email } from '@/features/auth/deep-link-session';

export default function ProtectedLayout(): React.ReactElement {
  const { session, isLoading } = useAuth();

  // Estado de carga — isLoading tiene prioridad absoluta
  if (isLoading) {
    return (
      <View style={styles.loading_container}>
        <UrbeaLoader testID="loading-indicator" size="large" />
      </View>
    );
  }

  // Sin sesión confirmada — redirige a login
  if (session === null) {
    return <Redirect href="/login" />;
  }

  // Sesión con email todavía sin confirmar (72.3) — redirige a /verify-email,
  // que vive FUERA de este grupo protegido (hermana en app/) para no crear loop.
  if (should_redirect_to_verify_email(session)) {
    return <Redirect href="/verify-email" />;
  }

  // Sesión activa — gate legal (#72.6) y luego el contenido protegido como Stack.
  return (
    <LegalGateBoundary>
      <Stack
        screenOptions={{
          headerShown: false,
          gestureEnabled: true,
          fullScreenGestureEnabled: true,
          animation: 'slide_from_right',
        }}
      />
    </LegalGateBoundary>
  );
}

const styles = StyleSheet.create({
  loading_container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
