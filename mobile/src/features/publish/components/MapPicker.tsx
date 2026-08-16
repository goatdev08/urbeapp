/**
 * MapPicker.tsx — Mapa interactivo para fijar la ubicación exacta de la propiedad.
 *
 * Subtarea 8.5 — Implement map picker for exact location selection.
 * Quick fix 2026-08-15 (sin tarea de Taskmaster): modo "mira central" estilo
 * Uber/Airbnb — reemplaza el tap-to-place + marcador arrastrable. El pin
 * queda FIJO al centro de la pantalla; el usuario arrastra/hace zoom al MAPA
 * (no al pin) hasta encajar el punto exacto debajo. Más preciso que un tap en
 * un mapa chico, porque el usuario puede acercar el zoom antes de soltar.
 *
 * SUPUESTO: requiere un dev build con el módulo nativo de react-native-maps enlazado.
 *   NO funciona en Expo Go. Si el módulo no está disponible en runtime, el
 *   MapErrorBoundary muestra un fallback plano en lugar de crashear el wizard.
 *   Para activar el mapa: `pnpm expo run:ios` / `pnpm expo run:android` (o EAS build).
 *
 * Invariante: lat/lng SOLO se escriben en el estado cuando el usuario arrastra
 *   o hace zoom al mapa (gesto real — `details.isGesture` de
 *   onRegionChangeComplete). Un recentrado PROGRAMÁTICO (montaje, o el efecto
 *   que sigue a state.lat/lng cambiando desde fuera — p. ej. el autocomplete
 *   de dirección) nunca escribe de vuelta al estado: sin ese guard, el mapa
 *   entraría en un loop de "recentra → dispara evento → recentra otra vez".
 *
 * ponytail: MapView estándar de react-native-maps — sin wrappers ni dependencias
 *   extra; el pin central es un <MapPinIcon> posicionado con position:absolute,
 *   no un <Marker> geo-anclado (ya no representa una coordenada del mapa, sino
 *   el centro fijo del viewport).
 */
import React, { Component, useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { type Region } from 'react-native-maps';

import { MapPinIcon } from '@/components/MapPinIcon';
import { useLocation } from '@/features/location/LocationProvider';

// ---------------------------------------------------------------------------
// Tokens (alineados con step2 — paleta clara/gestión)
// ---------------------------------------------------------------------------

const COLOR_BORDER = '#E5E7EB';
const COLOR_TEXT_SECONDARY = '#6B7280';
const COLOR_HINT = '#9CA3AF';
const COLOR_MAP_FALLBACK_BG = '#F3F4F6';

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

/** Tamaño del pin central — igual al que usaba el Marker anterior. */
const PIN_SIZE = 38;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface MapPickerProps {
  lat: number | null;
  lng: number | null;
  /** Se invoca cuando el usuario arrastra/hace zoom al mapa (gesto real). Solo aquí se actualizan coords. */
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
  const map_ref = useRef<MapView>(null);
  // Ubicación real del usuario (LocationProvider, permiso obligatorio #41) —
  // centra el arranque del mapa en su ciudad en vez de CDMX hardcodeada.
  const { coords: user_coords } = useLocation();

  // Recentra el mapa cuando las coords cambian desde fuera (p. ej. al elegir una
  // dirección del autocomplete). initialRegion solo aplica al primer montaje,
  // así que sin esto el pin quedaría fuera de vista. Este recentrado es
  // PROGRAMÁTICO — el onRegionChangeComplete que dispara NO debe rescribir el
  // estado (ver guard de isGesture abajo).
  useEffect(() => {
    if (lat === null || lng === null) return;
    map_ref.current?.animateToRegion(
      {
        latitude: lat,
        longitude: lng,
        latitudeDelta: SELECTED_DELTA,
        longitudeDelta: SELECTED_DELTA,
      },
      350,
    );
  }, [lat, lng]);

  // Región inicial: coords ya elegidas > ubicación del usuario > CDMX.
  // initialRegion solo aplica al primer montaje.
  const initial_region = has_location
    ? {
        latitude: lat,
        longitude: lng,
        latitudeDelta: SELECTED_DELTA,
        longitudeDelta: SELECTED_DELTA,
      }
    : user_coords !== null
      ? {
          latitude: user_coords.latitude,
          longitude: user_coords.longitude,
          latitudeDelta: CDMX_REGION.latitudeDelta,
          longitudeDelta: CDMX_REGION.longitudeDelta,
        }
      : CDMX_REGION;

  // Modo mira central: el pin es fijo, el mapa se mueve. Solo un gesto REAL
  // del usuario (pan/pinch, details.isGesture) escribe al estado — un
  // recentrado programático (animateToRegion de arriba, o el propio montaje)
  // también dispara este callback pero con isGesture=false.
  const handle_region_change_complete = (region: Region, details?: { isGesture?: boolean }) => {
    if (!details?.isGesture) return;
    onLocationChange(region.latitude, region.longitude);
  };

  return (
    <MapErrorBoundary>
      <View style={styles.container}>
        <MapView
          ref={map_ref}
          testID="map-picker"
          style={styles.map}
          initialRegion={initial_region}
          onRegionChangeComplete={handle_region_change_complete}
          // ponytail: provider omitido — usa el default de la plataforma
          //   (Google Maps en Android, Apple Maps en iOS). El GOOGLE_MAPS_API_KEY
          //   ya está configurado en app.config.js para ambas plataformas.
        />

        {/* Pin central fijo — no geo-anclado, siempre marca el centro del viewport. */}
        <View style={styles.center_pin} pointerEvents="none" testID="map-picker-center-pin">
          <MapPinIcon size={PIN_SIZE} />
        </View>

        {/* Feedback de coordenadas / hint de interacción */}
        {has_location ? (
          <Text style={styles.coords_text}>
            {lat.toFixed(5)}, {lng.toFixed(5)}
          </Text>
        ) : (
          <Text style={styles.hint_text}>
            Mueve el mapa para fijar la ubicación exacta
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

  // Pin fijo al centro del contenedor del mapa — la PUNTA del icono (no su
  // centro geométrico) debe caer exactamente en el centro: se desplaza medio
  // ancho a la izquierda y el alto completo hacia arriba.
  center_pin: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    marginLeft: -PIN_SIZE / 2,
    marginTop: -PIN_SIZE,
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
