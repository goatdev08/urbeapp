/**
 * PropertyMiniCard.tsx — Mini-card flotante que aparece al tocar un pin (#11.5).
 *
 * Se posiciona de forma absoluta en la parte inferior de la pantalla (el padre
 * MapScreen la monta/desmonta condicionalmente). NO usa el Callout nativo de
 * react-native-maps para evitar el bug de onCalloutPress en Android.
 *
 * Estética LIQUID GLASS: BlurView (expo-blur) de fondo + overlay semi-translúcido
 * derivado de colors.paper para legibilidad + borde sutil + sombra neomórfica.
 *
 * ponytail: thumb es un placeholder con ícono play — la data del mapa no trae
 *   video/imagen en esta fase (#11). El isotipo real y la imagen de portada vienen
 *   cuando el modelo de mapa incluya `thumbnail_url` (trabajo futuro).
 */

import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import type { MapProperty } from '@/features/map/types';
import { format_full_price } from '@/features/map/lib/formatPrice';

// ─────────────────────────────────────────────────────────────────────────────
// Constantes locales
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Etiquetas legibles para property_type.
 * Mismo mapa que PropertyInfoHeader.tsx — ponytail: fuente única pendiente
 * cuando se centralice en un archivo de constantes del dominio propiedad.
 */
const PROPERTY_TYPE_LABEL: Record<string, string> = {
  casa:         'Casa',
  departamento: 'Departamento',
  local:        'Local',
  oficina:      'Oficina',
  terreno:      'Terreno',
};

/** Tamaño del thumbnail cuadrado placeholder. */
const THUMB_SIZE = 64;

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

interface PropertyMiniCardProps {
  property: MapProperty;
  onPress: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function PropertyMiniCard({ property, onPress }: PropertyMiniCardProps) {
  const type_label =
    PROPERTY_TYPE_LABEL[property.property_type] ?? property.property_type;
  const price_text = format_full_price(property.price);
  const has_bedrooms = property.bedrooms !== null;
  const has_bathrooms = property.bathrooms !== null;
  const show_specs = has_bedrooms || has_bathrooms;

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityRole="button"
      accessibilityLabel={`${type_label} — ${price_text}`}
    >
      {/* ── Liquid Glass: capa blur ─────────────────────────────────────────── */}
      <BlurView tint="light" intensity={35} style={StyleSheet.absoluteFill} />

      {/*
       * Overlay semi-translúcido para legibilidad del texto.
       * ponytail: rgba derivado de colors.paper (#F6F2EB) a 0.72 de opacidad.
       */}
      <View style={styles.overlay} />

      {/* ── Fila de contenido ─────────────────────────────────────────────── */}
      <View style={styles.row}>

        {/* Thumb placeholder cuadrado */}
        <View style={styles.thumb}>
          {/* ponytail: ícono play como placeholder; sin imagen real en la data del mapa. */}
          <Ionicons name="play" size={22} color={colors.primary} />
        </View>

        {/* Bloque de texto: tipo, dirección, precio, specs */}
        <View style={styles.text_block}>
          <Text style={styles.title} numberOfLines={1}>
            {type_label}
          </Text>

          <Text style={styles.address} numberOfLines={1}>
            {property.address}
          </Text>

          <Text style={styles.price} numberOfLines={1}>
            {price_text}
          </Text>

          {show_specs && (
            <View style={styles.specs_row}>
              {has_bedrooms && (
                <View style={styles.spec_item}>
                  <Ionicons name="bed-outline" size={12} color={colors.gray_2} />
                  <Text style={styles.spec_text}>{property.bedrooms}</Text>
                </View>
              )}
              {has_bathrooms && (
                <View style={styles.spec_item}>
                  <Ionicons name="water-outline" size={12} color={colors.gray_2} />
                  <Text style={styles.spec_text}>{property.bathrooms}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Chevron derecha */}
        <Ionicons name="chevron-forward" size={20} color={colors.gray_2} />
      </View>
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  /**
   * Contenedor absoluto en la parte inferior de la pantalla.
   * overflow:'hidden' permite que BlurView y el overlay queden recortados
   * por el borderRadius sin necesidad de un wrapper adicional.
   */
  container: {
    position: 'absolute',
    bottom: spacing.s_24,
    left: spacing.s_16,
    right: spacing.s_16,
    borderRadius: radii.r_16,
    overflow: 'hidden',
    borderWidth: 1,
    // ponytail: rgba derivado de colors.paper_3 (#E3DCCF) — borde sutil líquido
    borderColor: 'rgba(227, 220, 207, 0.60)',
    ...shadows.md,
  },

  /**
   * Overlay semi-translúcido encima del blur para aumentar la legibilidad.
   * ponytail: rgba derivado de colors.paper (#F6F2EB) a 0.72.
   * Posicionamiento explícito (absoluteFillObject no disponible en estos tipos RN).
   */
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(246, 242, 235, 0.72)',
  },

  /** Fila principal: thumb | texto | chevron. */
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.s_12,
    gap: spacing.s_12,
  },

  /** Thumb placeholder cuadrado. */
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: radii.r_12,
    backgroundColor: colors.paper_3,
    justifyContent: 'center',
    alignItems: 'center',
    // flexShrink:0 impide que se comprima si el texto es largo
    flexShrink: 0,
  },

  /** Bloque de texto ocupa el espacio restante. */
  text_block: {
    flex: 1,
    gap: spacing.s_4,
  },

  title: {
    fontFamily: fonts.display,
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: colors.ink,
  },

  address: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 16,
    color: colors.gray_2,
  },

  price: {
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: colors.ink,
  },

  /** Fila de specs (recámaras / baños). Solo visible si al menos uno no es null. */
  specs_row: {
    flexDirection: 'row',
    gap: spacing.s_8,
    marginTop: spacing.s_4,
  },

  spec_item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },

  spec_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    lineHeight: 16,
    color: colors.gray_2,
  },
});
