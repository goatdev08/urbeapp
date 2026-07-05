/**
 * PropertyMarker.tsx — marcador de propiedad individual para el mapa global (#11.4).
 *
 * Diseño: pin tipo gota/teardrop (cuadrado con borderTopLeft/Right/BottomLeft grandes
 * y borderBottomRight=0, rotado -45deg); dentro, el isotipo de firma (IsotipoMark)
 * contra-rotado +45deg para quedar vertical. Debajo del pin, un price tag tipo pill
 * con el precio compacto (format_compact_price).
 *
 * Color por operación:
 *   rent         → colors.primary (salvia #5A8A5E)
 *   sale | both  → colors.accent  (arcilla #9A7150)
 *
 * Performance: tracksViewChanges={false} — evita re-renders en cada frame del mapa
 * cuando hay muchos marcadores. Activar a true solo si el contenido cambia tras mount.
 *
 * IsotipoMark: isotipo vectorial (react-native-svg) desde #43.4 — paths exactos del kit.
 */

import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Marker } from 'react-native-maps';

import { colors, fonts, radii, shadows } from '@/theme/theme';
import { IsotipoMark } from '@/components/IsotipoMark';
import type { MapProperty } from '../types';
import { format_compact_price } from '../lib/formatPrice';

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

export function PropertyMarker({ property, onPress }: PropertyMarkerProps) {
  const pin_color = resolve_pin_color(property.operation_type);
  const price_label = format_compact_price(property.price);

  const handle_press = useCallback(() => {
    onPress?.(property);
  }, [onPress, property]);

  return (
    <Marker
      coordinate={{ latitude: property.lat, longitude: property.lng }}
      onPress={handle_press}
      anchor={{ x: 0.5, y: 1 }}
      // ponytail: tracksViewChanges=false — crítico para performance con muchos
      //   markers; evita que RN mida/re-renderice el contenido del marker en cada
      //   frame del mapa. Si el contenido del marker necesita actualizarse tras el
      //   primer render (e.g. highlight al seleccionar), activar a true puntualmente.
      tracksViewChanges={false}
    >
      <View style={styles.wrapper}>
        {/* ── Pin gota ─────────────────────────────────────────────────────── */}
        <View style={[styles.pin_outer, { backgroundColor: pin_color }]}>
          <TouchableOpacity
            onPress={handle_press}
            activeOpacity={0.85}
            style={styles.pin_touch}
          >
            <View style={[styles.pin_inner]}>
              {/* Isotipo de firma dentro del pin (#32). La contra-rotación +45deg
                  del pin_inner anula la rotación -45deg del pin_outer → queda vertical. */}
              <IsotipoMark size={14} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>

        {/* ── Price tag pill ───────────────────────────────────────────────── */}
        <View style={styles.price_tag}>
          <Text style={styles.price_text} numberOfLines={1}>
            {price_label}
          </Text>
        </View>
      </View>
    </Marker>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

/** Tamaño del pin teardrop (el cuadrado antes de rotar). */
const PIN_SIZE = 36;
const PIN_RADIUS = PIN_SIZE * 0.45; // ~16px — radio de las 3 esquinas redondeadas

const styles = StyleSheet.create({
  /** Contenedor total: pin + price tag apilados verticalmente. */
  wrapper: {
    alignItems: 'center',
    // El anchor={x:0.5, y:1} ancla en la punta inferior del conjunto.
  },

  /**
   * Forma teardrop: cuadrado con borderTopLeft/Right/BottomLeft grandes,
   * borderBottomRight = 0, rotado -45deg para que la punta apunte abajo-izquierda.
   * El borde blanco de 2px da el efecto neomórfico / flotante.
   *
   * En CSS sería: border-radius: 50% 50% 50% 0; transform: rotate(-45deg).
   * En RN hay que desglosar cada radio porque el shorthand no existe.
   */
  pin_outer: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderTopLeftRadius: PIN_RADIUS,
    borderTopRightRadius: PIN_RADIUS,
    borderBottomLeftRadius: PIN_RADIUS,
    borderBottomRightRadius: 0,
    transform: [{ rotate: '-45deg' }],
    borderWidth: 2,
    borderColor: '#fff',
    // Neomorphism suave: sombra del sistema de diseño + tint extra
    ...shadows.md,
    justifyContent: 'center',
    alignItems: 'center',
  },

  /** Área táctil que llena el pin para que el toque funcione bien. */
  pin_touch: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },

  /** Contenedor del ícono: contra-rota para que el play quede vertical. */
  pin_inner: {
    transform: [{ rotate: '45deg' }],
    justifyContent: 'center',
    alignItems: 'center',
  },

  /**
   * Price tag tipo pill blanco debajo del pin.
   * marginTop negativo para que quede pegado visualmente a la punta del pin.
   */
  price_tag: {
    marginTop: 4,
    backgroundColor: '#fff',
    borderRadius: radii.r_pill,
    paddingHorizontal: 6,
    paddingVertical: 2,
    ...shadows.sm,
    // minWidth para que "$15k" no quede aplastado
    minWidth: 36,
    alignItems: 'center',
  },

  price_text: {
    fontFamily: fonts.display,
    fontSize: 10,
    lineHeight: 14,
    color: colors.ink,
    letterSpacing: -0.2,
  },
});
