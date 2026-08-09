/**
 * PropertyListItem — fila de propiedad para la pantalla "Mis publicaciones" (pantalla 9).
 *
 * Spec visual: urbea-identidad-visual.html, pantalla 9 (div.miniprop).
 * Layout horizontal: [thumbnail 72px] · [info flex:1 — address, stats, precio] · [⋯ menú]
 *
 * Badge de status:
 *   draft           → paper_2 bg + gray_3 text     ("Borrador")
 *   active          → primary bg + blanco          ("Activa")
 *   paused          → accent_soft bg + ink          ("Pausada")  ponytail: ink da mejor contraste en demo
 *   closed          → accent_deep bg + blanco       ("Cerrada")
 *   pending_review  → primary_tint bg + primary     ("En revisión")     — #73.7 (§15.3)
 *   needs_changes   → accent_tint bg + accent       ("Cambios solicitados") — #73.7
 *   rejected        → danger bg + blanco            ("Rechazada")       — #73.7
 *   (otros status del enum extendido en #73.1: fallback genérico humanizado,
 *   ver `humanize_status` — no se agregan todos los 17 valores hasta que una
 *   subtarea los use realmente, p.ej. 73.6/73.9).
 *
 * Subrow contextual bajo el badge:
 *   active/draft                          → 4 contadores reales (view, like, save, contact)
 *   paused                                 → "Sin visibilidad en el feed"
 *   pending_review/needs_changes/rejected → texto contextual propio (#73.7)
 *   closed (y cualquier otro status)      → closed_reason traducido o "Cerrada" como fallback
 *
 * ponytail: íconos como Text unicode (react-native-svg no instalado); sin animaciones.
 * Slot 17.4: on_menu_press prop expuesto pero sin lógica aquí.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import type { MyProperty } from '@/features/profile/types';

// ─── Tipos locales ────────────────────────────────────────────────────────────

interface BadgeConfig {
  label: string;
  bg: string;
  /** Color del texto — blanco sobre fondos oscuros, ink sobre fondos claros. */
  text: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

/** Config de badge por status. Colores desde theme.ts — no hex hardcodeados. */
const STATUS_BADGE: Record<string, BadgeConfig> = {
  draft:  { label: 'Borrador', bg: colors.paper_2,     text: colors.gray_3     },
  active: { label: 'Activa',   bg: colors.primary,     text: '#FFFFFF'         },
  paused: { label: 'Pausada',  bg: colors.accent_soft, text: colors.ink        },
  closed: { label: 'Cerrada',  bg: colors.accent_deep, text: '#FFFFFF'         },
  // #73.7 (§15.3) — estados operativos nuevos (73.1) que un agente puede ver
  // realistamente en el corto plazo tras publicar. Colores distintos a los 4
  // de arriba, todos tokens de theme.ts.
  pending_review: { label: 'En revisión',         bg: colors.primary_tint, text: colors.primary },
  needs_changes:  { label: 'Cambios solicitados', bg: colors.accent_tint,  text: colors.accent  },
  rejected:       { label: 'Rechazada',           bg: colors.danger,       text: '#FFFFFF'       },
};

/**
 * Ícono del placeholder de miniatura según status.
 * ponytail: Text unicode — sin react-native-svg.
 */
const STATUS_THUMB_ICON: Record<string, string> = {
  active: '▷',
  paused: '⏸',
  closed: '✓',
  draft:  '○',
};

/** Traducción de closed_reason a es-MX. */
const CLOSED_REASON_LABEL: Record<string, string> = {
  rented:    'Rentada',
  sold:      'Vendida',
  withdrawn: 'Retirada',
  expired:   'Expirada',
};

/**
 * Texto contextual del subrow para los 3 status nuevos de #73.7 (§15.3) que
 * un agente puede ver en el corto plazo. El resto de los status nuevos del
 * enum extendido (73.1) caen en la rama `closed_label` genérica más abajo.
 */
