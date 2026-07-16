/**
 * AgentCard — tarjeta de información del agente en la pantalla de detalle.
 *
 * Layout horizontal: [avatar] [nombre + agencia] [icono WhatsApp]
 *
 * Reusa el patrón de avatar con iniciales de ProfileHeader (#16.3):
 *   - profile_photo_url con fallback a iniciales (get_initials)
 *   - borde silver, placeholder primary_tint
 *
 * ponytail: get_initials duplicada intencionalmente (ProfileHeader no la exporta;
 * extraer a shared utils si aparece un 3er consumidor). Sin registro CRM — #11.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { WhatsappLogo } from 'phosphor-react-native';

import { colors, fonts, radii, shadows, spacing } from '@/theme/theme';
import { useR2Urls } from '@/hooks/useR2Urls';
import type { AgentInfo, AgencyInfo } from '../types';
import { open_whatsapp } from '../utils/whatsapp';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const AVATAR_SIZE = 56;

/** Devuelve las iniciales (máx. 2) de un nombre completo. */
function get_initials(full_name: string | null): string {
  if (!full_name) return 'U';
  const parts = full_name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

interface AgentCardProps {
  agent: AgentInfo;
  agency: AgencyInfo | null;
  address: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Componente
// ─────────────────────────────────────────────────────────────────────────────

export function AgentCard({ agent, agency, address }: AgentCardProps) {
  const [img_error, set_img_error] = useState(false);

  // agent.profile_photo_url guarda el R2 KEY (misma columna user_preferences
  // que ProfileHeader, bucket privado, subtarea 69.3) — se resuelve a una URL
  // presigned GET antes de pasarla a <Image>.
  const { urls: avatar_urls } = useR2Urls([agent.profile_photo_url]);
  const avatar_url = avatar_urls[0] ?? null;

  const show_photo = Boolean(avatar_url) && !img_error;
  const initials = get_initials(agent.full_name);
  const display_name = agent.full_name ?? 'Agente';
  const has_phone = agent.phone !== null && agent.phone.length > 0;

  function handle_whatsapp_press() {
    // ponytail: sin registro de lead CRM — llega en #11
    open_whatsapp(agent.phone, address);
  }

  return (
    <View style={styles.card}>

      {/* ── Avatar ─────────────────────────────────────────────────── */}
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

      {/* ── Info: nombre + agencia ─────────────────────────────────── */}
      <View style={styles.info}>
        <Text style={styles.agent_name} numberOfLines={1}>
          {display_name}
        </Text>
        {agency !== null && (
          <Text style={styles.agency_name} numberOfLines={1}>
            {agency.name}
          </Text>
        )}
      </View>

      {/* ── Botón WhatsApp (oculto si no hay teléfono) ─────────────── */}
      {has_phone && (
        <Pressable
          style={({ pressed }) => [
            styles.wa_button,
            pressed && styles.wa_button_pressed,
          ]}
          onPress={handle_whatsapp_press}
          accessibilityRole="button"
          accessibilityLabel={`Contactar a ${display_name} por WhatsApp`}
          hitSlop={8}
        >
          <WhatsappLogo size={28} color={colors.whatsapp} weight="bold" />
        </Pressable>
      )}

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

/** Color de WhatsApp al 10% de opacidad para el fondo del botón. */
const WA_BUTTON_BG = `${colors.whatsapp}1A`;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.paper_2,
    borderRadius: radii.r_12,
    padding: spacing.s_16,
    gap: spacing.s_12,
    ...shadows.sm,
  },

  // ── Avatar ────────────────────────────────────────────────────────────────
  avatar_ring: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.silver,
    overflow: 'hidden',
    flexShrink: 0,
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
    fontFamily: fonts.sans_semibold,
    fontSize: 18,
    color: colors.primary_deep,
  },

  // ── Info ──────────────────────────────────────────────────────────────────
  info: {
    flex: 1,
    gap: spacing.s_4,
  },
  agent_name: {
    fontFamily: fonts.sans_semibold,
    fontSize: 15,
    lineHeight: 20,
    color: colors.ink,
  },
  agency_name: {
    fontFamily: fonts.sans,
    fontSize: 13,
    lineHeight: 18,
    color: colors.gray_2,
  },

  // ── WhatsApp button ───────────────────────────────────────────────────────
  wa_button: {
    width: 44,
    height: 44,
    borderRadius: radii.r_pill,
    backgroundColor: WA_BUTTON_BG,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  wa_button_pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.94 }],
  },
});
