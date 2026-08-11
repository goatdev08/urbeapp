/**
 * PropertyOverlay.tsx — Overlay de UI sobre el video en el feed vertical.
 *
 * Composición fiel al mockup de pantalla #4 (feed) de `urbea-identidad-visual.html`:
 * - Gradiente dual (oscuro top 0→26% + oscuro bottom 52→100%) para legibilidad.
 * - feed-info (abajo-izquierda): avatar agente, dirección, precio MXN, specs.
 * - feed-rail (abajo-derecha): corazón (like) + bookmark (guardar).
 *
 * ponytail: solo modo oscuro hardcodeado (#F6F2EB / rgba blancos sobre ink_feed).
 * El dual-mode formal (theme dark) queda pendiente al final de la tarea #9.
 * #145.4: avatar con la FOTO real del agente (vista agent_public_profiles →
 * useR2Urls resuelve key R2 o passthrough de URL legacy) + nombre debajo;
 * fallback a la inicial (del nombre si existe) cuando no hay foto. El tap
 * (avatar o nombre) navega al perfil público vía onAgentPress con feedback
 * de presión (mismo scale/opacity que los botones del rail).
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  Platform,
  StyleSheet,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Bathtub, Bed, BookmarkSimple, Heart, type Icon, ShareNetwork, WhatsappLogo } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useR2Urls } from '@/hooks/useR2Urls';
import { colors, fonts, glass, spacing } from '@/theme/theme';
import type { FeedPropertyWithUrl } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Formatea precio en MXN sin decimales: $15,000 */
function format_price(price: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(price);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────────────────────

export type PropertyOverlayProps = {
  property: FeedPropertyWithUrl;
  isLiked: boolean;
  isSaved: boolean;
  onLike: () => void;
  onSave: () => void;
  onAgentPress: () => void;
  /** Tap sobre el bloque de info (dirección/precio) → abre el detalle. */
  onPropertyPress: () => void;
  /** Contacto WhatsApp directo desde el feed. null si el agente no tiene teléfono. */
  onWhatsApp: (() => void) | null;
  /** Compartir la propiedad como link al video. */
  onShare: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Componente principal
// ─────────────────────────────────────────────────────────────────────────────

export function PropertyOverlay({
  property,
  isLiked,
  isSaved,
  onLike,
  onSave,
  onAgentPress,
  onPropertyPress,
  onWhatsApp,
  onShare,
}: PropertyOverlayProps) {
  const insets = useSafeAreaInsets();

  // #145.4: foto real del agente. agent_photo_url es key R2 o URL legacy —
  // useR2Urls resuelve/pasa según corresponda (fail-soft → null → inicial).
  const { urls: avatar_urls } = useR2Urls([property.agent_photo_url]);
  const avatar_url = avatar_urls[0] ?? null;
  const [avatar_error, set_avatar_error] = useState(false);
  const show_photo = Boolean(avatar_url) && !avatar_error;

  // Fallback: inicial del nombre público; sin nombre, la del owner_user_id
  // (comportamiento previo a #145).
  const agent_initial = (property.agent_name ?? property.owner_user_id).charAt(0).toUpperCase();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">

      {/* Gradiente dual — oscurece top (status bar) y bottom (info).
          Valores del CSS del mockup: rgba(23,20,15,.35) 0%, transparent 26% 52%,
          rgba(23,20,15,.86) 100%. Hardcodeado con ink_feed porque el feed es
          siempre oscuro (ponytail: dual-mode formal diferido a #9). */}
      <LinearGradient
        colors={[
          'rgba(23,20,15,0.35)',
          'transparent',
          'transparent',
          'rgba(23,20,15,0.86)',
        ]}
        locations={[0, 0.26, 0.52, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      {/* Rail derecho — like y guardar (estilo TikTok) */}
      <View
        style={[styles.rail, { bottom: insets.bottom + RAIL_BOTTOM }]}
        pointerEvents="box-none"
      >
        <ActionButton
          icon={Heart}
          active={isLiked}
          onPress={onLike}
          accessibilityLabel={isLiked ? 'Quitar like' : 'Dar like'}
        />
        <ActionButton
          icon={BookmarkSimple}
          active={isSaved}
          onPress={onSave}
          accessibilityLabel={isSaved ? 'Quitar de guardados' : 'Guardar propiedad'}
        />

        {/* WhatsApp directo — visible solo si el agente tiene teléfono.
            Verde de marca WhatsApp para reconocimiento inmediato. */}
        {onWhatsApp && (
          <Pressable
            onPress={onWhatsApp}
            style={({ pressed }) => [styles.whatsapp_btn, pressed && styles.btn_pressed]}
            accessibilityRole="button"
            accessibilityLabel="Contactar por WhatsApp"
          >
            <WhatsappLogo size={24} color="#FFFFFF" weight="fill" />
          </Pressable>
        )}

        {/* Compartir — link al video, glass neutro como like/guardar. */}
        <ActionButton
          icon={ShareNetwork}
          active={false}
          onPress={onShare}
          accessibilityLabel="Compartir propiedad"
        />
      </View>

      {/* Info inferior izquierda — avatar, dirección, precio, specs */}
      <View
        style={[styles.info, { bottom: insets.bottom + INFO_BOTTOM }]}
        pointerEvents="box-none"
      >
        {/* Avatar + nombre del agente (#145.4) — foto real con fallback a
            inicial; feedback de presión y tap → perfil público del agente. */}
        <Pressable
          onPress={onAgentPress}
          style={({ pressed }) => [styles.agent_row, pressed && styles.agent_row_pressed]}
          accessibilityRole="button"
          accessibilityLabel={
            property.agent_name
              ? `Ver perfil de ${property.agent_name}`
              : 'Ver perfil del agente'
          }
        >
          <View style={styles.agent_avatar}>
            {show_photo ? (
              <Image
                source={{ uri: avatar_url! }}
                style={styles.agent_photo}
                contentFit="cover"
                onError={() => set_avatar_error(true)}
              />
            ) : (
              <Text style={styles.agent_initial} numberOfLines={1}>
                {agent_initial}
              </Text>
            )}
          </View>
          {property.agent_name && (
            <Text style={styles.agent_name} numberOfLines={1}>
              {property.agent_name}
            </Text>
          )}
        </Pressable>

        {/* Bloque de info tappable → abre el detalle (/property/[id]).
            Separado del avatar (onAgentPress) y del doble-tap del video (like). */}
        <Pressable
          onPress={onPropertyPress}
          accessibilityRole="button"
          accessibilityLabel="Ver detalle de la propiedad"
        >
          {/* Dirección (título en el feed) */}
          <Text style={styles.address} numberOfLines={2}>
            {property.address}
          </Text>

          {/* Precio en MXN */}
          <Text style={styles.price} numberOfLines={1}>
            {format_price(property.price)}
          </Text>

          {/* Specs: recámaras y baños con íconos */}
          <View style={styles.specs_row} pointerEvents="none">
            <Bed size={14} color={SPEC_COLOR} weight="bold" />
            <Text style={styles.spec_text}>{property.bedrooms}</Text>

            <View style={styles.spec_divider} />

            <Bathtub size={14} color={SPEC_COLOR} weight="bold" />
            <Text style={styles.spec_text}>{property.bathrooms}</Text>
          </View>
        </Pressable>
      </View>

    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Subcomponente ActionButton (rail)
// ─────────────────────────────────────────────────────────────────────────────

type ActionButtonProps = {
  icon: Icon;
  active: boolean;
  onPress: () => void;
  accessibilityLabel: string;
};

function ActionButton({
  icon: IconCmp,
  active,
  onPress,
  accessibilityLabel,
}: ActionButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      // Feedback táctil: encoge al presionar (fluidez percibida, flash 2026-07-06)
      style={({ pressed }) => [styles.action_btn, pressed && styles.btn_pressed]}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <IconCmp
        size={22}
        // Activo = verde claro de marca (cohesión con el acento verde del logo)
        color={active ? colors.primary_soft : '#FFFFFF'}
        weight={active ? 'fill' : 'bold'}
      />
    </Pressable>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de layout
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Offsets sobre insets.bottom para posicionar info y rail por encima de la
 * tab bar, con margen. Del mockup: info bottom:118, rail bottom:140
 * (relativos a una pantalla de ~580px de alto con tab bar de ~60px).
 * ponytail: valores hardcodeados; se ajustan cuando el feed pase a pantalla
 * completa con tab bar oculto (ver task #9 final).
 *
 * Platform-aware (#65.11, fix de ronda 5): en Android insets.bottom NO
 * incluye el alto de la GlassTabBar (pill flotante, el sistema no la conoce)
 * — se asume el viejo tab bar de 49pt + margen, igual que antes de #65.10.
 * En iOS NativeTabs es una barra nativa ANCLADA: `insets.bottom` YA incluye
 * su alto completo (confirmado en vivo: 83pt = ~49 tab bar + ~34 home
 * indicator) — sumar el mismo 80/100 duplicaba el despeje (bug reportado:
 * descripción/precio flotando con hueco grande sobre la barra). En iOS solo
 * hace falta el margen visual chico (glass.floating_content_bottom_offset_ios),
 * y RAIL_BOTTOM conserva el mismo delta (+20) que ya existía en Android para
 * que el rail siga arrancando un poco más arriba que el bloque de info.
 */
const INFO_BOTTOM = Platform.OS === 'ios' ? glass.floating_content_bottom_offset_ios : 80;
const RAIL_BOTTOM = Platform.OS === 'ios' ? glass.floating_content_bottom_offset_ios + 20 : 100;

/** Color de texto de specs — blanco cálido semitransparente. Hardcodeado porque
 * el feed es siempre oscuro (ponytail: dual-mode diferido). */
const SPEC_COLOR = 'rgba(246,242,235,0.85)';

// ─────────────────────────────────────────────────────────────────────────────
// Estilos
// ─────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Rail derecho
  rail: {
    position: 'absolute',
    right: 14,
    flexDirection: 'column',
    gap: 22,          // expo SDK 56 / RN 0.76+ soporta gap en estilos
    alignItems: 'center',
  },
  action_btn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    // ponytail: glass pill oscuro hardcodeado — colores del mockup .fbtn
    backgroundColor: 'rgba(23,20,15,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  whatsapp_btn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    // Verde WhatsApp sólido — CTA de contacto reconocible en el rail.
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Estado presionado de los botones del rail — encoge + atenúa. */
  btn_pressed: {
    transform: [{ scale: 0.88 }],
    opacity: 0.85,
  },

  // Info inferior izquierda
  info: {
    position: 'absolute',
    left: 16,
    right: 74, // deja margen para el rail (14px right + 46px ancho + 14px gap)
  },
  agent_row: {
    marginBottom: spacing.s_12,
    alignSelf: 'flex-start',
  },
  /** Feedback de presión (#145.4) — mismo lenguaje que btn_pressed del rail. */
  agent_row_pressed: {
    transform: [{ scale: 0.94 }],
    opacity: 0.8,
  },
  agent_avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    // Fondo del fallback de inicial; la foto lo cubre por completo cuando hay.
    backgroundColor: '#6f5742',
    borderWidth: 2,
    borderColor: colors.primary_soft,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden', // la foto respeta el círculo
  },
  agent_photo: {
    width: '100%',
    height: '100%',
    borderRadius: 15, // 17 - 2 de borde
  },
  agent_initial: {
    fontFamily: fonts.sans_bold,
    fontSize: 13,
    color: '#F6F2EB',
  },
  /** Nombre público del agente bajo el avatar (#145.4). */
  agent_name: {
    marginTop: spacing.s_4,
    fontFamily: fonts.sans_bold,
    fontSize: 13,
    color: colors.paper,
    // Sombra sutil para legibilidad sobre video claro (mismo rol que el gradiente).
    textShadowColor: 'rgba(23,20,15,0.55)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  address: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 21,        // 1.1 del mockup
    letterSpacing: -0.19,  // -0.01em @ 19px
    // ponytail: colors.paper = #F6F2EB — blanco cálido que ya es el valor correcto
    color: colors.paper,
    marginBottom: spacing.s_4,
  },
  price: {
    fontFamily: fonts.display,
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.22,
    color: '#FFFFFF',
    marginBottom: spacing.s_8,
  },
  specs_row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  spec_text: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: SPEC_COLOR,
  },
  spec_divider: {
    width: 1,
    height: 12,
    // ponytail: hairline silver semitransparente sobre fondo oscuro — hardcodeado
    backgroundColor: 'rgba(194,194,189,0.35)',
    marginHorizontal: spacing.s_4,
  },
});