const CONTEXTUAL_SUBROW: Record<string, string> = {
  pending_review: 'Esperando aprobación del equipo',
  needs_changes:  'Revisa los cambios solicitados',
  rejected:       'No se aprobó — puedes editarla y reenviarla',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Convierte un status crudo (snake_case) en texto legible como último
 * recurso — p.ej. "media_failed" → "Media failed". Nunca debe llegar a
 * pantalla un string con guiones bajos crudos (#73.7).
 */
function humanize_status(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * Devuelve la config de badge para el status dado.
 * Garantiza un valor no-undefined (TypeScript strict / noUncheckedIndexedAccess).
 * Fallback humanizado (#73.7) — nunca muestra el string crudo del enum.
 */
function get_badge(status: string): BadgeConfig {
  return STATUS_BADGE[status] ?? { label: humanize_status(status), bg: colors.gray_2, text: colors.ink };
}

/** Formatea precio con separadores de miles en es-MX. Reutiliza patrón de PropertyGridCard. */
function format_price(n: number): string {
  return `$${n.toLocaleString('es-MX')}`;
}

/**
 * Formatea un contador compacto: ≥1000 → "1.2k".
 * ponytail: sin librería — regex .0$ para quitar el cero decimal redundante.
 */
function format_count(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PropertyListItemProps {
  item: MyProperty;
  on_press: () => void;
  /** Slot para el menú de tres puntos — implementado en subtarea 17.4. */
  on_menu_press?: () => void;
}

// ─── Componente ──────────────────────────────────────────────────────────────

// React.memo: la lista de "Mis publicaciones" refresca y filtra en el padre;
// sin memo cada setState re-renderizaba todas las filas.
export const PropertyListItem = React.memo(function PropertyListItem({
  item,
  on_press,
  on_menu_press,
}: PropertyListItemProps): React.JSX.Element {
  const {
    address,
    price,
    operation_type,
    status,
    thumbnail_url,
    posterUrl,
    view_count,
    like_count,
    save_count,
    contact_count,
    closed_reason,
  } = item;

  /** Portada: URL firmada de Stream si está disponible, si no el thumbnail legacy. */
  const cover_uri = posterUrl ?? thumbnail_url;

  const show_per_mes = operation_type === 'rent' || operation_type === 'both';
  const is_paused    = status === 'paused';
  const badge        = get_badge(status);
  const thumb_icon   = STATUS_THUMB_ICON[status] ?? '▷';

  const show_stats   = status === 'active' || status === 'draft';
  const closed_label =
    closed_reason !== null && closed_reason !== undefined
      ? (CLOSED_REASON_LABEL[closed_reason] ?? closed_reason)
      : 'Cerrada';
  /** #73.7 — texto propio para pending_review/needs_changes/rejected; el resto
   *  de status (incluido closed) cae en `closed_label` más abajo. */
  const contextual_caption = CONTEXTUAL_SUBROW[status];

  return (
    <Pressable
      onPress={on_press}
      accessibilityRole="button"
      accessibilityLabel={`${address}, ${badge.label}, ${format_price(price)}`}
      style={({ pressed }) => [
        styles.row,
        is_paused && styles.row_paused,
        pressed && styles.row_pressed,
      ]}
    >

      {/* ── Thumbnail ────────────────────────────────────────────────────── */}
      <View style={styles.thumb}>
        {cover_uri ? (
          <Image
            source={{ uri: cover_uri }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          /* ponytail: placeholder sólido paper_2 + ícono unicode — sin módulo nativo */
          <View style={[StyleSheet.absoluteFill, styles.thumb_placeholder]}>
            <Text style={styles.thumb_icon}>{thumb_icon}</Text>
          </View>
        )}
      </View>

      {/* ── Info ─────────────────────────────────────────────────────────── */}
      <View style={styles.info}>

        {/* Fila: dirección + badge de status */}
        <View style={styles.title_row}>
          <Text style={styles.address} numberOfLines={1}>{address}</Text>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badge_text, { color: badge.text }]}>{badge.label}</Text>
          </View>
        </View>

        {/* Subrow contextual */}
        {show_stats ? (
          /* Contadores reales: view, like, save, contact */
          <View style={styles.stats_row}>
            {/* ponytail: ◎ ♥ ★ ✉ como Text unicode — sin react-native-svg */}
            <Text style={styles.stat}>◎ {format_count(view_count)}</Text>
            <Text style={styles.stat}>♥ {format_count(like_count)}</Text>
            <Text style={styles.stat}>★ {format_count(save_count)}</Text>
            <Text style={styles.stat}>✉ {format_count(contact_count)}</Text>
          </View>
        ) : status === 'paused' ? (
          <Text style={styles.sub_caption} numberOfLines={1}>
            Sin visibilidad en el feed
          </Text>
        ) : contextual_caption ? (
          /* pending_review / needs_changes / rejected (#73.7) */
          <Text style={styles.sub_caption} numberOfLines={1}>
            {contextual_caption}
          </Text>
        ) : (
          /* closed (y demás status del enum extendido sin texto propio aún) */
          <Text style={styles.sub_caption} numberOfLines={1}>
            {closed_label}
          </Text>
        )}

        {/* Precio */}
        <View style={styles.price_row}>
          <Text style={styles.price}>{format_price(price)}</Text>
          {show_per_mes && <Text style={styles.price_per}>/mes</Text>}
        </View>

      </View>

      {/* ── Menú ⋯ (slot 17.4) ───────────────────────────────────────────── */}
      <Pressable
        onPress={on_menu_press}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Más opciones"
        style={styles.menu_btn}
      >
        {/* ponytail: ⋯ unicode — sin react-native-svg */}
        <Text style={styles.menu_icon}>⋯</Text>
      </Pressable>

    </Pressable>
  );
});

// ─── Estilos ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── Fila contenedora ───────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    backgroundColor: '#FFFFFF', // ponytail: superficie blanca — sin token white en theme
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    paddingVertical: spacing.s_12,
    paddingLeft: spacing.s_12,
    paddingRight: spacing.s_8,
    ...shadows.sm,
  },
  row_paused: {
    opacity: 0.75, // coincide con mockup (.72 redondeado al cuarto)
  },
  row_pressed: {
    transform: [{ scale: 0.985 }],
  },

  // ── Thumbnail ──────────────────────────────────────────────────────────────
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radii.r_8,
    overflow: 'hidden',
    backgroundColor: colors.paper_2,
    flexShrink: 0,
  },
  thumb_placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.paper_2,
  },
  thumb_icon: {
    fontSize: 22,
    color: colors.gray_2,
    opacity: 0.55,
  },

  // ── Info ────────────────────────────────────────────────────────────────────
  info: {
    flex: 1,
    gap: 3,
  },

  // Fila dirección + badge
  title_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  address: {
    flex: 1,
    fontFamily: fonts.sans_semibold,
    fontSize: 13.5,
    color: colors.ink,
    lineHeight: 17,
  },
  badge: {
    borderRadius: radii.r_pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
    flexShrink: 0,
  },
  badge_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 10.5,
    letterSpacing: 0.1,
  },

  // Stats (contadores activos)
  stats_row: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 1,
  },
  stat: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_2,
  },

  // Subtítulo contextual (paused / closed)
  sub_caption: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_2,
    marginTop: 1,
  },

  // Precio
  price_row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    marginTop: 2,
  },
  price: {
    fontFamily: fonts.display,
    fontSize: 15,
    letterSpacing: -0.1,
    color: colors.ink,
  },
  price_per: {
    fontFamily: fonts.sans_semibold,
    fontSize: 11,
    color: colors.gray_2,
  },

  // ── Botón de menú ───────────────────────────────────────────────────────────
  menu_btn: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    flexShrink: 0,
  },
  menu_icon: {
    fontSize: 18,
    color: colors.gray_2,
    lineHeight: 20,
  },
});
