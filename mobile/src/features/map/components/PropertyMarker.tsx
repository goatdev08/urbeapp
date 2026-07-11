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
 * Performance: tracksViewChanges arranca en true y se congela a false ~300ms
 * tras el mount (#64) — evita re-renders en cada frame del mapa una vez que el
 * pin ya pintó. Activar a true de nuevo solo si el contenido cambia tras mount.
 */

import React, { useCallback, useEffect, useState } from 'react';
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

/**
 * Delay (ms) antes de congelar tracksViewChanges a false (#64). Android toma
 * el snapshot nativo del marker para reemplazar su pin rojo default — si lo
 * congela antes de que el SVG (react-native-svg vía Phosphor) termine de
 * pintar, el pin rojo se queda de fondo, duplicado con el pin temático.
 */
const TRACKS_VIEW_CHANGES_FREEZE_MS = 300;

export function PropertyMarker({ property, onPress }: PropertyMarkerProps) {
  const pin_color = resolve_pin_color(property.operation_type);

  const handle_press = useCallback(() => {
    onPress?.(property);
  }, [onPress, property]);

  // ponytail: arranca en true (deja que RN tome el snapshot real del SVG ya
  //   pintado) y se congela a false una vez — mismo patrón en ClusterMarker.tsx.
  const [tracks_view_changes, set_tracks_view_changes] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => set_tracks_view_changes(false), TRACKS_VIEW_CHANGES_FREEZE_MS);
    return () => clearTimeout(id);
  }, []);

  return (
    <Marker
      coordinate={{ latitude: property.lat, longitude: property.lng }}
      onPress={handle_press}
      anchor={{ x: 0.5, y: 1 }}
      centerOffset={{ x: 0, y: -PIN_SIZE / 2 }}
      tracksViewChanges={tracks_view_changes}
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
