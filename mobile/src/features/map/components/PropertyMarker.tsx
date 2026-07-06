/**
 * PropertyMarker.tsx — marcador de propiedad individual para el mapa global (#11.4).
 *
 * Diseño (flash 2026-07-06): pin canónico MapPinIcon (Phosphor MapPin, fill) —
 * solo el icono, sin price tag ni isotipo. Mismo pin en MapPicker y PropertyMap.
 *
 * Color por operación:
 *   rent         → colors.primary (salvia #5A8A5E)
 *   sale | both  → colors.accent  (arcilla #9A7150)
 *
 * Performance: tracksViewChanges={false} — evita re-renders en cada frame del mapa
 * cuando hay muchos marcadores. Activar a true solo si el contenido cambia tras mount.
 */

import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { colors } from '@/theme/theme';
import { MapPinIcon } from '@/components/MapPinIcon';
import type { MapProperty } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface PropertyMarkerProps {
  property: MapProperty;
  onPress?: (property: MapProperty) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve el color del pin según el tipo de operación. */
function resolve_pin_color(operation_type: MapProperty['operation_type']): string {
  const is_sale = operation_type === 'sale' || operation_type === 'both';
  return is_sale ? colors.accent : colors.primary;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

/** Alto del pin — también dimensiona el área táctil del marker. */
const PIN_SIZE = 38;

export function PropertyMarker({ property, onPress }: PropertyMarkerProps) {
  const pin_color = resolve_pin_color(property.operation_type);

  const handle_press = useCallback(() => {
    onPress?.(property);
  }, [onPress, property]);

  return (
    <Marker
      coordinate={{ latitude: property.lat, longitude: property.lng }}
      onPress={handle_press}
      anchor={{ x: 0.5, y: 1 }}
      centerOffset={{ x: 0, y: -PIN_SIZE / 2 }}
      // ponytail: tracksViewChanges=false — crítico para performance con muchos
      //   markers; evita que RN mida/re-renderice el contenido del marker en cada
      //   frame del mapa. Si el contenido del marker necesita actualizarse tras el
      //   primer render (e.g. highlight al seleccionar), activar a true puntualmente.
      tracksViewChanges={false}
    >
      {/* Padding extra alrededor del icono → área táctil cómoda sin agrandar el pin */}
      <View style={styles.touch_pad}>
        <MapPinIcon color={pin_color} size={PIN_SIZE} />
      </View>
    </Marker>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  touch_pad: {
    padding: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
