/**
 * AdminLayout — guard de rutas de administración (Expo Router SDK 56).
 * Subtarea 7.1 — Create admin layout with role guard.
 *
 * Contrato:
 *   - isLoading=true                             → <UrbeaLoader testID="loading-indicator" />
 *   - isLoading=false, session=null              → <Redirect href="/login" />
 *   - isLoading=false, session≠null, role≠admin  → <Redirect href="/(protected)" />
 *   - isLoading=false, session≠null, role=admin  → <Slot /> tras el gate legal (#72.6)
 *
 * isLoading tiene prioridad absoluta (evita race conditions EC-AL2):
 * si todavía estamos validando la sesión, no redirigimos ni mostramos
 * contenido protegido prematuramente.
 *
 * user?.role usa optional chaining: si user es null (fallo de fetch de perfil
 * con sesión activa), role=undefined ≠ 'admin' → redirige a (protected).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, Slot } from 'expo-router';

import { UrbeaLoader } from '@/components/UrbeaLoader';
import { useAuth } from '@/features/auth/context';
import { LegalGateBoundary } from '@/features/auth/components/legal-gate-boundary';

export default function AdminLayout(): React.ReactElement {
  const { session, user, isLoading } = useAuth();

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

  // Sesión activa pero sin rol admin — redirige a la app normal
  if (user?.role !== 'admin') {
    return <Redirect href="/(protected)" />;
  }

  // Sesión activa + rol admin — gate legal (#72.6) y luego el panel.
  // El panel NO estaba tras el gate: era alcanzable por deep link (urbea://admin) con
  // documentos vigentes sin aceptar, y es justo el rol con más poder de la plataforma.
  return (
    <LegalGateBoundary>
      <Slot />
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
