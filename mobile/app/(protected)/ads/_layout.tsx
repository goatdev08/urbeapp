/**
 * Layout del grupo `ads/` — gate de CAPACIDAD por RUTA (subtarea 169.8).
 *
 * 🔴 Sin `can_advertise` la RUTA NO EXISTE — no basta ocultar un botón,
 * porque un deep link (`urbea://ads/...`) la alcanzaría igual. Mismo patrón
 * que mobile/src/features/admin/admin-layout.tsx y
 * mobile/app/(protected)/agency/invitations.tsx (useAgencyRole().isOwner +
 * Redirect), aplicado aquí sobre useCanAdvertise().
 *
 * Contrato:
 *   - loading=true  → indicador de carga; el Slot NUNCA se monta (evita que
 *     un frame optimista deje pasar contenido antes de resolver la
 *     capacidad — useCanAdvertise ya garantiza can_advertise=false mientras
 *     loading=true, pero el gate tampoco debe decidir sobre ese valor).
 *   - loading=false, can_advertise=false → <Redirect> fuera de ads/.
 *   - loading=false, can_advertise=true  → <Slot /> (las pantallas del
 *     wizard, 169.9, aún no existen — esta subtarea es solo el gate).
 */
import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Redirect, Slot } from 'expo-router';

import { useCanAdvertise } from '@/features/ads/hooks/useCanAdvertise';
import { colors } from '@/theme/theme';

export default function AdsLayout(): React.ReactElement {
  const { can_advertise, loading } = useCanAdvertise();

  if (loading) {
    return (
      <View style={styles.center} testID="ads-gate-loading">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!can_advertise) {
    return <Redirect href="/(protected)/(tabs)/profile" />;
  }

  return <Slot />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper,
  },
});
