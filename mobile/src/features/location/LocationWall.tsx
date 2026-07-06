/**
 * LocationWall — muro bloqueante de pantalla completa para el permiso de ubicación (subtarea 41.4).
 *
 * Acabado FUNCIONAL con tokens de theme.ts + PrimaryButton — NO es pantalla de firma
 * ilustrada → NO dispara el gate de branding #19 (confirmado con el cliente, exploración 027).
 *
 * Dos variantes (los otros dos estados de LocationProvider):
 *   - 'permission_denied' — el usuario no concedió el permiso. Botón "Activar ubicación":
 *       si aún se puede preguntar (canAskAgain) reintenta el diálogo del SO; si no, abre Ajustes.
 *   - 'gps_off'           — permiso concedido pero el servicio de ubicación del SO está apagado.
 *       Copy distinto ("Activa la ubicación"); el botón abre directamente Ajustes (no hay API
 *       para encender el GPS del SO por código).
 *
 * UX uniforme iOS + Android, sin ramas por plataforma. Bloqueante: se renderiza en lugar del
 * contenido protegido hasta que haya ubicación real (gate en (protected)/_layout.tsx, 41.5).
 */
import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';

import { PrimaryButton } from '@/components/PrimaryButton';
import { theme } from '@/theme/theme';

import { useLocation } from './LocationProvider';
import { decide_permission_action } from './lib/permissionDecision';

export interface LocationWallProps {
  variant: 'permission_denied' | 'gps_off';
}

const COPY: Record<LocationWallProps['variant'], { title: string; body: string; button: string }> = {
  permission_denied: {
    title: 'Permiso de ubicación',
    body: 'Urbea necesita acceso a tu ubicación para mostrarte propiedades cercanas.',
    button: 'Activar ubicación',
  },
  gps_off: {
    title: 'Ubicación desactivada',
    body: 'Activa el servicio de ubicación en los ajustes de tu dispositivo para ver propiedades cercanas.',
    button: 'Ir a Ajustes',
  },
};

export function LocationWall({ variant }: LocationWallProps): React.ReactElement {
  const { request } = useLocation();
  const copy = COPY[variant];

  const handle_press = async (): Promise<void> => {
    // GPS del SO apagado → no hay API para encenderlo; dirigir a Ajustes.
    if (variant === 'gps_off') {
      await Linking.openSettings();
      return;
    }

    // Permiso negado → decidir entre reintentar el diálogo o abrir Ajustes,
    // según el permiso actual (misma lógica pura que el resto del feature).
    const permission = await Location.getForegroundPermissionsAsync();
    const action = decide_permission_action(permission);
    if (action === 'request') {
      await request();
    } else {
      await Linking.openSettings();
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.body}>{copy.body}</Text>
      <PrimaryButton label={copy.button} onPress={handle_press} surface="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.paper,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.s_20,
  },
  title: {
    ...theme.type_scale.h1,
    color: theme.colors.ink,
    marginBottom: theme.spacing.s_16,
    textAlign: 'center',
  },
  body: {
    ...theme.type_scale.body,
    color: theme.colors.gray_3,
    marginBottom: theme.spacing.s_32,
    textAlign: 'center',
  },
});
