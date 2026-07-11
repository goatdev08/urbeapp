/**
 * ClusterMarker.tsx — marcador de clúster para el mapa global (#11.4).
 *
 * Diseño: círculo ~42px en colors.ink (tono oscuro) para diferenciarse visualmente
 * de los pines individuales de venta/renta. Borde blanco de 3px, sombra neomórfica,
 * count en blanco (Space Grotesk SemiBold) centrado.
 *
 * La paleta ink (círculo oscuro / count blanco) evita confundir clusters con
 * marcadores de alquiler (salvia) o venta (arcilla). Decisión del grilling #11.
 *
 * Performance: tracksViewChanges arranca en true y se congela a false ~300ms
 * tras el mount — mismo patrón que PropertyMarker.tsx (#64).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { colors, fonts, shadows } from '@/theme/theme';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface ClusterData {
  id: string;
  latitude: number;
  longitude: number;
  count: number;
}

interface ClusterMarkerProps {
  cluster: ClusterData;
  onPress?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

/** Delay (ms) antes de congelar tracksViewChanges a false — ver PropertyMarker.tsx (#64). */
const TRACKS_VIEW_CHANGES_FREEZE_MS = 300;

export function ClusterMarker({ cluster, onPress }: ClusterMarkerProps) {
  const handle_press = useCallback(() => {
    onPress?.();
  }, [onPress]);

  // ponytail: mismo fix #64 que PropertyMarker — arranca en true, se congela
  //   a false tras el primer paint (el count no cambia después del mount).
  const [tracks_view_changes, set_tracks_view_changes] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => set_tracks_view_changes(false), TRACKS_VIEW_CHANGES_FREEZE_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: cluster.latitude, longitude: cluster.longitude }}
      onPress={handle_press}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks_view_changes}
    >
      <TouchableOpacity onPress={handle_press} activeOpacity={0.8}>
        <View style={styles.circle}>
          <Text style={styles.count_text} numberOfLines={1}>
            {cluster.count}
          </Text>
        </View>
      </TouchableOpacity>
    </Marker>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const CIRCLE_SIZE = 42;

const styles = StyleSheet.create({
  /**
   * Círculo ink con borde blanco y sombra neomórfica suave.
   * El color oscuro (ink) lo distingue de los marcadores individuales
   * (salvia/arcilla) para que el usuario entienda de inmediato que es un grupo.
   */
  circle: {
    width: CIRCLE_SIZE,
    height: CIRCLE_SIZE,
    borderRadius: CIRCLE_SIZE / 2,
    backgroundColor: colors.ink,
    borderWidth: 3,
    borderColor: '#fff',
    justifyContent: 'center',
    alignItems: 'center',
    ...shadows.md,
  },

  count_text: {
    fontFamily: fonts.display,
    fontSize: 14,
    lineHeight: 18,
    color: '#fff',
    letterSpacing: -0.2,
  },
});
