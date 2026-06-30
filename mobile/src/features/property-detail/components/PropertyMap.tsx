/**
 * PropertyMap.tsx — Mapa embebido en el detalle de propiedad.
 *
 * Muestra un MapView centrado en la ubicación de la propiedad con un Marker fijo.
 * Si `location` es null o no parseable, el componente no renderiza nada.
 *
 * ponytail: mismo patrón de import/error-boundary que MapPicker.tsx (publish/8.5).
 *   MapView height = 160px (entre 96 y 200 del alcance; cómodo sin scroll extra).
 *   Provider omitido — Google Maps en Android, Apple Maps en iOS — misma config
 *   que MapPicker (GOOGLE_MAPS_API_KEY ya en app.config.ts).
 */
import React, { Component } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { colors, radii, spacing } from '@/theme/theme';
import { parse_location } from '../utils/parseLocation';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes
// ─────────────────────────────────────────────────────────────────────────────

/** Zoom de barrio (~1 km) — mismo SELECTED_DELTA que MapPicker. */
const DELTA = 0.01;

const MAP_HEIGHT = 160;

// ─────────────────────────────────────────────────────────────────────────────
// Error Boundary — evita crash si el módulo nativo no está enlazado
// ─────────────────────────────────────────────────────────────────────────────

// ponytail: copia mínima del boundary de MapPicker — mismo patrón, no abstracción
//   compartida aún (solo dos usos; si se agrega un tercero → extraer a shared/).

interface BoundaryState { error: boolean }

class MapErrorBoundary extends Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: false };

  static getDerivedStateFromError(): BoundaryState {
    return { error: true };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallback_text}>
            Mapa no disponible en este build.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface PropertyMapProps {
  /** WKT string de PostGIS ("POINT(lng lat)") o null. Si null, no se renderiza. */
  location: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function PropertyMap({ location }: PropertyMapProps): React.JSX.Element | null {
  const coords = parse_location(location);

  // ponytail: si no hay ubicación válida, sección oculta — sin placeholder
  if (!coords) return null;

  const region = {
    latitude: coords.lat,
    longitude: coords.lng,
    latitudeDelta: DELTA,
    longitudeDelta: DELTA,
  };

  return (
    <MapErrorBoundary>
      <View style={styles.container}>
        <MapView
          style={styles.map}
          initialRegion={region}
          // ponytail: scrollEnabled + zoomEnabled implícito (default true) —
          //   el usuario puede hacer zoom/pan; no necesitamos props extra.
        >
          <Marker
            coordinate={{ latitude: coords.lat, longitude: coords.lng }}
            pinColor={colors.primary}
          />
        </MapView>
      </View>
    </MapErrorBoundary>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.r_12,
    overflow: 'hidden',
    marginTop: spacing.s_8,
  },

  map: {
    width: '100%',
    height: MAP_HEIGHT,
  },

  fallback: {
    height: MAP_HEIGHT,
    borderRadius: radii.r_12,
    backgroundColor: colors.paper_3,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.s_16,
  },
  fallback_text: {
    fontSize: 13,
    color: colors.gray_2,
    textAlign: 'center',
  },
});
