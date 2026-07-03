/**
 * ProfileHeader — cabecera de perfil de agente (modo gestión, fondo claro).
 *
 * Componente UI puro: recibe AgentProfile y no hace fetching.
 * Todos los tokens de diseño vienen de theme.ts (cero hex hardcodeado aquí).
 *
 * Sembrado en subtarea #16.3 — primera pantalla con identidad visual Urbea.
 */
import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { colors, radii, shadows, spacing, type_scale } from '@/theme/theme';
import { IsotipoMark } from '@/components/IsotipoMark';
import type { AgentProfile } from '../types';
import type { AgentStats } from '../hooks/useAgentStats';
import { ProfessionalStats } from './ProfessionalStats';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Devuelve las iniciales (máx. 2) de un nombre completo. */
function get_initials(full_name: string | null): string {
  if (!full_name) return 'U';
  const parts = full_name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

/** Formatea una fecha ISO a "Miembro desde {mes} {año}" en es-MX. */
function format_member_since(iso_date: string): string {
  const date = new Date(iso_date);
  const month_year = date.toLocaleDateString('es-MX', {
    month: 'long',
    year: 'numeric',
  });
  return `Miembro desde ${month_year}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de layout
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 96;
// Badge de isotipo (esquina inferior-derecha del avatar_ring, solo con foto real).
const ISOTIPO_BADGE_SIZE = 28;
const ISOTIPO_BADGE_OFFSET = -8; // ~10px hacia afuera del borde del avatar_ring

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileHeaderProps {
  profile: AgentProfile;
  /** Counts de publicaciones/leads/cerrados (useAgentStats). Omitidos → no se renderiza el sheet. */
  stats?: AgentStats | null;
  /** true mientras useAgentStats resuelve los counts. */
  loading?: boolean;
}

export function ProfileHeader({ profile, stats, loading = false }: ProfileHeaderProps) {
  const { full_name, profile_photo_url, bio, member_since, agency_name } = profile;

  const [img_error, set_img_error] = useState(false);

  const show_photo = Boolean(profile_photo_url) && !img_error;
  const initials = get_initials(full_name);
  const display_name = full_name ?? 'Agente Urbea';

  return (
    <View style={styles.container}>
      {/* ── Avatar ─────────────────────────────────────────────────── */}
      {/* avatar_wrapper (sin overflow:hidden) para que el badge de isotipo,
          absolute en su esquina, no se recorte junto con la foto. */}
      <View style={styles.avatar_wrapper}>
        <View style={styles.avatar_ring}>
          {show_photo ? (
            <Image
              source={{ uri: profile_photo_url! }}
              style={styles.avatar_img}
              onError={() => set_img_error(true)}
              accessibilityLabel={`Foto de perfil de ${display_name}`}
            />
          ) : (
            <View style={styles.avatar_placeholder}>
              <Text style={styles.avatar_initials}>{initials}</Text>
            </View>
          )}
        </View>
        {/* Badge de isotipo: solo con foto real, no en el fallback de iniciales. */}
        {show_photo && (
          <View style={styles.isotipo_badge}>
            <IsotipoMark size={13} color={colors.paper} />
          </View>
        )}
      </View>

      {/* ── Nombre ─────────────────────────────────────────────────── */}
      <Text style={styles.name} numberOfLines={2}>
        {display_name}
      </Text>

      {/* ── Badge de agencia (solo si está presente) ───────────────── */}
      {agency_name != null && (
        <View style={styles.agency_badge}>
          <Text style={styles.agency_text}>{agency_name}</Text>
        </View>
      )}

      {/* ── Miembro desde ──────────────────────────────────────────── */}
      <Text style={styles.member_since}>
        {format_member_since(member_since)}
      </Text>

      {/* ── Bio (solo si está presente) ────────────────────────────── */}
      {bio != null && (
        <Text style={styles.bio} numberOfLines={3}>
          {bio}
        </Text>
      )}

      {/* ── Estadísticas profesionales (publicaciones/leads/cerrados) ── */}
      <ProfessionalStats stats={stats ?? null} loading={loading} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.s_24,
    paddingVertical: spacing.s_32,
    alignItems: 'center',
  },

  // ── Avatar ──────────────────────────────────────────────────────────────
  avatar_wrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    marginBottom: spacing.s_16,
  },
  avatar_ring: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.silver,
    overflow: 'hidden',
  },
  isotipo_badge: {
    position: 'absolute',
    right: ISOTIPO_BADGE_OFFSET,
    bottom: ISOTIPO_BADGE_OFFSET,
    width: ISOTIPO_BADGE_SIZE,
    height: ISOTIPO_BADGE_SIZE,
    borderRadius: ISOTIPO_BADGE_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.sm,
  },
  avatar_img: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  avatar_placeholder: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.primary_tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar_initials: {
    ...type_scale.h1,
    color: colors.primary_deep,
    lineHeight: AVATAR_SIZE, // centrado vertical dentro del círculo
  },

  // ── Nombre ──────────────────────────────────────────────────────────────
  name: {
    ...type_scale.h1,
    color: colors.ink,
    textAlign: 'center',
    marginBottom: spacing.s_8,
  },

  // ── Badge agencia ────────────────────────────────────────────────────────
  agency_badge: {
    backgroundColor: colors.primary_tint,
    borderRadius: radii.r_pill,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_4,
    marginBottom: spacing.s_8,
  },
  agency_text: {
    ...type_scale.caption,
    color: colors.primary_deep,
  },

  // ── Miembro desde ────────────────────────────────────────────────────────
  member_since: {
    ...type_scale.caption,
    color: colors.gray_2,
    textAlign: 'center',
    marginBottom: spacing.s_12,
  },

  // ── Bio ──────────────────────────────────────────────────────────────────
  bio: {
    ...type_scale.body,
    color: colors.gray_3,
    textAlign: 'center',
  },
});
