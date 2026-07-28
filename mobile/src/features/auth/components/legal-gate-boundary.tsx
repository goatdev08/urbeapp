/**
 * LegalGateBoundary — envoltura que impide renderizar contenido autenticado mientras
 * el usuario tenga documentos legales vigentes sin aceptar (#72.6, PRD §5.5).
 *
 * ⚠️ POR QUÉ ES UN COMPONENTE Y NO CÓDIGO DENTRO DE ProtectedLayout:
 * el gate vivía solo en `ProtectedLayout`, que envuelve el grupo `(protected)`. Pero
 * NO todo el contenido autenticado vive ahí — la auditoría del guardián de 72.6
 * encontró dos caminos que lo esquivaban:
 *   · `app/admin/_layout.tsx` → el panel de administración, o sea el rol con MÁS poder,
 *     alcanzable por deep link (`urbea://admin`, scheme registrado en app.json).
 *   · `app/onboarding.tsx` → donde el agente invitado captura datos personales y foto
 *     de perfil, ANTES de haber aceptado el Aviso de Privacidad.
 * Tener el gate en un solo layout y creerlo inevitable era el error. Ahora hay un solo
 * gate y tres consumidores.
 *
 * Orden dentro de cada layout: primero el gate de auth (la RPC necesita `auth.uid()`),
 * después este.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '@/features/auth/context';
import { useLegalGate } from '@/features/auth/hooks/useLegalGate';
import { LegalWall } from '@/features/auth/components/legal-wall';

export function LegalGateBoundary({ children }: { children: React.ReactNode }): React.ReactElement {
  const { signOut } = useAuth();
  const legal = useLegalGate();

  // Mientras el gate carga se muestra el indicador, NO el contenido: dejar pasar
  // "mientras carga" abriría exactamente la ventana que el gate existe para cerrar.
  if (legal.is_loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator testID="legal-gate-loading" size="large" />
      </View>
    );
  }

  // DECISIÓN — qué hacer si la RPC falla (típicamente: sin red).
  //   · Dejar pasar = abre la ventana que el gate debe cerrar, y de forma trivial de
  //     provocar (basta modo avión).
  //   · Bloquear sin salida = un fallo transitorio deja la app inservible.
  // Se FALLA CERRADO PERO CON REINTENTO: no se entra sin verificar, y el usuario nunca
  // queda atrapado. Se ofrece también cerrar sesión, para el caso en que el fallo NO sea
  // transitorio (p. ej. un grant revocado) y reintentar no vaya a servir nunca —
  // sin esa salida, la cuenta quedaría inutilizable sin poder siquiera cambiar de cuenta.
  if (legal.error !== null && legal.pending.length === 0) {
    return (
      <View style={styles.container}>
        <Text testID="legal-gate-error" style={styles.error_text}>
          No pudimos verificar tus términos y condiciones. Revisa tu conexión.
        </Text>
        <Pressable
          testID="legal-gate-retry"
          onPress={legal.refresh}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.action_text}>Reintentar</Text>
        </Pressable>
        <Pressable
          testID="legal-gate-signout"
          onPress={() => void signOut()}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.muted_text}>Cerrar sesión</Text>
        </Pressable>
      </View>
    );
  }

  // Documentos vigentes sin aceptar → muro bloqueante en lugar del contenido.
  if (legal.pending.length > 0) {
    return <LegalWall pending={legal.pending} error={legal.error} accept={legal.accept} />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  error_text: { textAlign: 'center', fontSize: 14 },
  action_text: { fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  muted_text: { fontSize: 13, opacity: 0.7, textDecorationLine: 'underline' },
});
