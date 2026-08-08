/**
 * LeadCard — card presentacional de un lead en la lista CRM del agente.
 *
 * Layout horizontal:
 *   [Avatar 44px] · [Info flex:1 — nombre, dirección origen, badge de estado +
 *   tiempo, badge de nivel + puntaje] · [Thumbnail 56px]
 *
 * Nivel/puntaje (75.6, §19.9, defecto #3 del usuario: "la clasificación por
 * actividad no se ve"): fila propia debajo del estado — un pill de color
 * (LEVEL_META, escala Salvia/Arcilla) + el número de puntos, para que se
 * lean de un vistazo sin competir por espacio con el badge de estado.
 *
 * Paleta: gestión clara (paper/white). Sin lógica de fetching — puramente presentacional.
 *
 * ponytail: íconos Text unicode; placeholder de thumbnail = View paper_2 (sin
 *   expo-linear-gradient); tiempo relativo en utils/relative_time.ts (compartido
 *   con el timeline de LeadExpandedView, 75.6).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
// expo-image: cache en disco + fade-in (pulido flash 2026-07-06).
import { Image } from 'expo-image';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import { get_level_meta, get_status_meta } from '../lead_status_meta';
import type { AgentLead } from '../types';
import { format_relative_time } from '../utils/relative_time';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Primera letra mayúscula del nombre para el avatar fallback.
 * Null-safe: devuelve '?' si full_name es null/vacío.
 */
function get_initial(full_name: string | null): string {
  if (!full_name) return '?';
  // noUncheckedIndexedAccess: full_name[0] puede ser undefined
  return (full_name[0] ?? '?').toUpperCase();
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LeadCardProps {
  lead: AgentLead;
  onPress: (lead: AgentLead) => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

// React.memo: la lista del CRM filtra client-side; sin memo cada cambio de
// filtro/búsqueda re-renderizaba todas las cards.
export const LeadCard = React.memo(function LeadCard({ lead, onPress }: LeadCardProps): React.JSX.Element {
  const {
    full_name,
    profile_photo_url,
    status,
    origin_property_address,
    origin_property_thumbnail_url,
    updated_at,
    score,
    level,
  } = lead;

  const badge        = get_status_meta(status);
  const level_badge  = get_level_meta(level);
  const display_name = full_name ?? 'Usuario sin nombre';
  const time_label   = format_relative_time(updated_at);

  return (
    <Pressable
      onPress={() => onPress(lead)}
      accessibilityRole="button"
      accessibilityLabel={`Lead: ${display_name}, ${badge.label}, ${level_badge.label}, ${score} puntos`}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.row_pressed,
      ]}
    >

      {/* ── Avatar ────────────────────────────────────────────────────────── */}
      <View style={styles.avatar}>
        {profile_photo_url !== null ? (
          <Image
            source={{ uri: profile_photo_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          /* ponytail: inicial como Text — sin avatar lib externa */
          <View style={[StyleSheet.absoluteFill, styles.avatar_placeholder]}>
            <Text style={styles.avatar_initial}>{get_initial(full_name)}</Text>
          </View>
        )}
      </View>

      {/* ── Sección info ──────────────────────────────────────────────────── */}
      <View style={styles.info}>

        {/* Nombre del buscador */}
        <Text style={styles.name} numberOfLines={1}>
          {display_name}
        </Text>

        {/* Dirección de la propiedad de origen (opcional) */}
        {origin_property_address !== null && (
          <View style={styles.address_row}>
            {/* ponytail: dot como View unicode — sin react-native-svg */}
            <View style={styles.dot} />
            <Text style={styles.address} numberOfLines={1}>
              {origin_property_address}
            </Text>
          </View>
        )}

        {/* Fila badge + separador + tiempo relativo */}
        <View style={styles.meta_row}>
          <View style={[styles.badge, { backgroundColor: badge.bg }]}>
            <Text style={[styles.badge_text, { color: badge.text }]}>
              {badge.label}
            </Text>
          </View>
          <Text style={styles.time}>{time_label}</Text>
        </View>

        {/* Fila nivel + puntaje — de un vistazo (75.6, §19.9) */}
        <View style={styles.score_row}>
          <View style={[styles.badge, { backgroundColor: level_badge.bg }]}>
            <Text style={[styles.badge_text, { color: level_badge.text }]}>
              {level_badge.label}
            </Text>
          </View>
          <Text style={styles.score_text}>{score} pts</Text>
        </View>

      </View>

      {/* ── Thumbnail de propiedad de origen ─────────────────────────────── */}
      <View style={styles.thumb}>
        {origin_property_thumbnail_url !== null ? (
          <Image
            source={{ uri: origin_property_thumbnail_url }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={200}
          />
        ) : (
          /* ponytail: placeholder paper_2 sólido — sin expo-linear-gradient */
          <View style={[StyleSheet.absoluteFill, styles.thumb_placeholder]}>
            <Text style={styles.thumb_icon}>⌂</Text>
          </View>
        )}
      </View>

    </Pressable>
  );
});

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({

  // ── Fila contenedora ───────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_12,
    backgroundColor: '#FFFFFF', // ponytail: superficie base — sin token white en theme
    borderRadius: radii.r_12,
    borderWidth: 1,
    borderColor: colors.paper_3,
    paddingVertical: spacing.s_12,
    paddingHorizontal: spacing.s_12,
    ...shadows.sm,
  },
  row_pressed: {
    transform: [{ scale: 0.985 }],
  },

  // ── Avatar circular ────────────────────────────────────────────────────────
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.r_pill, // círculo completo
    overflow: 'hidden',
    backgroundColor: colors.primary_tint,
    flexShrink: 0,
  },
  avatar_placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary_tint,
  },
  avatar_initial: {
    fontFamily: fonts.sans_bold,
    fontSize: 18,
    color: colors.primary_deep,
  },

  // ── Info central ───────────────────────────────────────────────────────────
  info: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontFamily: fonts.sans_semibold,
    fontSize: 14,
    lineHeight: 18,
    color: colors.ink,
  },

  // Dirección con dot decorativo
  address_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray_1,
    flexShrink: 0,
  },
  address: {
    flex: 1,
    fontFamily: fonts.sans,
    fontSize: 12,
    color: colors.gray_2,
    lineHeight: 15,
  },

  // Badge + tiempo
  meta_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  badge: {
    borderRadius: radii.r_pill,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  badge_text: {
    fontFamily: fonts.sans_bold,
    fontSize: 10.5,
    letterSpacing: 0.1,
  },
  time: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: colors.gray_1,
  },

  // Nivel + puntaje (75.6)
  score_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  score_text: {
    fontFamily: fonts.sans_semibold,
    fontSize: 11,
    color: colors.gray_2,
  },

  // ── Thumbnail de propiedad ─────────────────────────────────────────────────
  thumb: {
    width: 56,
    height: 56,
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
    fontSize: 20,
    color: colors.gray_1,
    opacity: 0.6,
  },

});
