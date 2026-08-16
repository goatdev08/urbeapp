/**
 * PropertyGridCard — tile de propiedad para la grilla 3-columnas del perfil.
 *
 * Spec visual: mockup 10 "Perfil" de urbea-identidad-visual.html (.gcell,
 * L446-461): tile de portada 3/4 a sangre, precio abajo-izquierda en blanco
 * sobre la imagen. Referencia de composición: perfil de Instagram (Abraham,
 * 2026-08-16) — grilla borde a borde, sin radios ni separación visible.
 *
 * ⚠️ 179.2 — antes era una CARD 2-columnas (media 4/5 + body con título, zona
 * y precio héroe con tick Salvia). En 3 columnas la celda mide ~115-135 px y
 * ese body no cabe: se sustituye por el tile. Lo que sobrevive del diseño
 * anterior es lo que sí se lee a ese tamaño: badge de operación y precio.
 *
 * Estructura:
 *   - Pressable con overflow:hidden. El ANCHO lo fija el padre (`width`), no
 *     flex:1: con `columnWrapperStyle` + gap, un flex:1 estira las celdas de
 *     la última fila parcial (1 sola propiedad = tile de ancho completo).
 *   - Media: aspect-ratio 3/4. Image si hay portada; placeholder café sólido
 *     con el isotipo de firma (IsotipoMark) tenue si no (#32).
 *   - Badge operación (arriba-izq): Renta (primary) / Venta (accent).
 *   - Badge Pausada (junto al de operación si status==='paused') + overlay.
 *   - Precio (abajo-izq): blanco con textShadow — sin degradado, que exigiría
 *     expo-linear-gradient (módulo nativo ausente del dev build).
 *
 * Reutilizado por: PropertiesGrid (perfil) y SavedGridItem (guardados).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
// expo-image: cache en disco + fade-in — sin re-descarga al scrollear ni "pop"
// al llegar la miniatura (pulido flash 2026-07-06).
import { Image } from 'expo-image';

import { format_price } from '@/lib/formatPrice';
import { colors, fonts } from '@/theme/theme';
import { IsotipoMark } from '@/components/IsotipoMark';
import type { GridProperty } from '@/features/profile/types';

// ─── Mapas de labels ──────────────────────────────────────────────────────────

/** Traduce los valores del enum property_type a etiquetas en español. */
const PROPERTY_TYPE_LABEL: Record<string, string> = {
  casa:         'Casa',
  departamento: 'Departamento',
  local:        'Local',
  oficina:      'Oficina',
  terreno:      'Terreno',
};

/** Traduce el enum operation_type a la etiqueta del badge. */
const OPERATION_LABEL: Record<string, string> = {
  rent: 'Renta',
  sale: 'Venta',
  // ponytail: 'both' simplificado — se muestra con color accent (venta)
  both: 'Renta/Venta',
};

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PropertyGridCardProps {
  item: GridProperty;
  onPress: () => void;
  /** Long-press opcional — usado en "Guardados" para quitar con confirmación. */
  onLongPress?: () => void;
  /**
   * Ancho exacto del tile en px, calculado por la grilla desde el ancho de
   * pantalla. Sin él el tile no ocuparía espacio (no hay flex:1 a propósito).
   */
  width: number;
}

// ─── Componente ───────────────────────────────────────────────────────────────

