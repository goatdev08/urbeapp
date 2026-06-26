/**
 * MapPicker.tsx — Mapa interactivo para fijar la ubicación exacta de la propiedad.
 *
 * Subtarea 8.5 — Implement map picker for exact location selection.
 *
 * SUPUESTO: requiere un dev build con el módulo nativo de react-native-maps enlazado.
 *   NO funciona en Expo Go. Si el módulo no está disponible en runtime, el
 *   MapErrorBoundary muestra un fallback plano en lugar de crashear el wizard.
 *   Para activar el mapa: `pnpm expo run:ios` / `pnpm expo run:android` (o EAS build).
 *
 * Invariante: lat/lng SOLO se escriben en el estado cuando el usuario toca o arrastra
 *   el marcador. Antes de interactuar, state.lat/state.lng permanecen null.
 *
 * ponytail: MapView estándar de react-native-maps — sin wrappers ni dependencias extra.
 */
import React, { Component } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

// ---------------------------------------------------------------------------
// Tokens (alineados con step2 — paleta clara/gestión)
// ---------------------------------------------------------------------------

const COLOR_BORDER = '#E5E7EB';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_HINT = '#9CA3AF';
const COLOR_MAP_FALLBACK_BG = '#F3F4F6';
const COLOR_ACCENT = '#5A8A5E'; // SALVIA

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

/** Región inicial cuando no hay coords previas: CDMX, zoom de ciudad (~5 km). */
const CDMX_REGION = {
  latitude: 19.4326,
  longitude: -99.1332,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};

/** Zoom más cerrado cuando ya hay coords seleccionadas (~1 km). */
const SELECTED_DELTA = 0.01;

// ---------------------------------------------------------------------------
// Tipo interno para el evento de coordenada (compartido por onPress y onDragEnd)
// ---------------------------------------------------------------------------

type CoordinateEvent = {
  nativeEvent: { coordinate: { latitude: number; longitude: number } };
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  /** Se invoca al tocar el mapa o al soltar el marcador. Solo aquí se actualizan coords. */
  onLocationChange: (lat: number, lng: number) => void;
}

// ---------------------------------------------------------------------------
// Error Boundary — evita que un fallo del módulo nativo crashee el wizard
// ---------------------------------------------------------------------------

interface BoundaryState {
  error: boolean;
}

class MapErrorBoundary extends Component<
  { children: React.ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: false };

  static getDerivedStateFromError(): BoundaryState {
    return { error: true };
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallback_text}>
            El mapa no está disponible en este build.{'\n'}
            Ejecuta `pnpm expo run:ios` o `pnpm expo run:android` para habilitarlo.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// MapPicker
// ---------------------------------------------------------------------------

export function MapPicker({ lat, lng, onLocationChange }: MapPickerProps) {
  const has_location = lat !== null && lng !== null;

  // Región inicial: si ya hay coords (p.ej. de una sesión previa), centrar ahí;
  // si no, mostrar CDMX. initialRegion solo aplica al primer montaje.
  const initial_region = has_location
    ? {
        latitude: lat,
        longitude: lng,
        latitudeDelta: SELECTED_DELTA,
        longitudeDelta: SELECTED_DELTA,
      }
    : CDMX_REGION;

  // Handler compartido — fijar coords cuando el usuario toca el mapa.
  const handle_coordinate = (e: CoordinateEvent) => {
    const { latitude, longitude } = e.nativeEvent.coordinate;
    onLocationChange(latitude, longitude);
  };

  return (
    <MapErrorBoundary>
      <View style={styles.container}>
        <MapView
          style={styles.map}
          initialRegion={initial_region}
          onPress={handle_coordinate}
          // ponytail: provider omitido — usa el default de la plataforma
          //   (Google Maps en Android, Apple Maps en iOS). El GOOGLE_MAPS_API_KEY
          //   ya está configurado en app.config.js para ambas plataformas.
        >
          {/* Marker aparece SOLO cuando el usuario ha interactuado — nunca con coords falsas */}
          {has_location && (
            <Marker
              coordinate={{ latitude: lat, longitude: lng }}
              draggable
              onDragEnd={handle_coordinate}
              pinColor={COLOR_ACCENT}
            />
          )}
        </MapView>

        {/* Feedback de coordenadas / hint de interacción */}
        {has_location ? (
          <Text style={styles.coords_text}>
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </Text>
        ) : (
          <Text style={styles.hint_text}>
            Toca el mapa para fijar la ubicación exacta
          </Text>
        )}
      </View>
    </MapErrorBoundary>
  );
}

// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLOR_BORDER,
  },

  map: {
    width: '100%',
    height: 240,
  },

  // Fallback cuando el módulo nativo no está disponible
  fallback: {
    height: 240,
    backgroundColor: COLOR_MAP_FALLBACK_BG,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLOR_BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  fallback_text: {
    fontSize: 13,
    color: COLOR_TEXT_SECONDARY,
    textAlign: 'center',
    lineHeight: 20,
  },

  // Texto de feedback debajo del mapa
  coords_text: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: COLOR_TEXT_SECONDARY,
    backgroundColor: '#FAFAF8',
    fontVariant: ['tabular-nums'],
  },
  hint_text: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    color: COLOR_HINT,
    backgroundColor: '#FAFAF8',
  },
});
