/**
 * ProfileHeader — cabecera de perfil de agente (modo gestión, fondo claro).
 *
 * Componente UI puro: recibe AgentProfile y no hace fetching.
 * Todos los tokens de diseño vienen de theme.ts (cero hex hardcodeado aquí).
 *
 * Sembrado en subtarea #16.3 — primera pantalla con identidad visual Urbea.
 *
 * ⚠️ 179.3 — se reacomodó al patrón de Instagram (referencia: Abraham,
 * 2026-08-16): fila superior con el avatar a la izquierda y las estadísticas a
 * la derecha, y debajo el bloque de identidad alineado a la IZQUIERDA (antes
 * todo iba centrado en columna). La bio ya NO se corta: admitía hasta 280
 * caracteres (límite de profile/edit.tsx) pero se pintaba con numberOfLines=3.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { colors, fonts, radii, shadows, spacing, type_scale } from '@/theme/theme';
import { IsotipoMark } from '@/components/IsotipoMark';
import { useR2Urls } from '@/hooks/useR2Urls';
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

// 80px (antes 96): en la fila con las 3 columnas de stats un avatar mayor
// aprieta los números en pantallas de 360dp.
const AVATAR_SIZE = 80;
// Badge de isotipo (esquina inferior-derecha del avatar_ring, solo con foto real).
const ISOTIPO_BADGE_SIZE = 26;
const ISOTIPO_BADGE_OFFSET = -6;

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

interface ProfileHeaderProps {
  profile: AgentProfile;
  /** Counts del header (useAgentStats). null → columnas en "—". */
  stats?: AgentStats | null;
  /** true mientras useAgentStats resuelve los counts. */
  loading?: boolean;
  /** Elige el juego de columnas de stats (Leads solo en el perfil propio). */
  is_own_profile?: boolean;
}

export function ProfileHeader({
  profile,
  stats,
  loading = false,
  is_own_profile = false,
}: ProfileHeaderProps) {
  const { full_name, profile_photo_url, bio, member_since, agency_name } = profile;

  const [img_error, set_img_error] = useState(false);

  // profile_photo_url guarda el R2 KEY (bucket privado, subtarea 69.3) — se
  // resuelve a una URL presigned GET antes de pasarla a <Image>.
  const { urls: avatar_urls } = useR2Urls([profile_photo_url]);
  const avatar_url = avatar_urls[0] ?? null;

  const show_photo = Boolean(avatar_url) && !img_error;
  const initials = get_initials(full_name);
  const display_name = full_name ?? 'Agente Urbea';

  return (
    <View style={styles.container}>
      {/* ── Fila 1: avatar + estadísticas ───────────────────────────── */}
      <View style={styles.top_row}>
        {/* avatar_wrapper (sin overflow:hidden) para que el badge de isotipo,
            absolute en su esquina, no se recorte junto con la foto. */}
        <View style={styles.avatar_wrapper}>
          <View style={styles.avatar_ring}>
            {show_photo ? (
              <Image
                source={{ uri: avatar_url! }}
                style={styles.avatar_img}
                transition={150}
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
              <IsotipoMark size={12} color={colors.paper} />
            </View>
          )}
        </View>

        <ProfessionalStats
          stats={stats ?? null}
          loading={loading}
          is_own_profile={is_own_profile}
        />
      </View>

      {/* ── Bloque de identidad (alineado a la izquierda) ───────────── */}
      <View style={styles.identity}>
        <Text style={styles.name}>{display_name}</Text>

        {agency_name != null && (
          <View style={styles.agency_badge}>
            <Text style={styles.agency_text}>{agency_name}</Text>
          </View>
        )}

        <Text style={styles.member_since}>{format_member_since(member_since)}</Text>

        {/* Bio COMPLETA: sin numberOfLines — el alto crece con el contenido y
            respeta los saltos de línea que escribió la persona (máx. 280
            caracteres, tope de profile/edit.tsx). */}
        {bio != null && bio.trim() !== '' && <Text style={styles.bio}>{bio}</Text>}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.paper,
    paddingHorizontal: spacing.s_16,
    // El inset superior (notch/Dynamic Island) lo aplica ProfileScreen en el
    // contentContainer del ScrollView; este respiro deja libre la esquina
    // superior, donde flotan los botones "⋯" y atrás de ProfileScreen.
    paddingTop: spacing.s_40,
    paddingBottom: spacing.s_16,
  },

  // ── Fila avatar + stats ─────────────────────────────────────────────────
  top_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.s_16,
  },

  // ── Avatar ──────────────────────────────────────────────────────────────
  avatar_wrapper: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
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

  // ── Identidad (nombre, agencia, miembro desde, bio) ──────────────────────
  identity: {
    marginTop: spacing.s_16,
    alignItems: 'flex-start',
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 27,
    letterSpacing: -0.22,
    color: colors.ink,
  },

  // ── Badge agencia ────────────────────────────────────────────────────────
  agency_badge: {
    backgroundColor: colors.primary_tint,
    borderRadius: radii.r_pill,
    paddingHorizontal: spacing.s_12,
    paddingVertical: spacing.s_4,
    marginTop: spacing.s_8,
  },
  agency_text: {
    ...type_scale.caption,
    color: colors.primary_deep,
  },

  // ── Miembro desde ────────────────────────────────────────────────────────
  member_since: {
    ...type_scale.caption,
    color: colors.gray_2,
    marginTop: spacing.s_8,
  },

  // ── Bio ──────────────────────────────────────────────────────────────────
  bio: {
    ...type_scale.body,
    color: colors.gray_3,
    marginTop: spacing.s_8,
  },
});
