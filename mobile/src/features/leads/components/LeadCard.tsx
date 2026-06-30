/**
 * LeadCard — card presentacional de un lead en la lista CRM del agente.
 *
 * Layout horizontal:
 *   [Avatar 44px] · [Info flex:1 — nombre, dirección origen, badge + tiempo] · [Thumbnail 56px]
 *
 * Paleta: gestión clara (paper/white). Sin lógica de fetching — puramente presentacional.
 *
 * ponytail: tiempo relativo inline (sin dependencia nueva); íconos Text unicode;
 *   placeholder de thumbnail = View paper_2 (sin expo-linear-gradient).
 */

import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import { get_status_meta } from '../lead_status_meta';
import type { AgentLead } from '../types';

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

/**
 * Tiempo relativo desde una fecha ISO hasta ahora ("hace 2 h", "hace 3 d", etc.).
 * ponytail: función inline — sin dependencia nueva (no hay util de fechas en el repo).
 * Techo conocido: granularidad en minutos/horas/días/meses (demo suficiente).
 */
function format_relative_time(iso_string: string): string {
  const diff_ms = Date.now() - new Date(iso_string).getTime();
  // Protección ante relojes desincronizados (diff negativo)
  if (diff_ms < 0) return 'ahora';
  const minutes = Math.floor(diff_ms / 60_000);
  if (minutes < 1)  return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)   return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30)    return `hace ${days} d`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months > 1 ? 'es' : ''}`;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LeadCardProps {
  lead: AgentLead;
  onPress: (lead: AgentLead) => void;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export function LeadCard({ lead, onPress }: LeadCardProps): React.JSX.Element {
  const {
    full_name,
    profile_photo_url,
    status,
    origin_property_address,
    origin_property_thumbnail_url,
    updated_at,
  } = lead;

  const badge        = get_status_meta(status);
  const display_name = full_name ?? 'Usuario sin nombre';
  const time_label   = format_relative_time(updated_at);

  return (
    <Pressable
      onPress={() => onPress(lead)}
      accessibilityRole="button"
      accessibilityLabel={`Lead: ${display_name}, ${badge.label}`}
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
            resizeMode="cover"
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

      </View>

      {/* ── Thumbnail de propiedad de origen ─────────────────────────────── */}
      <View style={styles.thumb}>
        {origin_property_thumbnail_url !== null ? (
          <Image
            source={{ uri: origin_property_thumbnail_url }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
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
}

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
