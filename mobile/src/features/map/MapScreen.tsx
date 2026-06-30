/**
 * MapScreen.tsx — Mapa global de propiedades (#11, pantalla canónica "6·MAPA").
 *
 * Alcance 11.1 (scaffolding): MapView a pantalla completa centrado en Guadalajara,
 * envuelto en un error boundary que muestra un fallback si el módulo nativo de
 * react-native-maps no está enlazado en el build (mismo patrón que PropertyMap /
 * MapPicker). Los pines, clustering, marcadores, mini-card y búsqueda llegan en
 * 11.2–11.7.
 *
 * ponytail: MapView estándar de react-native-maps — provider implícito (Google en
 *   Android, Apple en iOS), GOOGLE_MAPS_API_KEY ya configurado en app.config.js.
 *   Reusa el patrón de error boundary de PropertyMap.tsx (3er uso → si aparece un
 *   4º, extraer a shared/; por ahora copia mínima).
 */
import React, { Component } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView from 'react-native-maps';

import { colors, spacing } from '@/theme/theme';
import { GDL_REGION } from './constants';

// ─────────────────────────────────────────────────────────────────────────────
// Error Boundary — evita crash si el módulo nativo no está enlazado
// ─────────────────────────────────────────────────────────────────────────────

interface BoundaryState {
  error: boolean;
}

class MapErrorBoundary extends Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: false };

  static getDerivedStateFromError(): BoundaryState {
    return { error: true };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallback_text}>Mapa no disponible en este build.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function MapScreen(): React.JSX.Element {
  return (
    <MapErrorBoundary>
      <View style={styles.container}>
        <MapView style={styles.map} initialRegion={GDL_REGION} />
      </View>
    </MapErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.ink, // feed/descubrimiento = oscuro; evita flash blanco al montar
  },
  map: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  fallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s_16,
    backgroundColor: colors.paper_3,
  },
  fallback_text: {
    fontSize: 13,
    color: colors.gray_2,
    textAlign: 'center',
  },
});
