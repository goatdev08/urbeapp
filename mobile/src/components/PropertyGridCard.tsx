/**
 * PropertyGridCard — card de propiedad para la grilla 2-columnas del perfil.
 *
 * Spec visual: .taskmaster/docs/exploraciones/003-kit/property-grid-card-preview.html
 * Reutilizable en el feed (#9) y cualquier pantalla con grid de propiedades.
 *
 * Estructura:
 *   - Card: Pressable con sombra (outer) + View con overflow:hidden (inner/clip).
 *     Dos capas necesarias en RN para tener shadow visible + borderRadius clip.
 *   - Media: aspect-ratio 4/5. Image si hay thumbnail_url; placeholder café sólido
 *     con ícono ▷ si no (ponytail: Text porque react-native-svg no está instalado).
 *   - Badge operación (arriba-izq): Renta (primary) / Venta (accent) / Renta-Venta (accent).
 *   - Badge Pausada (junto a op-badge si status==='paused'): pill glass claro.
 *   - Overlay de atenuación cuando pausada: rgba oscuro sobre el media.
 *   - Body: título (property_type label), zona (address), precio héroe con tick Salvia.
 *
 * ponytail: sin react-native-svg; íconos como Text unicode. Sin BlurView en el
 * pause-badge (rgba 92% es suficiente para el demo). Placeholder de miniatura =
 * color sólido (sin expo-linear-gradient, que exigiría módulo nativo en el dev build).
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, shadows } from '@/theme/theme';
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
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formatea un precio numérico con separadores de miles en es-MX. */
function format_price(n: number): string {
  return `$${n.toLocaleString('es-MX')}`;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function PropertyGridCard({ item, onPress }: PropertyGridCardProps): React.JSX.Element {
  const { price, operation_type, property_type, status, address, thumbnail_url } = item;

  const is_paused    = status === 'paused';
  const is_sale      = operation_type === 'sale' || operation_type === 'both';
  const op_label     = OPERATION_LABEL[operation_type] ?? operation_type;
  const prop_label   = PROPERTY_TYPE_LABEL[property_type] ?? property_type;
  const show_per_mes = operation_type === 'rent' || operation_type === 'both';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${prop_label}, ${op_label}, ${format_price(price)}`}
      style={({ pressed }) => [
        styles.card_shadow,
        pressed && styles.card_pressed,
      ]}
    >
      {/* Inner: clips el contenido al borderRadius de la card */}
      <View style={styles.card_clip}>

        {/* ── Media ──────────────────────────────────────────────────────────── */}
        <View style={styles.media}>
          {thumbnail_url !== null ? (
            <Image
              source={{ uri: thumbnail_url }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          ) : (
            /* ponytail: placeholder café sólido (paper_2) — sin expo-linear-gradient
               para no exigir módulo nativo (el dev build no lo incluye); un tono plano
               basta como fondo de la miniatura ausente. */
            <View style={[StyleSheet.absoluteFill, styles.placeholder_gradient]}>
              {/* ponytail: ícono de video como Text '▷' — react-native-svg no instalado */}
              <Text style={styles.placeholder_icon}>▷</Text>
            </View>
          )}

          {/* Overlay de atenuación cuando la propiedad está pausada */}
          {is_paused && <View style={styles.paused_overlay} />}

          {/* ── Row de badges (arriba-izq) ─────────────────────────────────── */}
          <View style={styles.top_row}>
            {/* Badge operación */}
            <View style={[styles.op_badge, is_sale && styles.op_badge_sale]}>
              <Text style={styles.op_badge_text}>{op_label}</Text>
            </View>

            {/* Badge "Pausada" — solo si status === 'paused' */}
            {is_paused && (
              <View style={styles.pause_badge}>
                <View style={styles.pause_dot} />
                <Text style={styles.pause_badge_text}>Pausada</Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Body ───────────────────────────────────────────────────────────── */}
        <View style={styles.body}>
          {/* Título: tipo de propiedad en display font */}
          <Text style={styles.title} numberOfLines={1}>
            {prop_label}
          </Text>

          {/* Zona: address con indicador visual (dot — sin SVG) */}
          {address !== null && (
            <View style={styles.zone_row}>
              {/* ponytail: dot como View — react-native-svg no instalado; suficiente para el demo */}
              <View style={styles.zone_dot} />
              <Text style={styles.zone_text} numberOfLines={1}>
                {address}
              </Text>
            </View>
          )}

          {/* Precio héroe con tick Salvia */}
          <View style={styles.price_block}>
            <View style={styles.price_tick} />
            <View style={styles.price_row}>
              <Text style={styles.price_text}>{format_price(price)}</Text>
              {show_per_mes && (
                <Text style={styles.price_per}>/mes</Text>
              )}
            </View>
          </View>
        </View>

      </View>
    </Pressable>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Card (dos capas: shadow + clip) ─────────────────────────────────────────
  // En RN iOS, overflow:'hidden' suprime las sombras. Se separan responsabilidades:
  //   card_shadow → sombra + borderRadius + fondo blanco (sin overflow:hidden)
  //   card_clip   → overflow:hidden + mismo borderRadius (clips la miniatura y bordes)
  card_shadow: {
    flex: 1,
    borderRadius: radii.r_16,
    backgroundColor: '#FFFFFF', // ponytail: superficie base — sin token white en theme
    ...shadows.sm,
  },
  card_pressed: {
    transform: [{ scale: 0.985 }],
  },
  card_clip: {
    flex: 1,
    borderRadius: radii.r_16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.paper_3,
  },

  // ── Media ────────────────────────────────────────────────────────────────────
  media: {
    aspectRatio: 4 / 5,
    overflow: 'hidden',
  },
  placeholder_gradient: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper_2,
  },
  placeholder_icon: {
    fontSize: 34,
    color: colors.gray_2,
    opacity: 0.55,
  },
  paused_overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(30,22,12,0.18)',
  },

  // ── Badges ───────────────────────────────────────────────────────────────────
  top_row: {
    position: 'absolute',
    top: 9,
    left: 9,
    right: 9,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'flex-start',
  },
  op_badge: {
    backgroundColor: colors.primary,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.r_pill,
  },
  op_badge_sale: {
    backgroundColor: colors.accent,
  },
  op_badge_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 11,
    color: '#FFFFFF', // ponytail: texto blanco sobre badge — sin token white en theme
    letterSpacing: 0.1,
  },
  pause_badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(246,242,235,0.92)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: radii.r_pill,
    borderWidth: 1,
    borderColor: colors.silver,
  },
  pause_dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gray_2,
  },
  pause_badge_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 11,
    color: colors.ink,
  },

  // ── Body ─────────────────────────────────────────────────────────────────────
  body: {
    paddingTop: 11,
    paddingHorizontal: 12,
    paddingBottom: 13,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 14.5,
    lineHeight: 17,    // ~1.18 del spec
    letterSpacing: -0.15,
    color: colors.ink,
  },
  zone_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  zone_dot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.gray_2,
    opacity: 0.7,
    flexShrink: 0,
  },
  zone_text: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 11.5,
    color: colors.gray_2,
  },

  // ── Precio héroe ─────────────────────────────────────────────────────────────
  // Replica el ::before pseudo-element del HTML: línea de 26x3 (tick Salvia)
  // sobre el precio, con 9px de espacio desde la zona.
  price_block: {
    marginTop: 9,
  },
  price_tick: {
    width: 26,
    height: 3,
    backgroundColor: colors.primary,
    borderRadius: 3,
    marginBottom: 6,
  },
  price_row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  price_text: {
    fontFamily: fonts.display,
    fontSize: 18,
    letterSpacing: -0.18,
    color: colors.ink,
  },
  price_per: {
    fontFamily: fonts.sans_semibold,
    fontSize: 11.5,
    color: colors.gray_2,
  },
});