// React.memo: en grillas con RefreshControl/quitado optimista, cada setState del
// padre re-renderizaba todas las celdas; con memo solo re-renderiza la que cambia.
export const PropertyGridCard = React.memo(function PropertyGridCard({ item, onPress, onLongPress, width }: PropertyGridCardProps): React.JSX.Element {
  const { price, currency, operation_type, property_type, status, thumbnail_url, posterUrl } = item;

  const is_paused    = status === 'paused';
  const is_sale      = operation_type === 'sale' || operation_type === 'both';
  const op_label     = OPERATION_LABEL[operation_type] ?? operation_type;
  const prop_label   = PROPERTY_TYPE_LABEL[property_type] ?? property_type;
  const show_per_mes = operation_type === 'rent' || operation_type === 'both';
  /** Portada: URL firmada de Stream si está disponible, si no el thumbnail legacy. */
  const cover_uri    = posterUrl ?? thumbnail_url;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${prop_label}, ${op_label}, ${format_price(price, currency)}`}
      style={({ pressed }) => [
        styles.tile,
        { width },
        pressed && styles.tile_pressed,
      ]}
    >
      {cover_uri !== null ? (
        <Image
          source={{ uri: cover_uri }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
        />
      ) : (
        /* ponytail: placeholder café sólido (paper_2) — sin expo-linear-gradient
           para no exigir módulo nativo (el dev build no lo incluye); un tono plano
           basta como fondo de la miniatura ausente. */
        <View style={[StyleSheet.absoluteFill, styles.placeholder]}>
          {/* Isotipo de firma como placeholder de miniatura ausente (#32). */}
          <IsotipoMark size={26} color={colors.gray_2} />
        </View>
      )}

      {/* Overlay de atenuación cuando la propiedad está pausada */}
      {is_paused && <View style={styles.paused_overlay} />}

      {/* ── Row de badges (arriba-izq) ───────────────────────────────────── */}
      <View style={styles.top_row}>
        <View style={[styles.op_badge, is_sale && styles.op_badge_sale]}>
          <Text style={styles.op_badge_text}>{op_label}</Text>
        </View>

        {is_paused && (
          <View style={styles.pause_badge}>
            <Text style={styles.pause_badge_text}>Pausada</Text>
          </View>
        )}
      </View>

      {/* ── Precio (abajo-izq, sobre la portada) ─────────────────────────── */}
      <Text
        style={styles.price_text}
        numberOfLines={1}
        // Precios largos ("$19,490,000 MXN") en ~115px: encoge en vez de cortar.
        adjustsFontSizeToFit
        minimumFontScale={0.75}
      >
        {format_price(price, currency)}
        {show_per_mes ? <Text style={styles.price_per}>/mes</Text> : null}
      </Text>
    </Pressable>
  );
});

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Tile ─────────────────────────────────────────────────────────────────────
  // Sin sombra ni borderRadius: la grilla es borde a borde (Instagram) y la
  // separación entre celdas la da el gap del columnWrapper, no un margen aquí.
  tile: {
    aspectRatio: 3 / 4,
    overflow: 'hidden',
    backgroundColor: colors.paper_2,
  },
  tile_pressed: {
    opacity: 0.82,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper_2,
    opacity: 0.55, // isotipo tenue, no intrusivo
  },
  paused_overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(30,22,12,0.28)',
  },

  // ── Badges ───────────────────────────────────────────────────────────────────
  top_row: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'flex-start',
  },
  op_badge: {
    backgroundColor: colors.primary,
    paddingVertical: 2.5,
    paddingHorizontal: 7,
    borderRadius: 999,
  },
  op_badge_sale: {
    backgroundColor: colors.accent,
  },
  op_badge_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 9.5,
    color: '#FFFFFF', // ponytail: texto blanco sobre badge — sin token white en theme
  },
  pause_badge: {
    backgroundColor: 'rgba(246,242,235,0.92)',
    paddingVertical: 2.5,
    paddingHorizontal: 7,
    borderRadius: 999,
  },
  pause_badge_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 9.5,
    color: colors.ink,
  },

  // ── Precio sobre la portada ──────────────────────────────────────────────────
  price_text: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 5,
    fontFamily: fonts.display,
    fontSize: 12.5,
    color: '#FFFFFF',
    letterSpacing: -0.1,
    // Legibilidad sobre portadas claras sin degradado (módulo nativo ausente).
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  price_per: {
    fontFamily: fonts.sans_semibold,
    fontSize: 9.5,
  },
});
